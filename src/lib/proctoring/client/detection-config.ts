/**
 * Every detection threshold and timing, in one place.
 *
 * Client-only, and deliberately never sent over the wire or rendered. A
 * candidate should learn that monitoring is active, not how to stay under it
 * (spec P13). These values still ship in the JS bundle: client-side detection
 * cannot hide its own parameters from someone reading minified code. That
 * limitation is documented in plans/proctoring/README.md.
 *
 * `signs` exists because the head-pose and iris sign convention can only be
 * confirmed against a real face. If the diagnostics panel shows LEFT while
 * the tester looks to their right, flip the sign here and nowhere else.
 */
export interface DetectionConfig {
  targetFps: number
  signs: { yaw: 1 | -1; pitch: 1 | -1; irisX: 1 | -1; irisY: 1 | -1 }
  head: {
    yawDeg: number
    pitchUpDeg: number
    pitchDownDeg: number
    hysteresisDeg: number
    /** Beyond this roll the iris reading is unreliable; confidence is cut. */
    maxRollDeg: number
    /** A head turned this far is strong evidence even without the eyes. */
    strongYawDeg: number
  }
  /** Fractions of eye width. */
  iris: { xRatio: number; yRatio: number; hysteresisRatio: number }
  quality: { minQuality: number; minFaceWidth: number }
  baseline: { windowMs: number; minSamples: number; maxWindowMs: number; minFallbackSamples: number }
  /** How long a condition must persist before it counts. */
  confirmMs: { side: number; up: number; down: number; faceMissing: number; multipleFaces: number }
  /** Weak (low-confidence) gaze runs must persist this many times longer. */
  weakSignalFactor: number
  strongConfidence: number
  /** A lapse shorter than this does not break a run - it is flicker. */
  gapToleranceMs: number
  warningCooldownMs: number
  sustainedDownwardMs: number
  repeatedDownward: { windowMs: number; minOccurrences: number }
  maxTrackedOccurrences: number
}

export const DETECTION_CONFIG: DetectionConfig = {
  targetFps: 6,
  signs: { yaw: 1, pitch: 1, irisX: 1, irisY: 1 },
  head: { yawDeg: 18, pitchUpDeg: 15, pitchDownDeg: 14, hysteresisDeg: 4, maxRollDeg: 25, strongYawDeg: 35 },
  iris: { xRatio: 0.16, yRatio: 0.12, hysteresisRatio: 0.03 },
  quality: { minQuality: 0.5, minFaceWidth: 0.08 },
  baseline: { windowMs: 3000, minSamples: 12, maxWindowMs: 10000, minFallbackSamples: 3 },
  confirmMs: { side: 1750, up: 2000, down: 2500, faceMissing: 2000, multipleFaces: 750 },
  weakSignalFactor: 1.5,
  strongConfidence: 0.75,
  gapToleranceMs: 400,
  warningCooldownMs: 10000,
  sustainedDownwardMs: 6000,
  repeatedDownward: { windowMs: 300000, minOccurrences: 4 },
  maxTrackedOccurrences: 50,
}
