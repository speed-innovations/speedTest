import { describe, it, expect } from 'vitest'
import {
  extractFrameSignals, fuseSignals,
  type Baseline, type FrameSignals, type FusedObservation,
} from '@/lib/proctoring/client/gaze-classify'
import { DETECTION_CONFIG } from '@/lib/proctoring/client/detection-config'

/**
 * Pure signal extraction and fusion. Synthetic inputs prove the logic; only a
 * real face can prove the sign convention (Task 15's manual script).
 */

// ---- extraction fixtures ---------------------------------------------------

/** Column-major 4x4. Element (row r, col c) lives at data[c * 4 + r]. */
function matrix(axis: 'yaw' | 'pitch' | 'roll', deg: number): { data: number[] } {
  const t = (deg * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const d = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  if (axis === 'yaw') { d[0] = c; d[8] = s; d[2] = -s; d[10] = c }
  if (axis === 'pitch') { d[5] = c; d[9] = -s; d[6] = s; d[10] = c }
  if (axis === 'roll') { d[0] = c; d[4] = -s; d[1] = s; d[5] = c }
  return { data: d }
}

/** 478 points. Eyes 0.06 wide; iris displaced by (dx, dy) eye-widths. */
function landmarks(dx: number, dy: number, count = 478): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) pts.push({ x: 0.5, y: 0.5 })
  const set = (i: number, x: number, y: number) => { if (i < count) pts[i] = { x, y } }
  set(33, 0.40, 0.40); set(133, 0.46, 0.40)
  set(362, 0.54, 0.40); set(263, 0.60, 0.40)
  set(468, 0.43 + dx * 0.06, 0.40 + dy * 0.06)
  set(473, 0.57 + dx * 0.06, 0.40 + dy * 0.06)
  return pts
}

describe('extractFrameSignals', () => {
  it('0 faces: face count 0 and every reading null, never zero', () => {
    const s = extractFrameSignals({ faceLandmarks: [], facialTransformationMatrixes: [] })
    expect(s.faceCount).toBe(0)
    expect([s.yaw, s.pitch, s.roll, s.irisX, s.irisY, s.faceWidth]).toEqual([null, null, null, null, null, null])
  })

  it('2 faces: counts both and reads no direction', () => {
    const s = extractFrameSignals({ faceLandmarks: [landmarks(0, 0), landmarks(0, 0)] })
    expect(s.faceCount).toBe(2)
    expect(s.yaw).toBeNull()
  })

  it('1 face: recovers yaw, pitch and roll from the matrix', () => {
    const f = [landmarks(0, 0)]
    expect(extractFrameSignals({ faceLandmarks: f, facialTransformationMatrixes: [matrix('yaw', 20)] }).yaw).toBeCloseTo(20)
    expect(extractFrameSignals({ faceLandmarks: f, facialTransformationMatrixes: [matrix('pitch', -12)] }).pitch).toBeCloseTo(-12)
    expect(extractFrameSignals({ faceLandmarks: f, facialTransformationMatrixes: [matrix('roll', 30)] }).roll).toBeCloseTo(30)
  })

  it('normalises iris offset by each eye width, on both axes', () => {
    const s = extractFrameSignals({ faceLandmarks: [landmarks(0.25, -0.1)], facialTransformationMatrixes: [matrix('yaw', 0)] })
    expect(s.irisX).toBeCloseTo(0.25)
    expect(s.irisY).toBeCloseTo(-0.1)
    expect(s.faceWidth).toBeCloseTo(0.2)
  })

  it('missing iris landmarks give null, not 0, and lower quality', () => {
    const s = extractFrameSignals({ faceLandmarks: [landmarks(0, 0, 468)], facialTransformationMatrixes: [matrix('yaw', 0)] })
    expect(s.irisX).toBeNull()
    expect(s.irisY).toBeNull()
    expect(s.quality).toBeLessThan(1)
  })

  it('a degenerate matrix gives null pose rather than NaN', () => {
    const bad = { data: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, 0, 0, 0, 1] }
    const s = extractFrameSignals({ faceLandmarks: [landmarks(0, 0)], facialTransformationMatrixes: [bad] })
    expect(s.yaw).toBeNull()
    expect(s.pitch).toBeNull()
  })

  it('applies the configured sign convention', () => {
    const s = extractFrameSignals(
      { faceLandmarks: [landmarks(0.2, 0)], facialTransformationMatrixes: [matrix('yaw', 20)] },
      { yaw: -1, pitch: 1, irisX: -1, irisY: 1 }
    )
    expect(s.yaw).toBeCloseTo(-20)
    expect(s.irisX).toBeCloseTo(-0.2)
  })
})

// ---- fusion ----------------------------------------------------------------

const BASE: Baseline = { yaw: 3, pitch: -2, irisX: 0.01, irisY: 0.02 }

function frame(p: Partial<FrameSignals> = {}): FrameSignals {
  return { faceCount: 1, yaw: 3, pitch: -2, roll: 0, irisX: 0.01, irisY: 0.02, faceWidth: 0.2, quality: 1, ...p }
}

const fuse = (p: Partial<FrameSignals>, prev: FusedObservation | null = null) =>
  fuseSignals(frame(p), BASE, DETECTION_CONFIG, prev)

describe('fuseSignals: presence', () => {
  it('0 faces is FACE_MISSING', () => {
    expect(fuse({ faceCount: 0, yaw: null, pitch: null, irisX: null, irisY: null }).direction).toBe('FACE_MISSING')
  })
  it('2 faces is MULTIPLE_FACES', () => {
    expect(fuse({ faceCount: 2 }).direction).toBe('MULTIPLE_FACES')
  })
  it('1 face at baseline is CENTER', () => {
    const o = fuse({})
    expect(o.direction).toBe('CENTER')
    expect(o.horizontal).toBeNull()
    expect(o.vertical).toBeNull()
  })
})

describe('fuseSignals: personal baseline', () => {
  it('baseline yaw 3, current 5 is normal', () => {
    expect(fuse({ yaw: 5 }).direction).toBe('CENTER')
  })
  it('baseline yaw 3, current 28 with eyes the same way is a strong deviation', () => {
    const o = fuse({ yaw: 28, irisX: 0.21 })
    expect(o.direction).toBe('RIGHT')
    expect(o.agreement).toBe('HEAD_AND_EYES')
    expect(o.confidence).toBeGreaterThanOrEqual(DETECTION_CONFIG.strongConfidence)
  })
})

describe('fuseSignals: directions', () => {
  it('LEFT: head and eyes agree', () => {
    const o = fuse({ yaw: -20, irisX: -0.2 })
    expect(o.direction).toBe('LEFT')
    expect(o.confidence).toBeCloseTo(0.9)
  })
  it('UP', () => {
    expect(fuse({ pitch: 16, irisY: -0.12 }).direction).toBe('UP')
  })
  it('DOWN: head and eyes agree', () => {
    const o = fuse({ pitch: -20, irisY: 0.2 })
    expect(o.direction).toBe('DOWN')
    expect(o.agreement).toBe('HEAD_AND_EYES')
  })
  it('LEFT + DOWN reports DOWN and keeps the horizontal component', () => {
    const o = fuse({ yaw: -20, irisX: -0.2, pitch: -20, irisY: 0.2 })
    expect(o.direction).toBe('DOWN')
    expect(o.horizontal).toBe('LEFT')
    expect(o.vertical).toBe('DOWN')
  })
  it('RIGHT + DOWN reports DOWN with horizontal RIGHT', () => {
    const o = fuse({ yaw: 24, irisX: 0.2, pitch: -20, irisY: 0.2 })
    expect(o.direction).toBe('DOWN')
    expect(o.horizontal).toBe('RIGHT')
  })
  it('UP + LEFT reports LEFT: up is the least useful axis', () => {
    expect(fuse({ yaw: -20, irisX: -0.2, pitch: 18, irisY: -0.15 }).direction).toBe('LEFT')
  })
})

describe('fuseSignals: never a single signal', () => {
  it('head LEFT with eyes centred is only a weak/moderate signal', () => {
    const o = fuse({ yaw: -20 })
    expect(o.direction).toBe('LEFT')
    expect(o.agreement).toBe('HEAD_ONLY')
    expect(o.confidence).toBeLessThan(DETECTION_CONFIG.strongConfidence)
  })
  it('eyes alone are the weakest signal', () => {
    const o = fuse({ irisX: -0.19 })
    expect(o.direction).toBe('LEFT')
    expect(o.agreement).toBe('EYES_ONLY')
    expect(o.confidence).toBeLessThan(0.6)
  })
  it('head turned one way with eyes back on the screen is CENTER', () => {
    expect(fuse({ yaw: 25, irisX: -0.2 }).direction).toBe('CENTER')
  })
  it('a head turned far away is strong even without the eyes', () => {
    const o = fuse({ yaw: 42 })
    expect(o.direction).toBe('RIGHT')
    expect(o.confidence).toBeGreaterThanOrEqual(DETECTION_CONFIG.strongConfidence)
  })
})

describe('fuseSignals: missing and poor data', () => {
  it('missing iris is null in the deviation, never 0', () => {
    const o = fuse({ irisX: null, irisY: null })
    expect(o.direction).toBe('CENTER')
    expect(o.deviation.irisX).toBeNull()
    expect(o.deviation.irisY).toBeNull()
  })
  it('a baseline without iris ignores current iris rather than comparing to 0', () => {
    const o = fuseSignals(frame({ irisX: 0.3 }), { yaw: 3, pitch: -2, irisX: null, irisY: null })
    expect(o.direction).toBe('CENTER')
    expect(o.deviation.irisX).toBeNull()
  })
  it('head pose missing but iris present still classifies, as eyes only', () => {
    expect(fuse({ yaw: null, pitch: null, irisX: -0.2 }).agreement).toBe('EYES_ONLY')
  })
  it('UNKNOWN: nothing measurable', () => {
    expect(fuse({ yaw: null, pitch: null, irisX: null, irisY: null }).direction).toBe('UNCERTAIN')
  })
  it('UNKNOWN: low landmark quality', () => {
    expect(fuse({ quality: 0.3, yaw: -30 }).direction).toBe('UNCERTAIN')
  })
  it('UNKNOWN: face too small to trust', () => {
    expect(fuse({ faceWidth: 0.05, yaw: -30 }).direction).toBe('UNCERTAIN')
  })
  it('a heavily rolled head lowers confidence', () => {
    const upright = fuse({ yaw: -20, irisX: -0.2 }).confidence
    const rolled = fuse({ yaw: -20, irisX: -0.2, roll: 40 }).confidence
    expect(rolled).toBeLessThan(upright)
  })
})

describe('fuseSignals: hysteresis', () => {
  it('holds a direction just inside the threshold, but only once it is active', () => {
    const near = { yaw: -12, irisX: -0.13 } // dev -15 / -0.14: under entry limits, over exit limits
    expect(fuse(near).direction).toBe('CENTER')
    const prev = fuse({ yaw: -20, irisX: -0.2 })
    expect(fuse(near, prev).direction).toBe('LEFT')
  })
})
