import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision'
import { extractFrameSignals } from './gaze-classify'
import { DetectionPipeline, type DetectionEvent, type PipelineOutput } from './detection-pipeline'
import { DETECTION_CONFIG, type DetectionConfig } from './detection-config'

/**
 * The only file that touches MediaPipe: it owns the model, the video element
 * and the frame loop. It contains no thresholds and makes no decisions - those
 * are in the pure pipeline, which is fully tested.
 *
 * Nothing here makes a network call. Frames are analysed in the tab and
 * discarded. No image, landmark or baseline ever leaves the browser.
 */

export interface GazeMonitorOptions {
  config?: DetectionConfig
  /** Every inferred frame. Called ~6 times a second - keep it cheap. */
  onOutput: (out: PipelineOutput) => void
  onError?: (err: unknown) => void
  /** Where the vendored WASM and model live. Never a CDN. */
  assetBasePath?: string
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number
  cancelVideoFrameCallback?: (handle: number) => void
}

/** How long to wait for a first video-frame callback before using rAF instead. */
const RVFC_WATCHDOG_MS = 1000

export class GazeMonitor {
  private landmarker: FaceLandmarker | null
  private video: FrameVideo | null = null
  private handle: number | null = null
  private handleKind: 'rvfc' | 'raf' | null = null
  private useRvfc = false
  private sawFrame = false
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private running = false
  private busy = false
  private lastInferenceAt = -Infinity
  private lastTimestamp = 0
  private readonly frameIntervalMs: number
  private readonly config: DetectionConfig
  private readonly pipeline: DetectionPipeline

  private constructor(landmarker: FaceLandmarker, private readonly opts: GazeMonitorOptions) {
    this.landmarker = landmarker
    this.config = opts.config ?? DETECTION_CONFIG
    this.frameIntervalMs = 1000 / this.config.targetFps
    this.pipeline = new DetectionPipeline(this.config)
  }

  /**
   * Load the model from our own origin. A blocked CDN would otherwise break
   * proctoring after the candidate has granted permissions.
   *
   * Single-threaded WASM only: the app sets no COOP/COEP headers, so the
   * threaded build cannot run. GPU first, CPU if the GPU delegate cannot
   * initialise (no WebGL, blocklisted driver).
   */
  static async create(opts: GazeMonitorOptions): Promise<GazeMonitor> {
    const base = opts.assetBasePath ?? '/mediapipe'
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`)
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate },
      runningMode: 'VIDEO' as const,
      // Two, not one: a second person is the point. More costs time for no signal.
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
    })
    let landmarker: FaceLandmarker
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'))
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'))
    }
    return new GazeMonitor(landmarker, opts)
  }

  start(video: HTMLVideoElement): void {
    if (this.running || !this.landmarker) return
    this.running = true
    this.video = video as FrameVideo
    this.pipeline.reset()
    this.lastInferenceAt = -Infinity
    this.useRvfc = typeof this.video.requestVideoFrameCallback === 'function'
    this.sawFrame = false
    this.schedule()
    if (this.useRvfc) {
      this.watchdog = setTimeout(() => {
        this.watchdog = null
        if (!this.running || this.sawFrame) return
        // Some engines deliver no video-frame callbacks for an element that is
        // not in the document. Fall back rather than silently never inferring.
        this.cancelScheduled()
        this.useRvfc = false
        this.schedule()
      }, RVFC_WATCHDOG_MS)
    }
  }

  /** Close the episode in progress. Call before stop(): stop resets the pipeline. */
  flush(): DetectionEvent[] {
    return this.pipeline.flush(performance.now())
  }

  stop(): void {
    this.running = false
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
    this.cancelScheduled()
    try {
      this.landmarker?.close()
    } catch {
      // A model that failed mid-load has nothing to release.
    }
    this.landmarker = null
    this.video = null
    this.pipeline.reset()
  }

  get isRunning(): boolean {
    return this.running
  }

  /**
   * One callback in flight at a time. requestVideoFrameCallback fires once
   * per decoded frame, which is cheaper than rAF at 60+ Hz. Either way the
   * timestamp gate below keeps inference at the target rate.
   */
  private schedule(): void {
    const v = this.video
    if (!this.running || !v || this.handle !== null) return
    if (this.useRvfc && v.requestVideoFrameCallback) {
      this.handleKind = 'rvfc'
      this.handle = v.requestVideoFrameCallback(this.tick)
    } else {
      this.handleKind = 'raf'
      this.handle = requestAnimationFrame(this.tick)
    }
  }

  private cancelScheduled(): void {
    if (this.handle === null) return
    if (this.handleKind === 'rvfc' && this.video && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.handle)
    } else if (this.handleKind === 'raf') {
      cancelAnimationFrame(this.handle)
    }
    this.handle = null
    this.handleKind = null
  }

  private tick = (): void => {
    this.handle = null
    this.handleKind = null
    if (!this.running) return
    this.sawFrame = true
    this.infer()
    this.schedule()
  }

  private infer(): void {
    const video = this.video
    const landmarker = this.landmarker
    // `busy` guards re-entrancy: never two inferences at once.
    if (!video || !landmarker || this.busy || video.readyState < 2) return
    const now = performance.now()
    if (now - this.lastInferenceAt < this.frameIntervalMs) return
    this.lastInferenceAt = now
    // detectForVideo requires strictly increasing timestamps.
    const ts = now > this.lastTimestamp ? now : this.lastTimestamp + 1
    this.lastTimestamp = ts
    this.busy = true
    try {
      const result = landmarker.detectForVideo(video, ts)
      this.opts.onOutput(this.pipeline.process(extractFrameSignals(result, this.config.signs), now))
    } catch (err) {
      this.opts.onError?.(err)
    } finally {
      this.busy = false
    }
  }
}
