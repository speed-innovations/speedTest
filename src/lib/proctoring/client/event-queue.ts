import type { ClientEventType } from '../event-types'

/**
 * The client's outbox for metadata events.
 *
 * Three bounds, because an exam tab runs for hours on unreliable networks:
 *  - size: never more than maxSize events in memory; INFO goes before WARN;
 *  - rate: at most perTypeMax of one type per window, so a stuck condition or
 *    a flapping focus cannot flood the server or the tab;
 *  - flight: one drain at a time.
 * A failed batch goes back to the front and is retried on the next flush. The
 * server dedups on clientEventId, so resending a batch that actually landed
 * is harmless.
 */

export interface WireEvent {
  clientEventId: string
  type: ClientEventType
  startedAt: string
  endedAt?: string
  durationMs?: number
  confidence?: number
  direction?: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'
  /** Eviction priority only. The server derives its own severity. */
  severity: 'INFO' | 'WARN'
  elapsedMs?: number
  questionId?: string
  metadata?: Record<string, string | number | boolean>
}

export interface EventQueueOptions {
  send: (batch: WireEvent[], opts: { keepalive: boolean }) => Promise<boolean>
  maxSize?: number
  batchSize?: number
  perTypeMax?: number
  perTypeWindowMs?: number
  now?: () => number
}

export class EventQueue {
  private items: WireEvent[] = []
  private recent: { [type: string]: number[] } = {}
  private droppedCount = 0
  private inFlight: Promise<void> | null = null
  private closed = false
  private readonly maxSize: number
  private readonly batchSize: number
  private readonly perTypeMax: number
  private readonly perTypeWindowMs: number
  private readonly now: () => number

  constructor(private readonly opts: EventQueueOptions) {
    this.maxSize = opts.maxSize ?? 200
    this.batchSize = opts.batchSize ?? 50
    this.perTypeMax = opts.perTypeMax ?? 20
    this.perTypeWindowMs = opts.perTypeWindowMs ?? 60_000
    this.now = opts.now ?? (() => Date.now())
  }

  /** False when the event was refused (closed, or over its type's rate cap). */
  push(e: WireEvent): boolean {
    if (this.closed) return false
    const now = this.now()
    const times = (this.recent[e.type] ?? []).filter(t => now - t < this.perTypeWindowMs)
    if (times.length >= this.perTypeMax) {
      this.recent[e.type] = times
      this.droppedCount++
      return false
    }
    times.push(now)
    this.recent[e.type] = times

    if (this.items.length >= this.maxSize) {
      let evict = 0
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].severity === 'INFO') { evict = i; break }
      }
      this.items.splice(evict, 1)
      this.droppedCount++
    }
    this.items.push(e)
    return true
  }

  flush(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (this.inFlight) return this.inFlight
    const run = this.drain(!!opts.keepalive)
    const done = run.then(
      () => { this.inFlight = null },
      () => { this.inFlight = null }
    )
    this.inFlight = done
    return done
  }

  /** Stop accepting events and drop what is held. Used at teardown. */
  close(): void {
    this.closed = true
    this.items = []
    this.recent = {}
  }

  get size(): number {
    return this.items.length
  }

  get dropped(): number {
    return this.droppedCount
  }

  private async drain(keepalive: boolean): Promise<void> {
    while (this.items.length > 0 && !this.closed) {
      const batch = this.items.slice(0, this.batchSize)
      this.items = this.items.slice(batch.length)
      let ok = false
      try {
        ok = await this.opts.send(batch, { keepalive })
      } catch {
        ok = false
      }
      if (!ok) {
        if (this.closed) return
        this.items = batch.concat(this.items)
        if (this.items.length > this.maxSize) {
          this.droppedCount += this.items.length - this.maxSize
          this.items = this.items.slice(this.items.length - this.maxSize)
        }
        return
      }
    }
  }
}
