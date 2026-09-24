import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getProctoringConfig, resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * Proctoring config. Metadata-only since the live-monitoring phase: there is
 * no storage provider and no credential, so none may be required.
 */

const KEYS = [
  'PROCTORING_ENABLED', 'PROCTORING_OPERATIONAL', 'PROCTORING_RETENTION_HOURS',
  'PROCTORING_GAZE_WARNING_MS', 'PROCTORING_GAZE_WARNING_COOLDOWN_MS',
  'PROCTORING_FACE_MISSING_WARNING_MS', 'PROCTORING_MULTIPLE_FACES_WARNING_MS',
  'PROCTORING_SCREEN_REQUIRED', 'PROCTORING_HEARTBEAT_INTERVAL_MS', 'PROCTORING_STALE_SESSION_MS',
  'PROCTORING_STORAGE_PROVIDER', 'R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
]
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  KEYS.forEach(k => { saved[k] = process.env[k]; delete process.env[k] })
  resetProctoringConfigForTests()
})

afterEach(() => {
  KEYS.forEach(k => {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  })
  resetProctoringConfigForTests()
})

describe('getProctoringConfig', () => {
  it('defaults to disabled with the documented heartbeat and stale windows', () => {
    const c = getProctoringConfig()
    expect(c.enabled).toBe(false)
    expect(c.operational).toBe(true)
    expect(c.screenRequired).toBe(true)
    expect(c.retentionHours).toBe(72)
    expect(c.heartbeatIntervalMs).toBe(20_000)
    expect(c.staleSessionMs).toBe(180_000)
  })

  it('coerces numeric strings', () => {
    process.env.PROCTORING_HEARTBEAT_INTERVAL_MS = '15000'
    expect(getProctoringConfig().heartbeatIntervalMs).toBe(15_000)
  })

  it('treats "true" and "1" as true and everything else as false', () => {
    process.env.PROCTORING_ENABLED = '1'
    expect(getProctoringConfig().enabled).toBe(true)
    resetProctoringConfigForTests()
    process.env.PROCTORING_ENABLED = 'yes'
    expect(getProctoringConfig().enabled).toBe(false)
  })

  it('throws on an out-of-range value instead of using it', () => {
    process.env.PROCTORING_HEARTBEAT_INTERVAL_MS = '10'
    expect(() => getProctoringConfig()).toThrow(/PROCTORING_HEARTBEAT_INTERVAL_MS/)
  })

  it('throws on a non-numeric value instead of coercing to NaN', () => {
    process.env.PROCTORING_STALE_SESSION_MS = 'soon'
    expect(() => getProctoringConfig()).toThrow()
  })

  it('treats an empty string as unset', () => {
    process.env.PROCTORING_RETENTION_HOURS = ''
    expect(getProctoringConfig().retentionHours).toBe(72)
  })

  it('needs no storage provider or credentials, and ignores leftovers', () => {
    process.env.PROCTORING_ENABLED = 'true'
    process.env.PROCTORING_STORAGE_PROVIDER = 'r2' // stale value from an old .env
    const c = getProctoringConfig()
    expect(c.enabled).toBe(true)
    expect(Object.keys(c)).not.toContain('storageProvider')
    expect(Object.keys(c).join(',')).not.toMatch(/storage|bytes|r2/i)
  })
})
