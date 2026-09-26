import type { GazeDirection } from '../types'
import { DETECTION_CONFIG, type DetectionConfig } from './detection-config'

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

// ---------------------------------------------------------------------------
// Live-monitoring signals (supersede GazeSignals/classifyGaze in Task 6)
// ---------------------------------------------------------------------------

/**
 * Everything read from one frame. Every reading is null when unavailable,
 * never 0: zero means "exactly centred", which is a different claim.
 */
export interface FrameSignals {
  faceCount: number
  /** Degrees. Sign set by DETECTION_CONFIG.signs. */
  yaw: number | null
  pitch: number | null
  roll: number | null
  /** Iris offset from the eye-corner midpoint, in eye widths. +x image right, +y image down. */
  irisX: number | null
  irisY: number | null
  /** Landmark bounding-box width, 0..1 of the frame. Small means far away. */
  faceWidth: number | null
  /** 0..1: how much of what fusion needs was actually present. */
  quality: number
}

export interface Baseline {
  yaw: number
  pitch: number
  irisX: number | null
  irisY: number | null
}

export type Agreement = 'HEAD_AND_EYES' | 'HEAD_ONLY' | 'EYES_ONLY' | 'NONE'

export interface FusedObservation {
  direction: GazeDirection
  horizontal: 'LEFT' | 'RIGHT' | null
  vertical: 'UP' | 'DOWN' | null
  /** 0..1. Agreement between head and eyes, scaled by quality and roll. */
  confidence: number
  agreement: Agreement
  deviation: { yaw: number | null; pitch: number | null; irisX: number | null; irisY: number | null }
}

const NO_READINGS = {
  yaw: null, pitch: null, roll: null, irisX: null, irisY: null, faceWidth: null,
}

export function extractFrameSignals(
  result: FaceLandmarkerLike,
  signs: DetectionConfig['signs'] = DETECTION_CONFIG.signs
): FrameSignals {
  const faces = result.faceLandmarks ?? []
  if (faces.length === 0) return { faceCount: 0, ...NO_READINGS, quality: 0 }
  // Two people: presence is the observation. A direction for "which face?"
  // would be meaningless.
  if (faces.length > 1) return { faceCount: faces.length, ...NO_READINGS, quality: 1 }

  const points = faces[0]
  const matrices = result.facialTransformationMatrixes ?? []
  const pose = headPose(matrices.length > 0 ? matrices[0] : undefined)
  const iris = irisOffsets(points)

  let quality = points.length >= 468 ? 1 : 0.5
  if (!pose) quality *= 0.5
  if (iris === null) quality *= 0.8

  return {
    faceCount: 1,
    yaw: pose ? pose.yaw * signs.yaw : null,
    pitch: pose ? pose.pitch * signs.pitch : null,
    roll: pose ? pose.roll : null,
    irisX: iris ? iris.x * signs.irisX : null,
    irisY: iris ? iris.y * signs.irisY : null,
    faceWidth: faceWidthOf(points),
    quality,
  }
}

/**
 * Yaw, pitch and roll from the column-major 4x4. Element (row, col) is at
 * data[col * 4 + row]. Null for a degenerate matrix instead of NaN.
 */
function headPose(m: { data: number[] | Float32Array } | undefined): { yaw: number; pitch: number; roll: number } | null {
  if (!m || !m.data || m.data.length < 16) return null
  const d = m.data
  const r02 = Number(d[8])
  const r12 = Number(d[9])
  const r22 = Number(d[10])
  const r10 = Number(d[1])
  const r11 = Number(d[5])
  const yaw = Math.atan2(r02, r22) * RAD_TO_DEG
  const pitch = Math.atan2(-r12, Math.sqrt(r02 * r02 + r22 * r22)) * RAD_TO_DEG
  const roll = Math.atan2(r10, r11) * RAD_TO_DEG
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || !Number.isFinite(roll)) return null
  return { yaw, pitch, roll }
}

/** Mean of both eyes' offsets, each normalised by its own width. */
function irisOffsets(points: Array<{ x: number; y: number }>): { x: number; y: number } | null {
  if (points.length <= RIGHT_IRIS_CENTRE) return null
  const readings: Array<{ x: number; y: number }> = []
  const left = eyeOffsetXY(points, LEFT_IRIS_CENTRE, LEFT_EYE_OUTER, LEFT_EYE_INNER)
  const right = eyeOffsetXY(points, RIGHT_IRIS_CENTRE, RIGHT_EYE_INNER, RIGHT_EYE_OUTER)
  if (left) readings.push(left)
  if (right) readings.push(right)
  if (readings.length === 0) return null
  let x = 0
  let y = 0
  for (let i = 0; i < readings.length; i++) { x += readings[i].x; y += readings[i].y }
  return { x: x / readings.length, y: y / readings.length }
}

function eyeOffsetXY(
  points: Array<{ x: number; y: number }>,
  irisIndex: number,
  cornerA: number,
  cornerB: number
): { x: number; y: number } | null {
  const iris = points[irisIndex]
  const a = points[cornerA]
  const b = points[cornerB]
  if (!iris || !a || !b) return null
  const width = Math.abs(b.x - a.x)
  if (!Number.isFinite(width) || width < 1e-6) return null
  const x = (iris.x - (a.x + b.x) / 2) / width
  const y = (iris.y - (a.y + b.y) / 2) / width
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function faceWidthOf(points: Array<{ x: number; y: number }>): number | null {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < points.length; i++) {
    const x = points[i].x
    if (!Number.isFinite(x)) continue
    if (x < min) min = x
    if (x > max) max = x
  }
  return max > min ? max - min : null
}

type Axis<T> = { dir: T | null; confidence: number; agreement: Agreement }

/**
 * Combine the head and eye readings on one axis. This is where "never a
 * single signal" lives:
 *  - head and eyes agree              -> strong
 *  - head and eyes disagree           -> nothing (head turned, eyes on screen)
 *  - head only, eyes measured centred -> weak/moderate
 *  - head only, eyes unmeasurable     -> moderate
 *  - head turned very far             -> strong on its own
 *  - eyes only                        -> weakest
 */
function combine<T>(head: T | null, eyes: T | null, eyesMeasured: boolean, headStrong: boolean): Axis<T> {
  if (head && eyes) {
    return head === eyes
      ? { dir: head, confidence: 0.9, agreement: 'HEAD_AND_EYES' }
      : { dir: null, confidence: 0, agreement: 'NONE' }
  }
  if (head) {
    if (headStrong) return { dir: head, confidence: 0.85, agreement: 'HEAD_ONLY' }
    return { dir: head, confidence: eyesMeasured ? 0.55 : 0.6, agreement: 'HEAD_ONLY' }
  }
  if (eyes) return { dir: eyes, confidence: 0.5, agreement: 'EYES_ONLY' }
  return { dir: null, confidence: 0, agreement: 'NONE' }
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function fuseSignals(
  s: FrameSignals,
  b: Baseline,
  cfg: DetectionConfig = DETECTION_CONFIG,
  prev: FusedObservation | null = null
): FusedObservation {
  const none = { yaw: null, pitch: null, irisX: null, irisY: null }
  const make = (direction: GazeDirection, confidence: number): FusedObservation =>
    ({ direction, horizontal: null, vertical: null, confidence, agreement: 'NONE', deviation: none })

  if (s.faceCount === 0) return make('FACE_MISSING', 0.9)
  if (s.faceCount > 1) return make('MULTIPLE_FACES', 0.9)
  if (s.quality < cfg.quality.minQuality) return make('UNCERTAIN', 0)
  if (s.faceWidth !== null && s.faceWidth < cfg.quality.minFaceWidth) return make('UNCERTAIN', 0)

  const deviation = {
    yaw: s.yaw !== null ? s.yaw - b.yaw : null,
    pitch: s.pitch !== null ? s.pitch - b.pitch : null,
    irisX: s.irisX !== null && b.irisX !== null ? s.irisX - b.irisX : null,
    irisY: s.irisY !== null && b.irisY !== null ? s.irisY - b.irisY : null,
  }
  if (deviation.yaw === null && deviation.pitch === null && deviation.irisX === null && deviation.irisY === null) {
    return make('UNCERTAIN', 0)
  }

  // Hysteresis only on an axis already deviating, so a face at the boundary
  // does not flicker every frame.
  const hActive = prev !== null && prev.horizontal !== null
  const vActive = prev !== null && prev.vertical !== null
  const yawLimit = cfg.head.yawDeg - (hActive ? cfg.head.hysteresisDeg : 0)
  const irisXLimit = cfg.iris.xRatio - (hActive ? cfg.iris.hysteresisRatio : 0)
  const upLimit = cfg.head.pitchUpDeg - (vActive ? cfg.head.hysteresisDeg : 0)
  const downLimit = cfg.head.pitchDownDeg - (vActive ? cfg.head.hysteresisDeg : 0)
  const irisYLimit = cfg.iris.yRatio - (vActive ? cfg.iris.hysteresisRatio : 0)

  const dy = deviation.yaw
  const dp = deviation.pitch
  const dix = deviation.irisX
  const diy = deviation.irisY

  const headH = dy === null ? null : dy >= yawLimit ? 'RIGHT' : dy <= -yawLimit ? 'LEFT' : null
  const eyeH = dix === null ? null : dix >= irisXLimit ? 'RIGHT' : dix <= -irisXLimit ? 'LEFT' : null
  const headV = dp === null ? null : dp >= upLimit ? 'UP' : dp <= -downLimit ? 'DOWN' : null
  // Image y grows downward, so a positive vertical iris offset is the eyes lowering.
  const eyeV = diy === null ? null : diy >= irisYLimit ? 'DOWN' : diy <= -irisYLimit ? 'UP' : null

  const h = combine<'LEFT' | 'RIGHT'>(headH, eyeH, dix !== null, dy !== null && Math.abs(dy) >= cfg.head.strongYawDeg)
  const v = combine<'UP' | 'DOWN'>(headV, eyeV, diy !== null, false)

  // Downward attention first: it is the pattern this phase exists to catch,
  // and down-left must still count as downward. Horizontal beats up.
  let direction: GazeDirection = 'CENTER'
  let confidence = s.quality
  let agreement: Agreement = 'NONE'
  if (v.dir === 'DOWN') { direction = 'DOWN'; confidence = v.confidence; agreement = v.agreement }
  else if (h.dir) { direction = h.dir; confidence = h.confidence; agreement = h.agreement }
  else if (v.dir === 'UP') { direction = 'UP'; confidence = v.confidence; agreement = v.agreement }

  if (direction !== 'CENTER') {
    if (s.roll !== null && Math.abs(s.roll) > cfg.head.maxRollDeg) confidence *= 0.7
    confidence *= s.quality
  }

  return { direction, horizontal: h.dir, vertical: v.dir, confidence: round2(confidence), agreement, deviation }
}
