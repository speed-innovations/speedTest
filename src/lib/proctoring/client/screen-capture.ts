/**
 * Periodic still snapshots of the shared screen.
 *
 * The display stream is held ONLY to draw frames from. There is deliberately no
 * recorder anywhere in this file: the screen is never recorded, only sampled at
 * the configured interval. A grep for the recorder class in this file must come
 * back empty - see the check in part-07.
 */

export interface Snapshot {
  sequence: number
  blob: Blob
  contentType: 'image/webp' | 'image/jpeg'
  width: number
  height: number
  capturedAt: Date
  elapsedMs: number
}

export interface ScreenCaptureOptions {
  stream: MediaStream
  maxBytes: number
  /** Longest edge of the encoded image. */
  maxWidth?: number
  onSnapshot: (s: Snapshot) => void
  /** The candidate pressed "Stop sharing". Reported, never silently re-acquired. */
  onEnded?: () => void
  onError?: (err: unknown) => void
  now?: () => number
}

/** Quality ladder, tried in order before dimensions are reduced. */
const QUALITY_STEPS = [0.65, 0.5, 0.35]
/** Scale ladder, applied after quality is exhausted. */
const SCALE_STEPS = [1, 0.75, 0.5]

export class ScreenCapture {
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private sequence = 0
  private startedAt = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly maxWidth: number
  private readonly now: () => number

  constructor(private readonly opts: ScreenCaptureOptions) {
    this.maxWidth = opts.maxWidth ?? 1280
    this.now = opts.now ?? (() => performance.now())
  }

  async start(intervalMs: number): Promise<void> {
    this.startedAt = this.now()

    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = this.opts.stream
    this.video = video

    const track = this.opts.stream.getVideoTracks()[0]
    if (track) {
      // The candidate can stop sharing from the browser's own UI at any time.
      // Report it and let the caller decide; re-acquiring would need a fresh
      // user gesture anyway.
      track.addEventListener('ended', () => this.opts.onEnded?.())
    }

    try {
      await video.play()
    } catch (err) {
      // Autoplay refusal on a muted, off-screen element is unusual but not
      // fatal - the frame data may still be readable.
      this.opts.onError?.(err)
    }

    await this.waitForDimensions(video)

    // An immediate first snapshot, then one per interval. The estimate in
    // quota.ts counts this extra one.
    await this.capture()
    this.timer = setInterval(() => { void this.capture() }, intervalMs)
  }

  /**
   * A video element reports 0x0 until the first frame has actually arrived.
   * Drawing before then yields a blank image, which looks like a working
   * capture right up until a reviewer opens it.
   */
  private waitForDimensions(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
    if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve()
    return new Promise<void>(resolve => {
      const startedAt = this.now()
      const poll = setInterval(() => {
        if ((video.videoWidth > 0 && video.videoHeight > 0) || this.now() - startedAt > timeoutMs) {
          clearInterval(poll)
          resolve()
        }
      }, 100)
    })
  }

  async capture(): Promise<void> {
    const video = this.video
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return

    try {
      const encoded = await this.encodeWithinBudget(video)
      if (!encoded) {
        // Every rung of the ladder still exceeded the budget. Report rather
        // than upload something oversized that the server would reject anyway.
        this.opts.onError?.(new Error('Screenshot exceeded the size budget at the lowest quality'))
        return
      }
      this.sequence++
      this.opts.onSnapshot({
        sequence: this.sequence,
        blob: encoded.blob,
        contentType: encoded.contentType,
        width: encoded.width,
        height: encoded.height,
        capturedAt: new Date(),
        elapsedMs: Math.round(this.now() - this.startedAt),
      })
    } catch (err) {
      this.opts.onError?.(err)
    }
  }

  /**
   * Lower quality first, then dimensions, then give up.
   *
   * That order is deliberate: a full-width screenshot at lower quality is still
   * legible to a reviewer, whereas a half-width one at high quality loses the
   * small text that makes a screenshot worth having.
   */
  private async encodeWithinBudget(
    video: HTMLVideoElement
  ): Promise<{ blob: Blob; contentType: 'image/webp' | 'image/jpeg'; width: number; height: number } | null> {
    for (let s = 0; s < SCALE_STEPS.length; s++) {
      const { width, height } = this.targetSize(video, SCALE_STEPS[s])
      const canvas = this.drawTo(video, width, height)

      for (let q = 0; q < QUALITY_STEPS.length; q++) {
        const quality = QUALITY_STEPS[q]

        const webp = await this.toBlob(canvas, 'image/webp', quality)
        if (webp && webp.size <= this.opts.maxBytes) {
          return { blob: webp, contentType: 'image/webp', width, height }
        }

        // toBlob yields null for a format the browser cannot encode. Safari
        // historically had no WebP encoder, so JPEG is the fallback rather
        // than an error.
        if (!webp) {
          const jpeg = await this.toBlob(canvas, 'image/jpeg', quality)
          if (jpeg && jpeg.size <= this.opts.maxBytes) {
            return { blob: jpeg, contentType: 'image/jpeg', width, height }
          }
        }
      }
    }
    return null
  }

  private targetSize(video: HTMLVideoElement, scale: number): { width: number; height: number } {
    const natural = video.videoWidth
    const capped = Math.min(natural, this.maxWidth)
    const width = Math.max(1, Math.round(capped * scale))
    // Preserve the aspect ratio: a stretched screenshot is harder to read and
    // no smaller.
    const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width))
    return { width, height }
  }

  private drawTo(video: HTMLVideoElement, width: number, height: number): HTMLCanvasElement {
    const canvas = this.canvas ?? document.createElement('canvas')
    this.canvas = canvas
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2d canvas context')
    ctx.drawImage(video, 0, 0, width, height)
    return canvas
  }

  private toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
    return new Promise<Blob | null>(resolve => {
      canvas.toBlob(b => resolve(b), type, quality)
    })
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }
    this.canvas = null
  }

  get snapshotCount(): number {
    return this.sequence
  }
}
