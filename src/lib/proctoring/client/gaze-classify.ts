import type { GazeDirection } from '../types'

/**
 * Gaze classification: pure functions, no browser, no WASM, no camera.
 *
 * This is the part of proctoring most likely to be wrong, and the part a human
 * reviewer is implicitly asked to trust when they open a candidate's evidence.
 * Keeping it pure is what lets the whole of it be pinned by tests that run in
 * the node runner in milliseconds.
 *
 * Nothing here is a verdict. A direction is an observation; whether it is
 * sustained long enough to be worth recording is gaze-state.ts's job, and
 * whether it means anything at all is a person's.
 */

export interface GazeSignals {
  /** Degrees, positive to the candidate's right as the camera sees it. */
  yaw: number
  /** Degrees, positive up. */
  pitch: number
  /**
   * Iris centre offset as a fraction of eye width, positive right.
   * Null when the model returned no iris landmarks - then head pose alone
   * decides, rather than the absence of a reading suppressing detection.
   */
  irisOffsetX: number | null
  faceCount: number
}

export interface GazeBaseline {
  yaw: number
  pitch: number
}

export interface GazeThresholds {
  yawDeg: number
  pitchDeg: number
  irisRatio: number
  /** How far back inside the threshold a deviation must come to clear. */
  hysteresisDeg: number
}

/**
 * Classify one frame.
 *
 * Order of precedence, in this order for a reason: a missing or duplicated face
 * makes any direction reading meaningless, so presence is settled first.
 * Horizontal beats vertical because looking down-left at a phone is more
 * usefully reported as LEFT than as DOWN.
 */
export function classifyGaze(
  s: GazeSignals,
  baseline: GazeBaseline,
  t: GazeThresholds,
  prev: GazeDirection
): GazeDirection {
  if (s.faceCount === 0) return 'FACE_NOT_DETECTED'
  if (s.faceCount > 1) return 'MULTIPLE_FACES'

  // A degenerate transformation matrix yields NaN. Calling that CENTER would
  // silently stop detection; calling it LEFT would fabricate evidence.
  if (!Number.isFinite(s.yaw) || !Number.isFinite(s.pitch)) return 'UNCERTAIN'

  const dYaw = s.yaw - baseline.yaw
  const dPitch = s.pitch - baseline.pitch

  /**
   * Fold the iris reading into the horizontal angle.
   *
   * The gain is derived from the thresholds rather than tuned separately, so
   * the two stay consistent: an iris pushed all the way to `irisRatio`
   * contributes exactly one yaw threshold's worth of deviation. That is what
   * makes "head centred, eyes hard over" detectable at all - head pose alone
   * misses the most common way of reading something off to the side.
   */
  const irisGain = t.irisRatio > 0 ? t.yawDeg / t.irisRatio : 0
  const iris = s.irisOffsetX !== null && Number.isFinite(s.irisOffsetX) ? s.irisOffsetX : 0
  const horizontal = dYaw + iris * irisGain

  // Hysteresis applies only to the axis already deviating, so a face hovering
  // at the boundary does not flicker between CENTER and a direction every frame.
  const horizontalActive = prev === 'LEFT' || prev === 'RIGHT'
  const verticalActive = prev === 'UP' || prev === 'DOWN'
  const yawLimit = horizontalActive ? t.yawDeg - t.hysteresisDeg : t.yawDeg
  const pitchLimit = verticalActive ? t.pitchDeg - t.hysteresisDeg : t.pitchDeg

  if (Math.abs(horizontal) >= yawLimit) return horizontal > 0 ? 'RIGHT' : 'LEFT'
  if (Math.abs(dPitch) >= pitchLimit) return dPitch > 0 ? 'UP' : 'DOWN'

  return 'CENTER'
}

/** The subset of the MediaPipe result this module reads. */
export interface FaceLandmarkerLike {
  faceLandmarks?: Array<Array<{ x: number; y: number; z?: number }>>
  facialTransformationMatrixes?: Array<{ data: number[] | Float32Array }>
}

/**
 * Iris and eye-corner landmark indices in the 478-point face mesh.
 *
 * The refined mesh appends 10 iris points to the base 468; indices 468 and 473
 * are the two iris centres. When the model returns only 468 points the iris
 * reading is unavailable and extractSignals reports null rather than zero -
 * zero would read as "eyes perfectly centred", which is a different claim.
 */
const LEFT_IRIS_CENTRE = 468
const RIGHT_IRIS_CENTRE = 473
const LEFT_EYE_OUTER = 33
const LEFT_EYE_INNER = 133
const RIGHT_EYE_INNER = 362
const RIGHT_EYE_OUTER = 263

const RAD_TO_DEG = 180 / Math.PI

/**
 * Derive yaw, pitch and iris offset from a MediaPipe result.
 *
 * `facialTransformationMatrixes[0].data` is a column-major 4x4, so the rotation
 * element at (row, col) lives at data[col * 4 + row].
 *
 * The sign convention here is asserted by the classifier's tests but can only
 * be confirmed against a real face - Part 14's manual test is where looking
 * left actually has to produce LEFT.
 */
export function extractSignals(result: FaceLandmarkerLike): GazeSignals | null {
  const faces = result.faceLandmarks ?? []
  const matrices = result.facialTransformationMatrixes ?? []

  if (faces.length === 0) {
    return { yaw: 0, pitch: 0, irisOffsetX: null, faceCount: 0 }
  }
  if (faces.length > 1) {
    return { yaw: 0, pitch: 0, irisOffsetX: null, faceCount: faces.length }
  }
  if (matrices.length === 0) return null

  const d = matrices[0].data
  const r02 = Number(d[8])
  const r12 = Number(d[9])
  const r22 = Number(d[10])

  const yaw = Math.atan2(r02, r22) * RAD_TO_DEG
  const pitch = Math.atan2(-r12, Math.sqrt(r02 * r02 + r22 * r22)) * RAD_TO_DEG

  return {
    yaw,
    pitch,
    irisOffsetX: irisOffset(faces[0]),
    faceCount: 1,
  }
}

/**
 * Mean iris displacement across both eyes, as a fraction of eye width.
 *
 * Normalising by each eye's own width is what makes the number comparable
 * between candidates sitting at different distances from the camera.
 */
function irisOffset(landmarks: Array<{ x: number; y: number }>): number | null {
  if (landmarks.length <= RIGHT_IRIS_CENTRE) return null

  const left = eyeOffset(landmarks, LEFT_IRIS_CENTRE, LEFT_EYE_OUTER, LEFT_EYE_INNER)
  const right = eyeOffset(landmarks, RIGHT_IRIS_CENTRE, RIGHT_EYE_INNER, RIGHT_EYE_OUTER)

  const readings: number[] = []
  if (left !== null) readings.push(left)
  if (right !== null) readings.push(right)
  if (readings.length === 0) return null

  let sum = 0
  for (let i = 0; i < readings.length; i++) sum += readings[i]
  return sum / readings.length
}

function eyeOffset(
  landmarks: Array<{ x: number; y: number }>,
  irisIndex: number,
  cornerA: number,
  cornerB: number
): number | null {
  const iris = landmarks[irisIndex]
  const a = landmarks[cornerA]
  const b = landmarks[cornerB]
  if (!iris || !a || !b) return null

  const width = b.x - a.x
  // A zero or near-zero width means the eye is edge-on or the landmarks are
  // degenerate; dividing would produce a huge bogus offset.
  if (!Number.isFinite(width) || Math.abs(width) < 1e-6) return null

  const centre = (a.x + b.x) / 2
  return (iris.x - centre) / Math.abs(width)
}
