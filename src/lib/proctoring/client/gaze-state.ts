import type { GazeDirection } from '../types'

/**
 * Turns a stream of per-frame classifications into a small number of warnings.
 *
 * Pure, with the clock passed in on every call - no timers, no Date.now - so
 * the PRD's threshold and cooldown cases are testable exactly, without waiting.
 *
 * The whole point of this layer is restraint. A single frame of deviation is
 * noise; what a reviewer can use is "looked away for two seconds, twice". Every
 * rule here exists to keep the evidence sparse enough to be read.
 */

export type GazeWarningType =
  | 'GAZE_LEFT' | 'GAZE_RIGHT' | 'GAZE_UP' | 'GAZE_DOWN'
  | 'FACE_NOT_DETECTED' | 'MULTIPLE_FACES_DETECTED'

export interface GazeWarning {
  type: GazeWarningType
  direction: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN' | null
  /** How long the condition had been continuously observed when it fired. */
  durationMs: number
  atMs: number
}

export interface GazeStateOptions {
  gazeWarningMs: number
  cooldownMs: number
  faceMissingMs: number
  multipleFacesMs: number
}

const DIRECTION_WARNINGS: Record<string, GazeWarningType> = {
  LEFT: 'GAZE_LEFT',
  RIGHT: 'GAZE_RIGHT',
  UP: 'GAZE_UP',
  DOWN: 'GAZE_DOWN',
}

export class GazeStateMachine {
  /** The condition currently being timed, or null when centred. */
  private current: GazeDirection | null = null
  private startedAt = 0
  /** Whether the current run has already produced its warning. */
  private warned = false
  /** Last warning time per type - cooldowns do not interfere across types. */
  private lastWarnedAt: Record<string, number> = {}

  constructor(private readonly opts: GazeStateOptions) {}

  observe(direction: GazeDirection, tMs: number): GazeWarning | null {
    // A dropped or ambiguous frame is not evidence of anything. Treating it as
    // recovery would let a candidate defeat detection by degrading the image;
    // treating it as deviation would fabricate warnings. It is a no-op: the run
    // in progress neither advances nor resets.
    if (direction === 'UNCERTAIN') return null

    if (direction === 'CENTER') {
      this.current = null
      this.warned = false
      return null
    }

    // A different condition starts a fresh run - 1s of LEFT followed by 1s of
    // RIGHT is not 2s of deviation.
    if (this.current !== direction) {
      this.current = direction
      this.startedAt = tMs
      this.warned = false
      return null
    }

    if (this.warned) return null

    const threshold = this.thresholdFor(direction)
    const durationMs = tMs - this.startedAt
    if (durationMs < threshold) return null

    const type = this.warningTypeFor(direction)
    if (!type) return null

    const last = this.lastWarnedAt[type]
    if (last !== undefined && tMs - last < this.opts.cooldownMs) {
      // Inside the cooldown. Mark the run as spent so it does not re-check every
      // frame, and so one long stare produces one warning rather than a burst
      // the moment the cooldown lapses.
      this.warned = true
      return null
    }

    this.warned = true
    this.lastWarnedAt[type] = tMs

    return {
      type,
      direction: direction === 'FACE_NOT_DETECTED' || direction === 'MULTIPLE_FACES'
        ? null
        : (direction as 'LEFT' | 'RIGHT' | 'UP' | 'DOWN'),
      durationMs,
      atMs: tMs,
    }
  }

  private thresholdFor(direction: GazeDirection): number {
    if (direction === 'FACE_NOT_DETECTED') return this.opts.faceMissingMs
    if (direction === 'MULTIPLE_FACES') return this.opts.multipleFacesMs
    return this.opts.gazeWarningMs
  }

  private warningTypeFor(direction: GazeDirection): GazeWarningType | null {
    if (direction === 'FACE_NOT_DETECTED') return 'FACE_NOT_DETECTED'
    if (direction === 'MULTIPLE_FACES') return 'MULTIPLE_FACES_DETECTED'
    return DIRECTION_WARNINGS[direction] ?? null
  }

  /** Clears both the run in progress and every cooldown. */
  reset(): void {
    this.current = null
    this.startedAt = 0
    this.warned = false
    this.lastWarnedAt = {}
  }
}
