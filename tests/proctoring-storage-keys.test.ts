import { describe, it, expect } from 'vitest'
import { webcamSegmentKey, screenshotKey, isProctoringKey, PROCTORING_PREFIX } from '@/lib/proctoring/storage/keys'

/**
 * Object keys are security surface, not cosmetics. They must carry no personal
 * data, and they must be impossible to steer out of the proctoring prefix - a
 * caller-supplied "../" or an absolute path would otherwise let a crafted
 * request sign a URL for an unrelated object.
 */
describe('object keys', () => {
  it('zero-pads the sequence so lexical order matches capture order', () => {
    expect(webcamSegmentKey('sess1', 1)).toBe('assessment-proctoring/sess1/webcam/000001.webm')
    expect(webcamSegmentKey('sess1', 42)).toBe('assessment-proctoring/sess1/webcam/000042.webm')
  })

  it('orders 2 before 10 lexically', () => {
    const keys = [webcamSegmentKey('s', 10), webcamSegmentKey('s', 2)].sort()
    expect(keys[0]).toContain('000002')
  })

  it('builds screenshot keys with the chosen extension', () => {
    expect(screenshotKey('sess1', 3, 'webp')).toBe('assessment-proctoring/sess1/screen/000003.webp')
    expect(screenshotKey('sess1', 3, 'jpg')).toBe('assessment-proctoring/sess1/screen/000003.jpg')
  })

  it('rejects a session id that could escape the prefix', () => {
    expect(() => webcamSegmentKey('../../etc/passwd', 1)).toThrow(/session id/i)
    expect(() => webcamSegmentKey('a/b', 1)).toThrow(/session id/i)
    expect(() => webcamSegmentKey('', 1)).toThrow(/session id/i)
  })

  it('rejects a sequence that is not a positive integer', () => {
    expect(() => webcamSegmentKey('sess1', 0)).toThrow(/sequence/i)
    expect(() => webcamSegmentKey('sess1', -1)).toThrow(/sequence/i)
    expect(() => webcamSegmentKey('sess1', 1.5)).toThrow(/sequence/i)
    expect(() => webcamSegmentKey('sess1', 1_000_000)).toThrow(/sequence/i)
  })

  it('recognises only keys inside the proctoring prefix', () => {
    expect(isProctoringKey(webcamSegmentKey('s', 1))).toBe(true)
    expect(isProctoringKey('other/thing.webm')).toBe(false)
    expect(isProctoringKey('/assessment-proctoring/s/webcam/000001.webm')).toBe(false)
  })

  it('exposes the prefix used by the R2 lifecycle rule', () => {
    // The lifecycle rule is configured against this literal string. If it
    // changes, the rule stops matching and objects are never deleted.
    expect(PROCTORING_PREFIX).toBe('assessment-proctoring/')
  })
})
