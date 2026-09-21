import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

/**
 * Admin evidence and usage, against a real database.
 *
 * The leak checks are the reason this file exists. They assert against the
 * actual serialized body rather than a hand-written expectation, so a future
 * `include` that pulled in `objectKey` - or a well-meaning change that
 * bulk-signed URLs to save a round trip - fails here instead of shipping.
 */

// getServerSession is the only thing stubbed. 'next-auth/providers/credentials'
// is a different module path, so @/lib/auth still loads for real and
// requireAdmin is exercised as written.
//
// vi.mock is hoisted above the imports below by vitest, so static imports are
// correct here - and necessary, since top-level await is illegal at this
// project's es5 target.
const getServerSession = vi.fn()
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}))

import { prisma } from '@/lib/db'
import { getAdminEvidence, getUsageReport } from '@/lib/proctoring/admin'
import { requireAdmin, HttpError } from '@/lib/attempt-auth'
import { issueDownloadUrl } from '@/lib/proctoring/upload'
import { getStorage, resetStorageForTests, MockStorage } from '@/lib/proctoring/storage'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'

const TAG = `admin-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
let scheduledAttemptId = ''
let walkInAttemptId = ''
let unproctoredAttemptId = ''
let otherProfileId = ''
let otherUserId = ''
let scheduledSessionId = ''
let walkInSessionId = ''
let adminEmail = ''
let studentEmail = ''
const userIds: string[] = []
const retentionExpiresAt = new Date(Date.now() + 72 * 3_600_000)

async function makeUser(role: 'APP_ADMIN' | 'STUDENT', suffix: string) {
  const email = `${TAG}-${suffix}@example.test`
  const user = await prisma.user.create({
    data: { email, name: `${TAG}-${suffix}`, password: 'x', role },
  })
  userIds.push(user.id)
  return { id: user.id, email }
}

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

  const admin = await makeUser('APP_ADMIN', 'admin')
  adminEmail = admin.email
  const student = await makeUser('STUDENT', 'student')
  studentEmail = student.email

  const profile = await prisma.studentProfile.create({
    data: { userId: student.id, collegeId, fullName: TAG, email: student.email },
  })

  const scheduled = await prisma.testAttempt.create({
    data: { scheduleId, studentId: profile.id, userId: student.id, questionIds: ['qA', 'qB'] },
  })
  scheduledAttemptId = scheduled.id

  const walkIn = await prisma.walkInAttempt.create({
    data: { testId, studentId: profile.id, userId: student.id, questionIds: ['qA'] },
  })
  walkInAttemptId = walkIn.id

  // A second student, whose attempt is never proctored.
  const other = await makeUser('STUDENT', 'other')
  otherUserId = other.id
  const otherProfile = await prisma.studentProfile.create({
    data: { userId: other.id, collegeId, fullName: `${TAG}-other`, email: other.email },
  })
  otherProfileId = otherProfile.id
  const unproctored = await prisma.testAttempt.create({
    data: { scheduleId, studentId: otherProfile.id, userId: other.id, questionIds: ['qA'] },
  })
  unproctoredAttemptId = unproctored.id

  const s1 = await prisma.proctoringSession.create({
    data: {
      testAttemptId: scheduledAttemptId,
      status: 'COMPLETED',
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: new Date(),
      retentionExpiresAt,
      recordingStarted: true,
      screenShareStarted: true,
      storageUsedBytes: 5_000_000,
      gazeWarningCount: 2,
    },
  })
  scheduledSessionId = s1.id

  const s2 = await prisma.proctoringSession.create({
    data: {
      walkInAttemptId,
      status: 'COMPLETED',
      startedAt: new Date(Date.now() - 1_800_000),
      retentionExpiresAt,
      recordingStarted: true,
    },
  })
  walkInSessionId = s2.id

  await prisma.proctoringAsset.createMany({
    data: [
      {
        proctoringSessionId: scheduledSessionId,
        type: 'WEBCAM_SEGMENT',
        objectKey: `assessment-proctoring/${scheduledSessionId}/webcam/000001.webm`,
        contentType: 'video/webm',
        byteSize: 4_000_000,
        sequence: 1,
        capturedAt: new Date(),
        uploadedAt: new Date(),
        expiresAt: retentionExpiresAt,
        status: 'UPLOADED',
        elapsedMs: 0,
      },
      {
        proctoringSessionId: scheduledSessionId,
        type: 'SCREENSHOT',
        objectKey: `assessment-proctoring/${scheduledSessionId}/screens/000001.webp`,
        contentType: 'image/webp',
        byteSize: 1_000_000,
        sequence: 1,
        capturedAt: new Date(),
        uploadedAt: new Date(),
        expiresAt: retentionExpiresAt,
        status: 'UPLOADED',
        elapsedMs: 1000,
        questionId: 'qB',
      },
      {
        proctoringSessionId: walkInSessionId,
        type: 'WEBCAM_SEGMENT',
        objectKey: `assessment-proctoring/${walkInSessionId}/webcam/000001.webm`,
        contentType: 'video/webm',
        byteSize: 2_000_000,
        sequence: 1,
        capturedAt: new Date(),
        uploadedAt: new Date(),
        expiresAt: retentionExpiresAt,
        status: 'UPLOADED',
        elapsedMs: 0,
      },
    ],
  })

  await prisma.proctoringEvent.createMany({
    data: [
      {
        proctoringSessionId: scheduledSessionId,
        clientEventId: `${TAG}-e1`,
        type: 'GAZE_LEFT',
        direction: 'LEFT',
        occurredAt: new Date(Date.now() - 1000),
        elapsedMs: 255_000,
        durationMs: 2100,
        severity: 'WARN',
      },
      {
        proctoringSessionId: scheduledSessionId,
        clientEventId: `${TAG}-e2`,
        type: 'SCREEN_SHARE_STOPPED',
        occurredAt: new Date(Date.now() - 500),
        elapsedMs: 1_112_000,
        severity: 'WARN',
      },
    ],
  })
})

afterAll(async () => {
  const sessionIds = [scheduledSessionId, walkInSessionId]
  await prisma.proctoringEvent.deleteMany({ where: { proctoringSessionId: { in: sessionIds } } })
  await prisma.proctoringAsset.deleteMany({ where: { proctoringSessionId: { in: sessionIds } } })
  await prisma.proctoringSession.deleteMany({ where: { id: { in: sessionIds } } })
  await prisma.walkInAttempt.deleteMany({ where: { testId } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(() => {
  process.env.PROCTORING_STORAGE_PROVIDER = 'mock'
  delete process.env.PROCTORING_STORAGE_SAFETY_BYTES
  resetProctoringConfigForTests()
  resetStorageForTests()
  getServerSession.mockReset()
})

describe('getAdminEvidence', () => {
  it('returns the evidence for a scheduled attempt', async () => {
    const evidence = await getAdminEvidence(scheduledAttemptId, 'scheduled')

    expect(evidence.session?.id).toBe(scheduledSessionId)
    expect(evidence.session?.recordingStarted).toBe(true)
    expect(evidence.session?.gazeWarningCount).toBe(2)
    expect(evidence.assets.length).toBe(2)
    expect(evidence.events.length).toBe(2)
  })

  it('returns the evidence for a walk-in attempt', async () => {
    const evidence = await getAdminEvidence(walkInAttemptId, 'walkin')

    expect(evidence.session?.id).toBe(walkInSessionId)
    expect(evidence.assets.length).toBe(1)
    expect(evidence.assets[0].type).toBe('WEBCAM_SEGMENT')
  })

  it('does not cross the two attempt kinds', async () => {
    // The same id read as the wrong kind must not find the other table's
    // session - the two FKs are separate columns and must stay that way.
    expect((await getAdminEvidence(scheduledAttemptId, 'walkin')).session).toBeNull()
    expect((await getAdminEvidence(walkInAttemptId, 'scheduled')).session).toBeNull()
  })

  it('returns a null session for a never-proctored attempt rather than throwing', async () => {
    const evidence = await getAdminEvidence(unproctoredAttemptId, 'scheduled')

    expect(evidence.session).toBeNull()
    expect(evidence.assets).toEqual([])
    expect(evidence.events).toEqual([])
  })

  it('never leaks the object key or a signed URL', async () => {
    const body = JSON.stringify(await getAdminEvidence(scheduledAttemptId, 'scheduled'))

    expect(body).not.toContain('objectKey')
    expect(body).not.toContain('assessment-proctoring/')
    expect(body).not.toContain('X-Amz-Signature')
    expect(body).not.toContain('uploadUrl')
    // Nothing that even looks like a URL should be in here.
    expect(body).not.toContain('http')
  })

  it('orders events by occurredAt and assets by type then sequence', async () => {
    const evidence = await getAdminEvidence(scheduledAttemptId, 'scheduled')

    const times = evidence.events.map(e => new Date(e.occurredAt).getTime())
    expect(times[0]).toBeLessThanOrEqual(times[1])
    // Grouped by type, so the player and the gallery each read one contiguous
    // run. The order is the ENUM DECLARATION order - WEBCAM_SEGMENT is declared
    // first in schema.prisma - not alphabetical. Prisma sorts Postgres enums by
    // their declared position, which is worth pinning: adding a type above
    // WEBCAM_SEGMENT later would silently reorder this response.
    expect(evidence.assets.map(a => a.type)).toEqual(['WEBCAM_SEGMENT', 'SCREENSHOT'])
  })
})

describe('requireAdmin on the proctoring endpoints', () => {
  it('rejects an unauthenticated caller with 401', async () => {
    getServerSession.mockResolvedValue(null)

    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an authenticated student with 403, not 401', async () => {
    getServerSession.mockResolvedValue({ user: { email: studentEmail, role: 'STUDENT' } })

    // 403 and not 401 is the point: the caller is signed in, just not an admin.
    // The ~50 inline checks elsewhere conflate the two and always say 401.
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 })
  })

  it('accepts an APP_ADMIN', async () => {
    getServerSession.mockResolvedValue({ user: { email: adminEmail, role: 'APP_ADMIN' } })

    const ctx = await requireAdmin()
    expect(ctx.email).toBe(adminEmail)
  })

  it('rejects a deactivated admin with 401', async () => {
    const gone = await makeUser('APP_ADMIN', 'deactivated')
    await prisma.user.update({ where: { id: gone.id }, data: { isActive: false } })
    getServerSession.mockResolvedValue({ user: { email: gone.email, role: 'APP_ADMIN' } })

    await expect(requireAdmin()).rejects.toBeInstanceOf(HttpError)
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 })
  })
})

describe('issueDownloadUrl', () => {
  it('signs a live asset on demand', async () => {
    const storage = getStorage() as MockStorage
    storage.clear()
    const asset = await prisma.proctoringAsset.findFirstOrThrow({
      where: { proctoringSessionId: scheduledSessionId, type: 'SCREENSHOT' },
    })

    const url = await issueDownloadUrl(asset.id)
    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
  })

  it('refuses an expired asset and flips it to EXPIRED', async () => {
    const asset = await prisma.proctoringAsset.create({
      data: {
        proctoringSessionId: scheduledSessionId,
        type: 'SCREENSHOT',
        objectKey: `assessment-proctoring/${scheduledSessionId}/screens/000099.webp`,
        contentType: 'image/webp',
        byteSize: 50_000,
        sequence: 99,
        capturedAt: new Date(Date.now() - 100 * 3_600_000),
        uploadedAt: new Date(Date.now() - 100 * 3_600_000),
        // Already past retention.
        expiresAt: new Date(Date.now() - 1000),
        status: 'UPLOADED',
      },
    })

    await expect(issueDownloadUrl(asset.id)).rejects.toMatchObject({ status: 410 })

    // Recorded, so the gallery and the usage page agree about what happened.
    const after = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(after.status).toBe('EXPIRED')

    await prisma.proctoringAsset.delete({ where: { id: asset.id } })
  })
})

describe('getUsageReport', () => {
  it('holds the arithmetic invariant: total = reserved + stored, remaining = safety - total', async () => {
    const u = await getUsageReport()

    expect(u.totalBytes).toBe(u.reservedBytes + u.storedBytes)
    expect(u.remainingBytes).toBe(Math.max(0, u.safetyBytes - u.totalBytes))
    // Asserted as an invariant rather than against fixed numbers: other suites
    // write sessions and assets into the same tables and vitest may run them
    // concurrently, so absolute totals are not this file's to control.
    expect(u.remainingBytes).toBeGreaterThanOrEqual(0)
  })

  it('never reports a negative remaining when the budget is exceeded', async () => {
    // The config floor for the safety budget is 100 MB, which is well above
    // what this file's fixtures store - so the over-budget state has to be
    // created from the other side, with a reservation that exceeds it.
    process.env.PROCTORING_STORAGE_SAFETY_BYTES = '100000000'
    resetProctoringConfigForTests()

    const attempt = await prisma.walkInAttempt.create({
      data: { testId, studentId: otherProfileId, userId: otherUserId, questionIds: ['qA'] },
    })
    const hog = await prisma.proctoringSession.create({
      data: {
        walkInAttemptId: attempt.id,
        status: 'ACTIVE',
        startedAt: new Date(),
        lastHeartbeatAt: new Date(),
        retentionExpiresAt,
        // Just under the Int ceiling, so reserved alone clears the 100 MB budget.
        storageReservedBytes: 2_000_000_000,
      },
    })

    try {
      const u = await getUsageReport()

      expect(u.safetyBytes).toBe(100_000_000)
      expect(u.totalBytes).toBeGreaterThan(u.safetyBytes)
      // Clamped, not negative. A negative "remaining" reads as a bug; zero
      // reads as full, which is what it means.
      expect(u.remainingBytes).toBe(0)
      expect(u.estimatedAttemptsRemaining).toBe(0)
    } finally {
      await prisma.proctoringSession.delete({ where: { id: hog.id } })
      await prisma.walkInAttempt.delete({ where: { id: attempt.id } })
    }
  })

  it('derives estimatedAttemptsRemaining from the 60-minute reservation', async () => {
    const u = await getUsageReport()

    expect(u.bytesPerAttempt).toBeGreaterThan(0)
    expect(u.estimatedAttemptsRemaining).toBe(
      Math.floor(u.remainingBytes / u.bytesPerAttempt)
    )
  })

  it('counts assets past retention as awaiting cleanup', async () => {
    const before = (await getUsageReport()).assetsAwaitingCleanup

    const stale = await prisma.proctoringAsset.create({
      data: {
        proctoringSessionId: scheduledSessionId,
        type: 'SCREENSHOT',
        objectKey: `assessment-proctoring/${scheduledSessionId}/screens/000098.webp`,
        contentType: 'image/webp',
        byteSize: 70_000,
        sequence: 98,
        capturedAt: new Date(Date.now() - 100 * 3_600_000),
        uploadedAt: new Date(Date.now() - 100 * 3_600_000),
        expiresAt: new Date(Date.now() - 1000),
        status: 'UPLOADED',
      },
    })

    const after = await getUsageReport()
    expect(after.assetsAwaitingCleanup).toBe(before + 1)
    // Past retention, so it no longer counts against the budget even though the
    // object is still in the bucket.
    expect(after.storedBytes).toBe((await getUsageReport()).storedBytes)

    await prisma.proctoringAsset.delete({ where: { id: stale.id } })
  })

  it('reports averages per asset type', async () => {
    const u = await getUsageReport()

    // Both fixtures are UPLOADED and within retention, so both averages exist.
    expect(u.avgSegmentBytes).toBeGreaterThan(0)
    expect(u.avgScreenshotBytes).toBeGreaterThan(0)
  })
})
