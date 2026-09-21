import { describe, it, expect } from 'vitest'
import { classifyGaze } from '@/lib/proctoring/client/gaze-classify'

/**
 * The classification math is the part of proctoring most likely to be wrong,
 * and the part a reviewer is implicitly asked to trust when they look at a
 * candidate's evidence. It is pure, so it is pinned here with synthetic signals
 * - no browser, no WASM, no camera.
 */

const T = { yawDeg: 18, pitchDeg: 15, irisRatio: 0.28, hysteresisDeg: 5 }
const B = { yaw: 0, pitch: 0 }
const sig = (yaw: number, pitch = 0, iris: number | null = null, faceCount = 1) =>
  ({ yaw, pitch, irisOffsetX: iris, faceCount })

describe('classifyGaze', () => {
  it('calls a centred face CENTER', () => {
    expect(classifyGaze(sig(0), B, T, 'CENTER')).toBe('CENTER')
    expect(classifyGaze(sig(10), B, T, 'CENTER')).toBe('CENTER')
  })

  it('classifies sustained head turn past the threshold', () => {
    expect(classifyGaze(sig(25), B, T, 'CENTER')).toBe('RIGHT')
    expect(classifyGaze(sig(-25), B, T, 'CENTER')).toBe('LEFT')
  })

  it('applies hysteresis so a face hovering at the threshold does not flicker', () => {
    // Already RIGHT: it takes dropping below (threshold - hysteresis) to return.
    expect(classifyGaze(sig(15), B, T, 'RIGHT')).toBe('RIGHT')
    expect(classifyGaze(sig(12), B, T, 'RIGHT')).toBe('CENTER')
    // From CENTER, 15 is not enough to trigger.
    expect(classifyGaze(sig(15), B, T, 'CENTER')).toBe('CENTER')
  })

  it('measures against the baseline, not absolute zero', () => {
    // A candidate whose camera sits off to one side reads 20 while looking straight on.
    const offset = { yaw: 20, pitch: 0 }
    expect(classifyGaze(sig(20), offset, T, 'CENTER')).toBe('CENTER')
    expect(classifyGaze(sig(45), offset, T, 'CENTER')).toBe('RIGHT')
  })

  it('reports vertical deviation', () => {
    expect(classifyGaze(sig(0, 22), B, T, 'CENTER')).toBe('UP')
    expect(classifyGaze(sig(0, -22), B, T, 'CENTER')).toBe('DOWN')
  })

  it('prefers the horizontal reading when both axes exceed threshold', () => {
    // Looking down-left at a phone reads as LEFT, which is the more useful signal.
    expect(classifyGaze(sig(-30, -30), B, T, 'CENTER')).toBe('LEFT')
  })

  it('reports face presence problems before direction', () => {
    expect(classifyGaze(sig(0, 0, null, 0), B, T, 'CENTER')).toBe('FACE_NOT_DETECTED')
    expect(classifyGaze(sig(40, 0, null, 2), B, T, 'CENTER')).toBe('MULTIPLE_FACES')
  })

  it('combines iris offset with head pose rather than relying on head alone', () => {
    // Head near-centre but eyes hard over: still a deviation.
    expect(classifyGaze(sig(8, 0, 0.45), B, T, 'CENTER')).toBe('RIGHT')
    // Head near-centre, eyes centred: not a deviation.
    expect(classifyGaze(sig(8, 0, 0.05), B, T, 'CENTER')).toBe('CENTER')
  })

  it('reads a hard iris offset to the left as LEFT', () => {
    expect(classifyGaze(sig(-8, 0, -0.45), B, T, 'CENTER')).toBe('LEFT')
  })

  it('does not let a missing iris reading suppress a clear head turn', () => {
    // irisOffsetX is null whenever the model returned no iris landmarks; head
    // pose alone must still be enough.
    expect(classifyGaze(sig(30, 0, null), B, T, 'CENTER')).toBe('RIGHT')
  })

  it('treats a non-finite signal as UNCERTAIN rather than guessing', () => {
    // A degenerate transformation matrix yields NaN. Classifying that as CENTER
    // would silently stop detection; as LEFT it would fabricate evidence.
    expect(classifyGaze(sig(NaN), B, T, 'CENTER')).toBe('UNCERTAIN')
    expect(classifyGaze(sig(0, NaN), B, T, 'CENTER')).toBe('UNCERTAIN')
  })
})
