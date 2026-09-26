import { describe, it, expect } from 'vitest'
import { BaselineCollector, median } from '@/lib/proctoring/client/baseline'
import { DETECTION_CONFIG } from '@/lib/proctoring/client/detection-config'
import type { FrameSignals } from '@/lib/proctoring/client/gaze-classify'

const face = (p: Partial<FrameSignals> = {}): FrameSignals =>
  ({ faceCount: 1, yaw: 3, pitch: -2, roll: 0, irisX: 0.01, irisY: 0.02, faceWidth: 0.2, quality: 1, ...p })

function collector() {
  return new BaselineCollector(DETECTION_CONFIG.baseline, DETECTION_CONFIG.quality.minQuality)
}

describe('median', () => {
  it('handles odd and even lengths without mutating the input', () => {
    const v = [5, 1, 3]
    expect(median(v)).toBe(3)
    expect(v).toEqual([5, 1, 3])
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('BaselineCollector', () => {
  it('waits for the full calibration window', () => {
    const c = collector()
    for (let t = 0; t < 3000; t += 100) expect(c.add(face(), t)).toBeNull()
  })

  it('takes the median, so one glance away during calibration does not skew it', () => {
    const c = collector()
    let b = null
    for (let t = 0; t <= 3000 && !b; t += 100) b = c.add(face({ yaw: t === 500 ? 40 : 3 }), t)
    expect(b).not.toBeNull()
    expect(b!.yaw).toBe(3)
    expect(b!.pitch).toBe(-2)
    expect(b!.irisX).toBeCloseTo(0.01)
  })

  it('ignores frames with no face, two faces or poor quality', () => {
    const c = collector()
    for (let t = 0; t <= 3000; t += 100) {
      c.add(face({ faceCount: 2 }), t)
      c.add(face({ faceCount: 0, yaw: null, pitch: null }), t)
      c.add(face({ quality: 0.2 }), t)
    }
    expect(c.sampleCount).toBe(0)
  })

  it('reports iris baseline as null when most calibration frames had none', () => {
    const c = collector()
    let b = null
    let i = 0
    for (let t = 0; t <= 3000 && !b; t += 100, i++) {
      b = c.add(face(i % 3 === 0 ? {} : { irisX: null, irisY: null }), t)
    }
    expect(b!.irisX).toBeNull()
    expect(b!.yaw).toBe(3)
  })

  it('falls back to a few samples at the long timeout', () => {
    const c = collector()
    let b = null
    for (let t = 0; t <= 10_000 && !b; t += 100) {
      b = c.add(t < 500 ? face() : face({ faceCount: 0, yaw: null, pitch: null }), t)
    }
    expect(b).not.toBeNull()
    expect(b!.yaw).toBe(3)
  })

  it('restarts, rather than calibrating on nothing, when the timeout passes empty', () => {
    const c = collector()
    for (let t = 0; t <= 10_000; t += 100) {
      expect(c.add(face({ faceCount: 0, yaw: null, pitch: null }), t)).toBeNull()
    }
    expect(c.sampleCount).toBe(0)
  })
})
