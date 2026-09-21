import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockStorage } from '@/lib/proctoring/storage/mock'
import { webcamSegmentKey, screenshotKey } from '@/lib/proctoring/storage/keys'
import { getStorage, resetStorageForTests } from '@/lib/proctoring/storage'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * MockStorage is what every backend test runs against, so its contract has to
 * match the one the routes rely on: absent reads as null, deletes are
 * idempotent, and nothing outside the proctoring prefix can be touched.
 */
describe('MockStorage', () => {
  let s: MockStorage
  const key = webcamSegmentKey('sess1', 1)
  beforeEach(() => { s = new MockStorage() })

  it('returns null for an object that was never uploaded', async () => {
    expect(await s.getObjectMetadata(key)).toBeNull()
  })

  it('returns the recorded size and type once uploaded', async () => {
    s.putForTest(key, 1234, 'video/webm')
    expect(await s.getObjectMetadata(key)).toEqual({ byteSize: 1234, contentType: 'video/webm' })
  })

  it('records what was signed, including the TTL', async () => {
    await s.createUploadUrl(key, 'video/webm', 300)
    expect(s.signedUploads).toEqual([{ key, contentType: 'video/webm', ttlSeconds: 300 }])
  })

  it('deletes idempotently - a second delete is not an error', async () => {
    s.putForTest(key, 10, 'video/webm')
    await s.deleteObject(key)
    await s.deleteObject(key)
    expect(s.has(key)).toBe(false)
  })

  it('refuses any key outside the proctoring prefix', async () => {
    await expect(s.createUploadUrl('elsewhere/x.webm', 'video/webm', 60)).rejects.toThrow(/non-proctoring key/)
    await expect(s.deleteObject('../secrets')).rejects.toThrow(/non-proctoring key/)
  })

  it('keeps webcam and screenshot sequences in separate namespaces', async () => {
    expect(webcamSegmentKey('s', 1)).not.toBe(screenshotKey('s', 1, 'webp'))
  })
})

/**
 * Provider selection. The case that matters is the one that must NOT happen:
 * a deployment selecting r2 without credentials must fail loudly rather than
 * quietly accepting evidence into a Map that dies with the process.
 */
describe('getStorage', () => {
  const saved = { ...process.env }

  beforeEach(() => { resetStorageForTests(); resetProctoringConfigForTests() })
  afterEach(() => {
    process.env = { ...saved }
    resetStorageForTests()
    resetProctoringConfigForTests()
  })

  it('returns the mock provider by default', () => {
    delete process.env.PROCTORING_STORAGE_PROVIDER
    expect(getStorage()).toBeInstanceOf(MockStorage)
  })

  it('memoises, so every caller shares one instance', () => {
    delete process.env.PROCTORING_STORAGE_PROVIDER
    expect(getStorage()).toBe(getStorage())
  })

  it('throws rather than falling back to mock when r2 is selected but unset', () => {
    process.env.PROCTORING_STORAGE_PROVIDER = 'r2'
    delete process.env.R2_ACCOUNT_ID
    delete process.env.R2_BUCKET_NAME
    delete process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_SECRET_ACCESS_KEY
    expect(() => getStorage()).toThrow(/not configured/)
  })
})
