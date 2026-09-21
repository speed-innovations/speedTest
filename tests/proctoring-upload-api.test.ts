import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { issueUploadUrl, completeAsset, issueDownloadUrl } from '@/lib/proctoring/upload'
import { getStorage, resetStorageForTests, MockStorage } from '@/lib/proctoring/storage'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * Upload issuance and verification, against MockStorage and a real database.
 *
 * The rule under test throughout: the server decides the key, the permitted
 * content type, and the recorded size. The client's only contribution that
 * reaches storage is a sequence number.
 */

const TAG = `upload-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
let attemptId = ''
let sessionId = ''
let retentionExpiresAt = new Date()
const userIds: string[] = []

let storage: MockStorage

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id
  const test = await prisma.test.create({
    data: {
      title: `${TAG}-test`,
      durationMinutes: 60,
      proctoringEnabled: true,
      assessmentConfig: [{ area: 'APTITUDE', count: 1 }],
    },
  })
  testId = test.id
  const schedule = await prisma.testSchedule.create({
    data: {
      testId,
      collegeId,
      scheduledAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
    },
  })
  scheduleId = schedule.id

  const user = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: TAG, password: 'x', role: 'STUDENT' },
  })
  userIds.push(user.id)
  const profile = await prisma.studentProfile.create({
    data: { userId: user.id, collegeId, fullName: TAG, email: `${TAG}@example.test` },
  })
  const attempt = await prisma.testAttempt.create({
    data: { scheduleId, studentId: profile.id, userId: user.id, questionIds: ['q1'] },
  })
  attemptId = attempt.id

  retentionExpiresAt = new Date(Date.now() + 72 * 3_600_000)
  const session = await prisma.proctoringSession.create({
    data: {
      testAttemptId: attemptId,
      status: 'ACTIVE',
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      retentionExpiresAt,
      storageReservedBytes: 111_000_000,
    },
  })
  sessionId = session.id
})

afterAll(async () => {
  await prisma.proctoringAsset.deleteMany({ where: { proctoringSessionId: sessionId } })
  await prisma.proctoringSession.deleteMany({ where: { id: sessionId } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(async () => {
  process.env.PROCTORING_STORAGE_PROVIDER = 'mock'
  resetProctoringConfigForTests()
  resetStorageForTests()
  storage = getStorage() as MockStorage
  storage.clear()
  // Each test starts from a clean asset ledger for this session.
  await prisma.proctoringAsset.deleteMany({ where: { proctoringSessionId: sessionId } })
  await prisma.proctoringSession.update({
    where: { id: sessionId },
    data: { storageUsedBytes: 0, storageReservedBytes: 111_000_000 },
  })
})

const shot = (sequence = 1, contentType = 'image/webp') => ({
  sessionId,
  type: 'SCREENSHOT' as const,
  sequence,
  contentType,
  capturedAt: new Date(),
  retentionExpiresAt,
})

describe('issueUploadUrl', () => {
  it('signs a URL and creates a PENDING asset the server named', async () => {
    const issued = await issueUploadUrl(shot(1))
    expect(issued.uploadUrl).toContain('mock.invalid')
    expect(issued.objectKey).toBe(`assessment-proctoring/${sessionId}/screen/000001.webp`)
    const row = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: issued.assetId } })
    expect(row.status).toBe('PENDING')
    expect(row.byteSize).toBe(0)
    expect(storage.signedUploads).toHaveLength(1)
  })

  it('is idempotent on (session, type, sequence) - no duplicate asset', async () => {
    const first = await issueUploadUrl(shot(1))
    const second = await issueUploadUrl(shot(1))
    expect(second.assetId).toBe(first.assetId)
    const count = await prisma.proctoringAsset.count({ where: { proctoringSessionId: sessionId } })
    expect(count).toBe(1)
  })

  it('keeps webcam and screenshot sequence 1 as separate assets', async () => {
    const a = await issueUploadUrl(shot(1))
    const b = await issueUploadUrl({
      sessionId, type: 'WEBCAM_SEGMENT', sequence: 1,
      contentType: 'video/webm', capturedAt: new Date(), retentionExpiresAt,
    })
    expect(b.assetId).not.toBe(a.assetId)
    expect(b.objectKey).toContain('/webcam/')
  })

  it('refuses a content type outside the allow-list, per asset type', async () => {
    // An image content type on a video asset, and vice versa.
    await expect(issueUploadUrl(shot(1, 'application/zip'))).rejects.toMatchObject({ status: 400 })
    await expect(issueUploadUrl(shot(1, 'video/webm'))).rejects.toMatchObject({ status: 400 })
    await expect(issueUploadUrl({
      sessionId, type: 'WEBCAM_SEGMENT', sequence: 1,
      contentType: 'image/webp', capturedAt: new Date(), retentionExpiresAt,
    })).rejects.toMatchObject({ status: 400 })
  })

  it('accepts a webm content type carrying codec parameters', async () => {
    const issued = await issueUploadUrl({
      sessionId, type: 'WEBCAM_SEGMENT', sequence: 2,
      contentType: 'video/webm;codecs=vp9,opus', capturedAt: new Date(), retentionExpiresAt,
    })
    expect(issued.objectKey).toBe(`assessment-proctoring/${sessionId}/webcam/000002.webm`)
  })

  it('refuses re-issuing for an already UPLOADED asset', async () => {
    const issued = await issueUploadUrl(shot(1))
    storage.putForTest(issued.objectKey, 50_000, 'image/webp')
    await completeAsset(issued.assetId, sessionId)
    await expect(issueUploadUrl(shot(1))).rejects.toMatchObject({ status: 409 })
  })

  it('refuses when the session is far past its reservation', async () => {
    await prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { storageReservedBytes: 1_000_000, storageUsedBytes: 2_000_000 },
    })
    await expect(issueUploadUrl(shot(1))).rejects.toMatchObject({
      status: 409,
      message: 'PROCTORING_SESSION_STORAGE_EXCEEDED',
    })
    expect(storage.signedUploads).toHaveLength(0)
  })
})

describe('completeAsset', () => {
  it('records the size storage reports and increments the session counter', async () => {
    const issued = await issueUploadUrl(shot(1))
    storage.putForTest(issued.objectKey, 54_321, 'image/webp')
    const done = await completeAsset(issued.assetId, sessionId)
    expect(done.byteSize).toBe(54_321)
    expect(done.status).toBe('UPLOADED')
    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(s.storageUsedBytes).toBe(54_321)
  })

  it('is idempotent - a second completion does not double-count', async () => {
    const issued = await issueUploadUrl(shot(1))
    storage.putForTest(issued.objectKey, 10_000, 'image/webp')
    await completeAsset(issued.assetId, sessionId)
    const again = await completeAsset(issued.assetId, sessionId)
    expect(again.byteSize).toBe(10_000)
    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(s.storageUsedBytes).toBe(10_000)
  })

  it('marks FAILED and throws when the object never arrived in storage', async () => {
    const issued = await issueUploadUrl(shot(1))
    // Nothing put into storage - the browser's PUT failed silently.
    await expect(completeAsset(issued.assetId, sessionId)).rejects.toMatchObject({ status: 409 })
    const row = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: issued.assetId } })
    expect(row.status).toBe('FAILED')
  })

  it('records the size storage reports, not the one a client might claim', async () => {
    const issued = await issueUploadUrl(shot(1))
    // The client "claimed" 40 KB when asking for the URL; it uploaded 400 MB.
    // Nothing in the request carries a size, so only HeadObject can catch this.
    storage.putForTest(issued.objectKey, 400_000_000, 'image/webp')
    await expect(completeAsset(issued.assetId, sessionId)).rejects.toMatchObject({ status: 413 })
    expect(storage.has(issued.objectKey)).toBe(false) // deleted, not merely rejected
    const row = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: issued.assetId } })
    expect(row.status).toBe('FAILED')
    expect(row.byteSize).toBe(0)
    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(s.storageUsedBytes).toBe(0) // an oversize object never counts
  })

  it('refuses an asset belonging to a different session', async () => {
    const issued = await issueUploadUrl(shot(1))
    await expect(completeAsset(issued.assetId, 'some-other-session')).rejects.toMatchObject({ status: 404 })
  })
})

describe('issueDownloadUrl', () => {
  it('returns a URL for an UPLOADED, unexpired asset', async () => {
    const issued = await issueUploadUrl(shot(1))
    storage.putForTest(issued.objectKey, 1_000, 'image/webp')
    await completeAsset(issued.assetId, sessionId)
    const url = await issueDownloadUrl(issued.assetId)
    expect(url).toContain('mock.invalid/download')
    expect(storage.signedDownloads[0].ttlSeconds).toBe(900)
  })

  it('refuses a PENDING asset with 409', async () => {
    const issued = await issueUploadUrl(shot(1))
    await expect(issueDownloadUrl(issued.assetId)).rejects.toMatchObject({ status: 409 })
  })

  it('refuses an expired asset with 410 and flips its status to EXPIRED', async () => {
    const issued = await issueUploadUrl(shot(1))
    storage.putForTest(issued.objectKey, 1_000, 'image/webp')
    await completeAsset(issued.assetId, sessionId)
    // Past retention. R2's lifecycle rule may not have removed the bytes yet -
    // the application's clock is what governs access, not the store's.
    await prisma.proctoringAsset.update({
      where: { id: issued.assetId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    await expect(issueDownloadUrl(issued.assetId)).rejects.toMatchObject({ status: 410 })
    const row = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: issued.assetId } })
    expect(row.status).toBe('EXPIRED')
    expect(storage.signedDownloads).toHaveLength(0)
  })

  it('refuses an unknown asset id with 404', async () => {
    await expect(issueDownloadUrl('no-such-asset')).rejects.toMatchObject({ status: 404 })
  })
})
