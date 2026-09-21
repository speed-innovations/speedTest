import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getProctoringConfig, getR2Config, resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * Configuration is the first thing every other module reads. A silently wrong
 * byte budget or threshold would not surface until a candidate is mid-assessment,
 * so the coercion and the bounds are locked here.
 */

const saved = { ...process.env }

beforeEach(() => { resetProctoringConfigForTests() })
afterEach(() => { process.env = { ...saved }; resetProctoringConfigForTests() })

describe('getProctoringConfig', () => {
  it('defaults to disabled, mock storage, and the PRD thresholds', () => {
    delete process.env.PROCTORING_ENABLED
    delete process.env.PROCTORING_STORAGE_PROVIDER
    delete process.env.PROCTORING_GAZE_WARNING_MS
    const c = getProctoringConfig()
    expect(c.enabled).toBe(false)
    expect(c.storageProvider).toBe('mock')
    expect(c.gazeWarningMs).toBe(1500)
    expect(c.gazeWarningCooldownMs).toBe(10_000)
    expect(c.retentionHours).toBe(72)
    expect(c.storageSafetyBytes).toBe(7_000_000_000)
  })

  it('coerces numeric strings rather than leaving them as strings', () => {
    process.env.PROCTORING_GAZE_WARNING_MS = '2500'
    const c = getProctoringConfig()
    expect(c.gazeWarningMs).toBe(2500)
    expect(typeof c.gazeWarningMs).toBe('number')
  })

  it('converts the safety multiplier from percent to a factor', () => {
    process.env.PROCTORING_SAFETY_MULTIPLIER_PCT = '150'
    expect(getProctoringConfig().safetyMultiplier).toBe(1.5)
  })

  it('treats "true" and "1" as true and everything else as false', () => {
    process.env.PROCTORING_ENABLED = '1'
    expect(getProctoringConfig().enabled).toBe(true)
    resetProctoringConfigForTests()
    process.env.PROCTORING_ENABLED = 'no'
    expect(getProctoringConfig().enabled).toBe(false)
  })

  it('throws on an out-of-range value instead of using it', () => {
    // A 10ms gaze threshold would fire a warning on every frame.
    process.env.PROCTORING_GAZE_WARNING_MS = '10'
    expect(() => getProctoringConfig()).toThrow(/Invalid proctoring configuration/)
  })

  it('throws on a non-numeric value instead of coercing to NaN', () => {
    process.env.PROCTORING_RETENTION_HOURS = 'seventy-two'
    expect(() => getProctoringConfig()).toThrow(/Invalid proctoring configuration/)
  })

  it('treats an empty string as unset, since .env placeholders load as ""', () => {
    process.env.PROCTORING_RETENTION_HOURS = ''
    process.env.PROCTORING_ENABLED = ''
    const c = getProctoringConfig()
    expect(c.retentionHours).toBe(72)
    expect(c.enabled).toBe(false)
  })
})

describe('getR2Config', () => {
  it('throws when credentials are missing, rather than falling back', () => {
    delete process.env.R2_ACCOUNT_ID
    delete process.env.R2_BUCKET_NAME
    delete process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_SECRET_ACCESS_KEY
    expect(() => getR2Config()).toThrow(/not configured/)
  })

  it('derives the endpoint from the account id when none is given', () => {
    process.env.R2_ACCOUNT_ID = 'abc123'
    process.env.R2_BUCKET_NAME = 'bucket'
    process.env.R2_ACCESS_KEY_ID = 'key'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    delete process.env.R2_ENDPOINT
    expect(getR2Config().endpoint).toBe('https://abc123.r2.cloudflarestorage.com')
  })

  it('derives the endpoint when R2_ENDPOINT is an empty placeholder', () => {
    process.env.R2_ACCOUNT_ID = 'abc123'
    process.env.R2_BUCKET_NAME = 'bucket'
    process.env.R2_ACCESS_KEY_ID = 'key'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    process.env.R2_ENDPOINT = ''
    expect(getR2Config().endpoint).toBe('https://abc123.r2.cloudflarestorage.com')
  })
})
