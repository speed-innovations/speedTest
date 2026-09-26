import type { Baseline, FrameSignals } from './gaze-classify'
import type { DetectionConfig } from './detection-config'

/**
 * The candidate's own neutral pose, from the first few seconds of monitoring.
 *
 * Median, not mean: one glance away during calibration would drag a mean and
 * skew the whole session. Only single-face, good-quality frames count. The
 * baseline lives in memory only and is never uploaded.
 *
 * It assumes the candidate looks at the screen just after starting, which is
 * usually but not always true. The mitigation is not technical: nothing here
 * fails anyone, and a person reads the observations.
 */

/** Hard ceiling, far above one window at the target rate. */
const MAX_SAMPLES = 200

interface Sample { yaw: number; pitch: number; irisX: number | null; irisY: number | null }

export class BaselineCollector {
  private samples: Sample[] = []
  private startedAt: number | null = null

  constructor(
    private readonly cfg: DetectionConfig['baseline'],
    private readonly minQuality: number
  ) {}

  add(s: FrameSignals, tMs: number): Baseline | null {
    if (this.startedAt === null) this.startedAt = tMs

    if (s.faceCount === 1 && s.yaw !== null && s.pitch !== null && s.quality >= this.minQuality) {
      if (this.samples.length < MAX_SAMPLES) {
        this.samples.push({ yaw: s.yaw, pitch: s.pitch, irisX: s.irisX, irisY: s.irisY })
      }
    }

    const elapsed = tMs - this.startedAt
    const ready = elapsed >= this.cfg.windowMs && this.samples.length >= this.cfg.minSamples
    if (!ready) {
      if (elapsed < this.cfg.maxWindowMs) return null
      if (this.samples.length < this.cfg.minFallbackSamples) {
        // Timed out with too little to trust: start over.
        this.samples = []
        this.startedAt = tMs
        return null
      }
    }

    const total = this.samples.length
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < total; i++) {
      const x = this.samples[i].irisX
      const y = this.samples[i].irisY
      if (x !== null) xs.push(x)
      if (y !== null) ys.push(y)
    }
    const baseline: Baseline = {
      yaw: median(this.samples.map(p => p.yaw)),
      pitch: median(this.samples.map(p => p.pitch)),
      irisX: medianOfMost(xs, total),
      irisY: medianOfMost(ys, total),
    }
    this.reset()
    return baseline
  }

  get sampleCount(): number {
    return this.samples.length
  }

  reset(): void {
    this.samples = []
    this.startedAt = null
  }
}

/** An iris baseline only when most calibration frames had an iris reading. */
function medianOfMost(values: number[], total: number): number | null {
  if (values.length === 0 || values.length * 2 < total) return null
  return median(values)
}

export function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
