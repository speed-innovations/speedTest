import { describe, it, expect } from 'vitest'
import { computeReviewSignal } from '@/lib/proctoring/review-signal'

const e = (type: string, durationMs: number | null = null) => ({ type, durationMs })
const many = (n: number, type: string, d: number | null = null) => Array.from({ length: n }, () => e(type, d))

describe('computeReviewSignal', () => {
  it('is named as a review prompt, never a verdict', () => {
    const s = computeReviewSignal(many(3, 'MULTIPLE_FACES').concat(many(3, 'SCREEN_SHARE_INTERRUPTED')))
    expect(s.name).toBe('PROCTORING_REVIEW_SIGNAL')
    expect(JSON.stringify(s)).not.toMatch(/cheat|confirmed|guilty|fail/i)
  })

  it('nothing observed is NONE', () => {
    expect(computeReviewSignal([]).level).toBe('NONE')
  })

  it('one brief glance is negligible', () => {
    expect(computeReviewSignal([e('LOOKING_LEFT', 1900)]).level).toBe('NONE')
  })

  it('window blur alone never raises the signal', () => {
    expect(computeReviewSignal(many(50, 'WINDOW_BLUR')).level).toBe('NONE')
  })

  it('many glances add up only to LOW', () => {
    expect(computeReviewSignal(many(40, 'LOOKING_DOWN', 3000)).level).toBe('LOW')
  })

  it('repeated downward attention is a moderate observation', () => {
    const s = computeReviewSignal([e('REPEATED_DOWNWARD_ATTENTION', 12_000)])
    expect(s.level).toBe('LOW')
    expect(s.contributions[0]).toMatchObject({ group: 'REPEATED_DOWNWARD_ATTENTION', strength: 'MODERATE' })
  })

  it('long face absence is strong; a brief one is weak', () => {
    expect(computeReviewSignal([e('FACE_MISSING', 12_000)]).contributions[0].strength).toBe('STRONG')
    expect(computeReviewSignal([e('FACE_MISSING', 2500)]).contributions[0].strength).toBe('WEAK')
  })

  it('one kind of observation alone, however often, stops at MODERATE', () => {
    const s = computeReviewSignal(many(10, 'MULTIPLE_FACES'))
    expect(s.score).toBeGreaterThanOrEqual(8)
    expect(s.level).toBe('MODERATE')
  })

  it('strong observations of different kinds together reach ELEVATED', () => {
    const s = computeReviewSignal([e('MULTIPLE_FACES'), e('SCREEN_SHARE_INTERRUPTED'), e('SCREEN_SHARE_INTERRUPTED')])
    expect(s.level).toBe('ELEVATED')
  })

  it('caps each group so one noisy type cannot dominate', () => {
    const s = computeReviewSignal(many(100, 'TAB_HIDDEN'))
    expect(s.contributions[0].points).toBeLessThanOrEqual(5)
    expect(s.contributions[0].count).toBe(100)
  })

  it('ignores types it does not weigh, such as lifecycle events', () => {
    expect(computeReviewSignal([e('PROCTORING_STARTED'), e('PROCTORING_ENDED'), e('TAB_VISIBLE')]).contributions).toEqual([])
  })
})
