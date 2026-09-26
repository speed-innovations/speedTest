import type { FusedObservation } from './gaze-classify'
import type { DetectionConfig } from './detection-config'

/**
 * Turns a stream of per-frame fused observations into a small number of
 * episodes and warnings via the temporal engine below.
 *
 * Pure, with the clock passed in on every call - no timers, no Date.now - so
 * the PRD's threshold and cooldown cases are testable exactly, without waiting.
 *
 * The whole point of this layer is restraint. A single frame of deviation is
 * noise; what a reviewer can use is "looked away for two seconds, twice". Every
 * rule here exists to keep the evidence sparse enough to be read.
 */

export type TemporalState =
  | 'NORMAL' | 'POSSIBLE_DEVIATION' | 'SUSTAINED_DEVIATION' | 'WARNING' | 'COOLDOWN'

/** Named exactly as the metadata event each becomes. */
export type Condition =
  | 'LOOKING_LEFT' | 'LOOKING_RIGHT' | 'LOOKING_UP' | 'LOOKING_DOWN'
  | 'FACE_MISSING' | 'MULTIPLE_FACES'

export interface Episode {
  condition: Condition
  startedAtMs: number
  /** The last frame the condition was actually observed. */
  endedAtMs: number
  durationMs: number
  /** Mean per-frame confidence across the episode. */
  confidence: number
  horizontal: 'LEFT' | 'RIGHT' | null
}

export interface TemporalOutput {
  state: TemporalState
  condition: Condition | null
  /** Set on the frame a warning should be shown. */
  warning: Condition | null
  /** Set on the frame a confirmed episode closes. */
  ended: Episode | null
}

export type TemporalOptions = Pick<
  DetectionConfig, 'confirmMs' | 'gapToleranceMs' | 'warningCooldownMs' | 'weakSignalFactor' | 'strongConfidence'
>

interface Run {
  condition: Condition
  startedAt: number
  lastSeenAt: number
  confSum: number
  frames: number
  confirmed: boolean
  warnedAt: number | null
  horizontal: 'LEFT' | 'RIGHT' | null
}

export function conditionFor(o: FusedObservation): Condition | null {
  switch (o.direction) {
    case 'LEFT': return 'LOOKING_LEFT'
    case 'RIGHT': return 'LOOKING_RIGHT'
    case 'UP': return 'LOOKING_UP'
    case 'DOWN': return 'LOOKING_DOWN'
    case 'FACE_MISSING': return 'FACE_MISSING'
    case 'MULTIPLE_FACES': return 'MULTIPLE_FACES'
    default: return null
  }
}

/**
 * Turns per-frame observations into a few episodes and warnings.
 *
 * One run at a time, since the conditions are mutually exclusive per frame.
 * A run is POSSIBLE until it has lasted its confirmation window, then
 * SUSTAINED; the first sustained frame outside the condition's cooldown shows
 * a WARNING. When the condition ends - after a gap longer than the flicker
 * tolerance - a confirmed run becomes one Episode, which is what gets logged.
 * Unconfirmed runs vanish: a brief glance produces nothing at all.
 */
export class TemporalEngine {
  private run: Run | null = null
  private lastWarnedAt: { [condition: string]: number } = {}
  private lastT = 0

  constructor(private readonly opts: TemporalOptions) {}

  observe(o: FusedObservation, tMs: number): TemporalOutput {
    this.lastT = tMs
    // A dropped or ambiguous frame is evidence of nothing: it neither advances
    // nor resets the run. Treating it as recovery would let a candidate defeat
    // detection by degrading the image.
    if (o.direction === 'UNCERTAIN') return this.output(tMs, null, null)

    const c = conditionFor(o)
    const run = this.run

    if (run && c === run.condition) {
      run.lastSeenAt = tMs
      run.confSum += o.confidence
      run.frames++
      if (o.horizontal) run.horizontal = o.horizontal
    } else if (run && c === null) {
      if (tMs - run.lastSeenAt < this.opts.gapToleranceMs) return this.output(tMs, null, null)
      const done = this.close(run)
      this.run = null
      return this.output(tMs, null, done)
    } else {
      // A different condition, or the first deviation after NORMAL: 1 s of
      // LEFT then 1 s of RIGHT is not 2 s of deviation.
      const done = run ? this.close(run) : null
      this.run = c === null ? null : {
        condition: c, startedAt: tMs, lastSeenAt: tMs, confSum: o.confidence, frames: 1,
        confirmed: false, warnedAt: null, horizontal: o.horizontal,
      }
      return this.output(tMs, null, done)
    }

    let warning: Condition | null = null
    if (!run.confirmed && run.lastSeenAt - run.startedAt >= this.confirmFor(run)) run.confirmed = true
    if (run.confirmed) {
      const last = this.lastWarnedAt[run.condition]
      if (last === undefined || tMs - last >= this.opts.warningCooldownMs) {
        warning = run.condition
        run.warnedAt = tMs
        this.lastWarnedAt[run.condition] = tMs
      }
    }
    return this.output(tMs, warning, null)
  }

  /** Close a confirmed episode in progress - on finalize, so the last one is not lost. */
  flush(tMs: number): Episode | null {
    this.lastT = tMs
    const run = this.run
    this.run = null
    return run ? this.close(run) : null
  }

  reset(): void {
    this.run = null
    this.lastWarnedAt = {}
    this.lastT = 0
  }

  get state(): TemporalState {
    return this.stateAt(this.lastT)
  }

  private confirmFor(run: Run): number {
    const m = this.opts.confirmMs
    switch (run.condition) {
      case 'FACE_MISSING': return m.faceMissing
      case 'MULTIPLE_FACES': return m.multipleFaces
      default: {
        const base = run.condition === 'LOOKING_DOWN' ? m.down : run.condition === 'LOOKING_UP' ? m.up : m.side
        const mean = run.confSum / run.frames
        return mean < this.opts.strongConfidence ? base * this.opts.weakSignalFactor : base
      }
    }
  }

  private close(run: Run): Episode | null {
    if (!run.confirmed) return null
    return {
      condition: run.condition,
      startedAtMs: run.startedAt,
      endedAtMs: run.lastSeenAt,
      durationMs: run.lastSeenAt - run.startedAt,
      confidence: Math.round((run.confSum / run.frames) * 100) / 100,
      horizontal: run.horizontal,
    }
  }

  private stateAt(tMs: number): TemporalState {
    const run = this.run
    if (run) {
      if (!run.confirmed) return 'POSSIBLE_DEVIATION'
      return run.warnedAt !== null ? 'WARNING' : 'SUSTAINED_DEVIATION'
    }
    const keys = Object.keys(this.lastWarnedAt)
    for (let i = 0; i < keys.length; i++) {
      if (tMs - this.lastWarnedAt[keys[i]] < this.opts.warningCooldownMs) return 'COOLDOWN'
    }
    return 'NORMAL'
  }

  private output(tMs: number, warning: Condition | null, ended: Episode | null): TemporalOutput {
    return { state: this.stateAt(tMs), condition: this.run ? this.run.condition : null, warning, ended }
  }
}
