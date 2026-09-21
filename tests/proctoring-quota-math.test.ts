import { describe, it, expect } from 'vitest'
import { estimateAttemptBytes, effectiveDurationMinutes } from '@/lib/proctoring/quota'
import { getProctoringConfig, resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * The estimate decides who is allowed to start. Too low and the budget is
 * overshot mid-cohort; too high and capacity is wasted against an already tight
 * ceiling. These numbers are checked against the PRD's worked example.
 */
describe('estimateAttemptBytes', () => {
  it('matches the worked arithmetic for a 60-minute attempt', () => {
    resetProctoringConfigForTests()
    // media:  3600s * (160000 + 32000) bits/s / 8 = 86,400,000 bytes
    // shots:  1 initial + 60 at one per minute = 61 * 100,000 = 6,100,000 bytes
    // total:  (86,400,000 + 6,100,000) * 1.2 = 111,000,000
    expect(estimateAttemptBytes(60)).toBe(111_000_000)
  })

  it('scales roughly with duration, allowing for the fixed initial screenshot', () => {
    // Not exactly half: the extra screenshot taken immediately after start is a
    // fixed cost that does not halve with the duration.
    const half = estimateAttemptBytes(30)
    const full = estimateAttemptBytes(60)
    expect(half).toBeGreaterThan(full / 2)
    expect(half).toBeLessThan(full / 2 + 200_000)
  })

  it('counts one screenshot per interval plus the initial one', () => {
    // A 1-minute attempt: the immediate screenshot plus one at the 60s mark.
    const cfg = getProctoringConfig()
    const video = Math.round((60 * (cfg.videoBitsPerSecond + cfg.audioBitsPerSecond)) / 8)
    const shots = 2 * cfg.estimatedScreenshotBytes
    expect(estimateAttemptBytes(1)).toBe(Math.round((video + shots) * cfg.safetyMultiplier))
  })

  it('never returns zero or a negative for a degenerate duration', () => {
    expect(estimateAttemptBytes(0)).toBeGreaterThan(0)
    expect(estimateAttemptBytes(-5)).toBeGreaterThan(0)
  })
})

describe('effectiveDurationMinutes', () => {
  it('uses the test duration when it is within the hard maximum', () => {
    expect(effectiveDurationMinutes(60)).toBe(60)
  })

  it('clamps to the configured hard maximum', () => {
    // A misconfigured 10-hour test must not reserve 10 hours of storage.
    expect(effectiveDurationMinutes(600)).toBe(getProctoringConfig().maxDurationMinutes)
  })

  it('floors a nonsensical duration at 1 minute', () => {
    expect(effectiveDurationMinutes(0)).toBe(1)
    expect(effectiveDurationMinutes(-1)).toBe(1)
  })
})
