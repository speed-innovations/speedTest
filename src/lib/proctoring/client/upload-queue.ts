// UploadState used to live in '../types'. It was removed there in the
// live-monitoring migration (proctoring stores no media, so there is nothing
// left to upload), but this queue itself is only rewired/removed in a later
// task - so the type it needs is kept local rather than reintroduced as a
// shared export.
type UploadState = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'EXPIRED'

/**
 * A bounded, retrying upload queue.
 *
 * Pure logic over injected callbacks - no DOM, no fetch, no timers of its own -
 * so backoff and the drop policy are testable without real waiting.
 */

export interface QueueItem {
  /** Stable across retries; also the dedup handle for the caller. */
  id: string
  kind: 'WEBCAM_SEGMENT' | 'SCREENSHOT'
  sequence: number
  blob: Blob
  capturedAt: Date
  elapsedMs?: number
  questionId?: string | null
  /** Mutated by the queue. */
  state: UploadState
  attempts: number
}

export interface QueueSummary {
  pending: number
  uploading: number
  uploaded: number
  failed: number
  /** Items evicted by the bound, never attempted again. */
  dropped: number
}

export interface UploadQueueOptions {
  maxItems: number
  maxRetries: number
  baseDelayMs: number
  upload: (item: QueueItem) => Promise<void>
  onStateChange?: (summary: QueueSummary) => void
  /** Fired when an item exhausts its retries, so the UI can degrade. */
  onDegraded?: (item: QueueItem) => void
  /** Fired when an item is evicted by the bound. */
  onDropped?: (item: QueueItem) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export class UploadQueue {
  private items: QueueItem[] = []
  private running = false
  private droppedCount = 0
  private readonly opts: Required<Pick<UploadQueueOptions, 'maxItems' | 'maxRetries' | 'baseDelayMs' | 'upload'>> &
    UploadQueueOptions
  private drainWaiters: Array<() => void> = []

  constructor(options: UploadQueueOptions) {
    this.opts = options as UploadQueue['opts']
  }

  /**
   * Add an item, evicting the OLDEST pending one if the queue is full.
   *
   * Dropping the oldest is deliberate. When the network is failing and
   * something has to give, recent evidence is more useful to a reviewer than
   * old evidence, and the outcome being avoided is hundreds of megabytes of
   * unuploaded webcam video accumulating in the candidate's tab.
   */
  enqueue(item: Omit<QueueItem, 'state' | 'attempts'>): void {
    const full: QueueItem = { ...item, state: 'PENDING', attempts: 0 }

    if (this.activeCount() >= this.opts.maxItems) {
      const victimIndex = this.findOldestPending()
      if (victimIndex >= 0) {
        const victim = this.items[victimIndex]
        this.items.splice(victimIndex, 1)
        this.droppedCount++
        this.opts.onDropped?.(victim)
      }
    }

    this.items.push(full)
    this.emit()
    void this.run()
  }

  /** Items still occupying space: pending or in flight. */
  private activeCount(): number {
    return this.items.filter(i => i.state === 'PENDING' || i.state === 'UPLOADING').length
  }

  private findOldestPending(): number {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].state === 'PENDING') return i
    }
    return -1
  }

  /**
   * Concurrency is capped at one on purpose: a webcam segment is orders of
   * magnitude larger than a screenshot, and letting them compete on a weak
   * connection delays both.
   */
  private async run(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const index = this.findOldestPending()
        if (index < 0) break
        const item = this.items[index]
        await this.attempt(item)
      }
    } finally {
      this.running = false
      if (this.activeCount() === 0) {
        const waiters = this.drainWaiters
        this.drainWaiters = []
        waiters.forEach(w => w())
      }
    }
  }

  private async attempt(item: QueueItem): Promise<void> {
    item.state = 'UPLOADING'
    this.emit()
    try {
      await this.opts.upload(item)
      item.state = 'UPLOADED'
      this.emit()
    } catch {
      item.attempts++
      if (item.attempts > this.opts.maxRetries) {
        item.state = 'FAILED'
        this.emit()
        this.opts.onDegraded?.(item)
        return
      }
      // Exponential: base, 2x, 4x... An immediate retry against a saturated
      // uplink just makes the congestion worse.
      const delay = this.opts.baseDelayMs * Math.pow(2, item.attempts - 1)
      item.state = 'PENDING'
      this.emit()
      const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
      await sleep(delay)
    }
  }

  /** Resolves once no item is pending or in flight. */
  drain(): Promise<void> {
    if (this.activeCount() === 0) return Promise.resolve()
    return new Promise<void>(resolve => { this.drainWaiters.push(resolve) })
  }

  summary(): QueueSummary {
    return {
      pending: this.items.filter(i => i.state === 'PENDING').length,
      uploading: this.items.filter(i => i.state === 'UPLOADING').length,
      uploaded: this.items.filter(i => i.state === 'UPLOADED').length,
      failed: this.items.filter(i => i.state === 'FAILED').length,
      dropped: this.droppedCount,
    }
  }

  /** Ids in the order they were added, for assertions and diagnostics. */
  order(): string[] {
    return this.items.map(i => i.id)
  }

  private emit(): void {
    this.opts.onStateChange?.(this.summary())
  }
}
