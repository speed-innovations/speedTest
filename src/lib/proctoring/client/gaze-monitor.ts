import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision'
import { classifyGaze, extractSignals, type GazeBaseline, type GazeThresholds } from './gaze-classify'
import { GazeStateMachine, type GazeWarning } from './gaze-state'
import type { GazeDirection } from '../types'

/**
 * The only file that touches MediaPipe.
 *
 * It owns the model, the video element and the loop, and contains no thresholds
 * and no decisions - those live in gaze-classify.ts and gaze-state.ts, which are
 * pure and fully tested. This shell is deliberately thin because it is the part
 * that cannot be tested without a browser and a camera.
 *
 * Nothing here makes a network call. Frames are analysed in the tab and
 * discarded; no image, no landmark and no baseline ever leaves the browser.
 */

export interface GazeMonitorOptions {
  thresholds: GazeThresholds
  gazeWarningMs: number
  gazeWarningCooldownMs: number
  faceMissingWarningMs: number
  multipleFacesWarningMs: number
  onWarning: (w: GazeWarning) => void
  /** Every classified frame, for a live indicator. Called often - keep it cheap. */
  onDirection?: (d: GazeDirection) => void
  onError?: (err: unknown) => void
  /** Inference rate. ~6 FPS shares the thread civilly with the exam UI. */
  targetFps?: number
  /** Where the vendored WASM and model live. Never a CDN. */
  assetBasePath?: string
}

/** Frames collected before a baseline is accepted, at ~6 FPS. */
const BASELINE_MIN_SAMPLES = 12
/** How long baseline collection may run before it gives up and uses what it has. */
const BASELINE_WINDOW_MS = 3000

export class GazeMonitor {
  private landmarker: FaceLandmarker | null = null
  private video: HTMLVideoElement | null = null
  private rafId: number | null = null
  private running = false
  private lastInferenceAt = 0
  private readonly frameIntervalMs: number

  private state: GazeStateMachine
  private previous: GazeDirection = 'CENTER'

  private baseline: GazeBaseline | null = null
  private baselineSamples: Array<{ yaw: number; pitch: number }> = []
  private baselineStartedAt = 0

  private constructor(
    landmarker: FaceLandmarker,
    private readonly opts: GazeMonitorOptions
  ) {
    this.landmarker = landmarker
    this.frameIntervalMs = 1000 / (opts.targetFps ?? 6)
    this.state = new GazeStateMachine({
      gazeWarningMs: opts.gazeWarningMs,
      cooldownMs: opts.gazeWarningCooldownMs,
      faceMissingMs: opts.faceMissingWarningMs,
      multipleFacesMs: opts.multipleFacesWarningMs,
    })
  }

  /**
   * Load the model from our own origin.
   *
   * Self-hosted deliberately: the default CDN fetch means a blocked or slow CDN
   * breaks proctoring mid-assessment, after the candidate has granted
   * permissions and the clock has started.
   *
   * Single-threaded WASM only. The app sets no COOP/COEP headers, so
   * SharedArrayBuffer is unavailable and the threaded build cannot run; adding
   * those headers would change behaviour app-wide and is out of scope here.
   */
  static async create(opts: GazeMonitorOptions): Promise<GazeMonitor> {
    const base = opts.assetBasePath ?? '/mediapipe'
    const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`)
    const landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `${base}/face_landmarker.task`,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      // Two, not one: detecting a second person is the point. More than two
      // costs inference time for no extra signal - two already means "not alone".
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
      // Blendshapes are unused here and cost time on every frame.
      outputFaceBlendshapes: false,
    })
    return new GazeMonitor(landmarker, opts)
  }

  start(video: HTMLVideoElement): void {
    if (this.running) return
    this.running = true
    this.video = video
    this.baseline = null
    this.baselineSamples = []
    this.baselineStartedAt = performance.now()
    this.state.reset()
    this.previous = 'CENTER'
    this.loop()
  }

  /**
   * One rAF loop with a timestamp gate, rather than one inference per frame.
   *
   * rAF fires at the display's rate - 60 Hz or more - and each inference is tens
   * of milliseconds on the same thread as the exam UI. Gating to ~6 FPS is what
   * keeps answering questions responsive while proctoring runs.
   */
  private loop = (): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.loop)

    const video = this.video
    if (!video || video.readyState < 2) return

    const now = performance.now()
    if (now - this.lastInferenceAt < this.frameIntervalMs) return
    this.lastInferenceAt = now

    try {
      const result = this.landmarker?.detectForVideo(video, now)
      if (!result) return

      const signals = extractSignals(result)
      if (!signals) return

      if (!this.baseline) {
        this.collectBaseline(signals, now)
        // Until a baseline exists there is nothing to measure deviation
        // against, so no classification and no warnings.
        return
      }

      const direction = classifyGaze(signals, this.baseline, this.opts.thresholds, this.previous)
      this.previous = direction
      this.opts.onDirection?.(direction)

      const warning = this.state.observe(direction, now)
      if (warning) this.opts.onWarning(warning)
    } catch (err) {
      this.opts.onError?.(err)
    }
  }

  /**
   * Accept a neutral baseline from the first few seconds.
   *
   * This assumes the candidate is looking at the screen just after starting,
   * which is usually but not always true - a skewed baseline persists for the
   * whole session. Frames with no face, or with more than one, are discarded so
   * at least the samples are of a single visible face. The honest mitigation is
   * not technical: gaze never auto-fails anyone, and a human reads the evidence.
   *
   * The baseline stays in memory for the session. It is never uploaded and
   * never persisted.
   */
  private collectBaseline(
    signals: { yaw: number; pitch: number; faceCount: number },
    now: number
  ): void {
    if (signals.faceCount === 1 && Number.isFinite(signals.yaw) && Number.isFinite(signals.pitch)) {
      this.baselineSamples.push({ yaw: signals.yaw, pitch: signals.pitch })
    }

    const enoughSamples = this.baselineSamples.length >= BASELINE_MIN_SAMPLES
    const windowElapsed = now - this.baselineStartedAt >= BASELINE_WINDOW_MS
    if (!enoughSamples && !windowElapsed) return
    if (this.baselineSamples.length === 0) {
      // No usable frame at all in the window - the candidate may be off-camera.
      // Restart the window rather than baselining on nothing.
      this.baselineStartedAt = now
      return
    }

    // Median, not mean: one frame of the candidate glancing away during
    // calibration would drag a mean and skew the entire session.
    this.baseline = {
      yaw: median(this.baselineSamples.map(s => s.yaw)),
      pitch: median(this.baselineSamples.map(s => s.pitch)),
    }
    this.baselineSamples = []
  }

  stop(): void {
    this.running = false
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.landmarker?.close()
    this.landmarker = null
    this.video = null
  }

  get hasBaseline(): boolean {
    return this.baseline !== null
  }
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
