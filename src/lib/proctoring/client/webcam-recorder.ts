import { selectRecorderMimeType } from './media-support'

/**
 * Segmented webcam+microphone recording over a single stream.
 *
 * The recorder owns the MediaRecorder and the segment bookkeeping and nothing
 * else - it does not know about uploading, and it holds no React state. Each
 * finished segment leaves through onSegment.
 */

export interface RecordedSegment {
  sequence: number
  blob: Blob
  mimeType: string
  /** Wall-clock length of this segment. */
  durationMs: number
  /** Milliseconds from recording start to the START of this segment. */
  elapsedMs: number
  capturedAt: Date
}

export interface WebcamRecorderOptions {
  stream: MediaStream
  segmentMs: number
  videoBitsPerSecond: number
  audioBitsPerSecond: number
  onSegment: (segment: RecordedSegment) => void
  onError?: (err: unknown) => void
  /** Injected for tests; defaults to performance.now via the monotonic clock. */
  now?: () => number
}

export class WebcamRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private sequence = 0
  private segmentStartedAt = 0
  private recordingStartedAt = 0
  private rotateTimer: ReturnType<typeof setTimeout> | null = null
  private stopping = false
  private readonly mimeType: string
  private readonly now: () => number

  constructor(private readonly opts: WebcamRecorderOptions) {
    const mime = selectRecorderMimeType()
    if (!mime) throw new Error('No supported recording format in this browser')
    this.mimeType = mime
    // performance.now is monotonic and unaffected by the system clock changing
    // mid-assessment. Counting timeslices instead would drift, and the admin
    // timeline correlates evidence by elapsedMs.
    this.now = opts.now ?? (() => performance.now())
  }

  start(): void {
    if (this.recorder) return
    this.recordingStartedAt = this.now()
    this.startSegment()
  }

  private startSegment(): void {
    this.chunks = []
    this.segmentStartedAt = this.now()

    const recorder = new MediaRecorder(this.opts.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.opts.videoBitsPerSecond,
      audioBitsPerSecond: this.opts.audioBitsPerSecond,
    })
    this.recorder = recorder

    recorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data)
    }

    // Build the Blob here rather than in onstop. onstop can fire before the
    // final dataavailable has been delivered, which silently truncates the last
    // chunk of every segment.
    recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType })
      this.chunks = []
      const endedAt = this.now()

      if (blob.size > 0) {
        this.sequence++
        this.opts.onSegment({
          sequence: this.sequence,
          blob,
          mimeType: this.mimeType,
          durationMs: Math.round(endedAt - this.segmentStartedAt),
          elapsedMs: Math.round(this.segmentStartedAt - this.recordingStartedAt),
          capturedAt: new Date(),
        })
      }

      if (!this.stopping) this.startSegment()
    }

    recorder.onerror = e => this.opts.onError?.(e)

    try {
      recorder.start()
    } catch (err) {
      this.opts.onError?.(err)
      return
    }

    this.rotateTimer = setTimeout(() => this.rotate(), this.opts.segmentMs)
  }

  /**
   * Close the current segment and open the next.
   *
   * Only the MediaRecorder is restarted - the MediaStream is deliberately left
   * running. Stopping its tracks would drop the camera indicator light and, on
   * some browsers, re-prompt the candidate for permission mid-assessment.
   */
  private rotate(): void {
    if (!this.recorder || this.recorder.state === 'inactive') return
    this.clearTimer()
    this.recorder.stop()
  }

  /** Flush the final segment. Resolves once its blob has been emitted. */
  async stop(): Promise<void> {
    this.stopping = true
    this.clearTimer()
    const recorder = this.recorder
    if (!recorder || recorder.state === 'inactive') return

    await new Promise<void>(resolve => {
      const previous = recorder.onstop
      recorder.onstop = (event: Event) => {
        // Run the normal handler first so the final blob is emitted, then let
        // the caller proceed. Awaiting stop() must mean "the last segment is
        // out", or submit races the final upload.
        previous?.call(recorder, event)
        resolve()
      }
      recorder.stop()
    })
    this.recorder = null
  }

  private clearTimer(): void {
    if (this.rotateTimer !== null) {
      clearTimeout(this.rotateTimer)
      this.rotateTimer = null
    }
  }

  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording'
  }

  get segmentCount(): number {
    return this.sequence
  }
}
