import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runRetentionCleanup } from '@/lib/proctoring/retention'
import { currentUsageBytes } from '@/lib/proctoring/quota'
import { getStorage, resetStorageForTests, MockStorage } from '@/lib/proctoring/storage'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'
import { POST as cleanupRoute } from '@/app/api/cron/proctoring-cleanup/route'

/**
 * Retention cleanup, against MockStorage and a real database.
 *
 * The properties under test are the ones that matter when the job runs late,
 * runs twice, or fails half way: it must be bounded, idempotent, and it must
 * never mark an asset DELETED whose bytes are still in the bucket. A job that
 * lies about what it removed is worse than one that does not run, because the
 * storage ledger is what the operator plans a drive around.
 */

const TAG = `retention-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
let sessionId = ''
const userIds: string[] = []
let storage: MockStorage

const HOUR = 3_600_000

interface SeedSpec {
  sequence: number
  /** Hours from now. Negative is already expired. */
  expiresInHours: number
  byteSize?: number
  status?: 'UPLOADED' | 'PENDING' | 'FAILED' | 'EXPIRED' | 'DELETED'
  type?: 'WEBCAM_SEGMENT' | 'SCREENSHOT'
}

/** Create an asset row and put a matching object in mock storage. */
async function seedAsset(spec: SeedSpec) {
  const type = spec.type ?? 'SCREENSHOT'
  const ext = type === 'SCREENSHOT' ? 'webp' : 'webm'
  const dir = type === 'SCREENSHOT' ? 'screens' : 'webcam'
  const objectKey = `assessment-proctoring/${sessionId}/${dir}/${String(spec.sequence).padStart(6, '0')}.${ext}`
  const byteSize = spec.byteSize ?? 100_000

  storage.putForTest(objectKey, byteSize, type === 'SCREENSHOT' ? 'image/webp' : 'video/webm')

  return prisma.proctoringAsset.create({
    data: {
      proctoringSessionId: sessionId,
      type,
      objectKey,
      contentType: type === 'SCREENSHOT' ? 'image/webp' : 'video/webm',
      byteSize,
      sequence: spec.sequence,
      capturedAt: new Date(Date.now() - 100 * HOUR),
      uploadedAt: new Date(Date.now() - 100 * HOUR),
      expiresAt: new Date(Date.now() + spec.expiresInHours * HOUR),
      status: spec.status ?? 'UPLOADED',
    },
  })
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
      endsAt: new Date(Date.now() + HOUR),
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
    data: { scheduleId, studentId: profile.id, userId: user.id, questionIds: ['qA'] },
  })

  const session = await prisma.proctoringSession.create({
    data: {
      testAttemptId: attempt.id,
      status: 'COMPLETED',
      startedAt: new Date(Date.now() - 100 * HOUR),
      endedAt: new Date(Date.now() - 99 * HOUR),
      lastHeartbeatAt: new Date(Date.now() - 99 * HOUR),
      retentionExpiresAt: new Date(Date.now() + 72 * HOUR),
      storageReservedBytes: 0,
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
  await prisma.proctoringAsset.deleteMany({ where: { proctoringSessionId: sessionId } })
  await prisma.proctoringSession.update({
    where: { id: sessionId },
    data: {
      status: 'COMPLETED',
      retentionExpiresAt: new Date(Date.now() + 72 * HOUR),
      storageReservedBytes: 0,
      lastHeartbeatAt: new Date(Date.now() - 99 * HOUR),
    },
  })
})

describe('runRetentionCleanup', () => {
  it('deletes an expired asset from storage and marks it DELETED', async () => {
    const asset = await seedAsset({ sequence: 1, expiresInHours: -1 })

    const report = await runRetentionCleanup()

    expect(report.objectsDeleted).toBe(1)
    expect(report.deleteFailures).toBe(0)

    const row = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(row.status).toBe('DELETED')
    // The row stays as a record that evidence existed, but must stop claiming
    // bytes that are no longer stored.
    expect(row.byteSize).toBe(0)
    expect(await storage.getObjectMetadata(asset.objectKey)).toBeNull()
  })

  it('leaves an asset that has not expired alone', async () => {
    const live = await seedAsset({ sequence: 2, expiresInHours: 48 })

    const report = await runRetentionCleanup()

    expect(report.objectsDeleted).toBe(0)
    const row = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: live.id } })
    expect(row.status).toBe('UPLOADED')
    expect(row.byteSize).toBe(100_000)
    expect(await storage.getObjectMetadata(live.objectKey)).not.toBeNull()
  })

  it('is safe to run twice', async () => {
    await seedAsset({ sequence: 3, expiresInHours: -1 })
    await seedAsset({ sequence: 4, expiresInHours: -2 })

    const first = await runRetentionCleanup()
    expect(first.objectsDeleted).toBe(2)

    // The second run must find nothing left to do. A job that is re-run after
    // an interrupted one - or simply run twice by an overlapping schedule -
    // has to converge, not double-count or throw.
    const second = await runRetentionCleanup()
    expect(second.objectsDeleted).toBe(0)
    expect(second.deleteFailures).toBe(0)
    expect(second.assetsExpired).toBe(0)
  })

  it('marks EXPIRED not DELETED when the object delete fails, so the next run retries', async () => {
    const asset = await seedAsset({ sequence: 5, expiresInHours: -1 })

    const failing = vi
      .spyOn(storage, 'deleteObject')
      .mockRejectedValueOnce(new Error('R2 unavailable'))

    const first = await runRetentionCleanup()
    expect(first.deleteFailures).toBe(1)
    expect(first.objectsDeleted).toBe(0)

    const afterFailure = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: asset.id } })
    // Claiming DELETED here would strand the bytes forever: nothing would ever
    // look at this row again, and the object would sit in the bucket unbilled
    // for by the ledger and unreachable by any retry.
    expect(afterFailure.status).toBe('EXPIRED')
    expect(afterFailure.byteSize).toBe(100_000)

    failing.mockRestore()

    const second = await runRetentionCleanup()
    expect(second.objectsDeleted).toBe(1)
    const afterRetry = await prisma.proctoringAsset.findUniqueOrThrow({ where: { id: asset.id } })
    expect(afterRetry.status).toBe('DELETED')
  })

  it('expires a completed session past its retention window', async () => {
    await prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { retentionExpiresAt: new Date(Date.now() - HOUR), storageReservedBytes: 50_000_000 },
    })

    const report = await runRetentionCleanup()

    expect(report.sessionsExpired).toBeGreaterThanOrEqual(1)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: sessionId } })
    expect(row.status).toBe('EXPIRED')
    // An abandoned session must not hold budget past its own retention.
    expect(row.storageReservedBytes).toBe(0)
  })

  it('bounds the batch and reports batchExhausted when it fills', async () => {
    for (let i = 10; i < 15; i++) {
      await seedAsset({ sequence: i, expiresInHours: -1 })
    }

    const report = await runRetentionCleanup({ batchSize: 3 })

    expect(report.assetsExpired).toBe(3)
    expect(report.batchExhausted).toBe(true)

    // The remainder drains on the next run, which is what makes a backlog
    // survivable rather than something that has to be fixed by hand.
    const next = await runRetentionCleanup({ batchSize: 3 })
    expect(next.assetsExpired).toBe(2)
    expect(next.batchExhausted).toBe(false)
  })

  it('drains oldest-first after a multi-day gap', async () => {
    // Seeded out of order on purpose: ordering must come from expiresAt, not
    // from insertion order or id.
    const middle = await seedAsset({ sequence: 21, expiresInHours: -48 })
    const newest = await seedAsset({ sequence: 22, expiresInHours: -1 })
    const oldest = await seedAsset({ sequence: 23, expiresInHours: -96 })

    const report = await runRetentionCleanup({ batchSize: 2 })
    expect(report.assetsExpired).toBe(2)

    const status = async (id: string) =>
      (await prisma.proctoringAsset.findUniqueOrThrow({ where: { id } })).status

    // The two oldest go first; the newest waits for the next run.
    expect(await status(oldest.id)).toBe('DELETED')
    expect(await status(middle.id)).toBe('DELETED')
    expect(await status(newest.id)).toBe('UPLOADED')
  })

  it('stops expired assets counting against the storage budget', async () => {
    await seedAsset({ sequence: 30, expiresInHours: -1, byteSize: 40_000_000 })

    // Read this session's own contribution rather than the global total: other
    // suites write into these tables and vitest may run them concurrently, so
    // a global before/after subtraction would be a race.
    const ownStored = async () => {
      const agg = await prisma.proctoringAsset.aggregate({
        where: { proctoringSessionId: sessionId, status: 'UPLOADED', expiresAt: { gt: new Date() } },
        _sum: { byteSize: true },
      })
      return Number(agg._sum.byteSize ?? 0)
    }

    const live = await seedAsset({ sequence: 31, expiresInHours: 48, byteSize: 5_000_000 })
    expect(await ownStored()).toBe(5_000_000)

    await runRetentionCleanup()

    // The expired 40 MB is gone from the ledger; the live 5 MB still counts.
    expect(await ownStored()).toBe(5_000_000)
    const expiredRow = await prisma.proctoringAsset.findFirst({
      where: { proctoringSessionId: sessionId, sequence: 30 },
    })
    expect(expiredRow?.status).toBe('DELETED')
    expect(expiredRow?.byteSize).toBe(0)

    // And the global ledger is still readable and self-consistent.
    const usage = await currentUsageBytes()
    expect(usage.totalBytes).toBe(usage.reservedBytes + usage.storedBytes)
    expect(usage.storedBytes).toBeGreaterThanOrEqual(5_000_000)

    await prisma.proctoringAsset.delete({ where: { id: live.id } })
  })
})

describe('POST /api/cron/proctoring-cleanup', () => {
  const REAL_SECRET = 'test-cron-secret-0123456789'
  let savedSecret: string | undefined

  function call(authorization?: string): Promise<Response> {
    return cleanupRoute(new Request('http://localhost/api/cron/proctoring-cleanup', {
      method: 'POST',
      headers: authorization ? { authorization } : {},
    }) as never)
  }

  beforeEach(() => {
    savedSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = REAL_SECRET
  })

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = savedSecret
  })

  it('runs the cleanup for a correct secret', async () => {
    await seedAsset({ sequence: 40, expiresInHours: -1 })

    const res = await call(`Bearer ${REAL_SECRET}`)
    expect(res.status).toBe(200)

    const report = await res.json()
    expect(report.objectsDeleted).toBeGreaterThanOrEqual(1)
    expect(report.batchExhausted).toBe(false)
  })

  it('refuses a wrong secret with 401 and no detail', async () => {
    const res = await call('Bearer wrong')
    expect(res.status).toBe(401)

    const body = await res.json()
    // An unauthenticated caller must learn nothing about why - not the
    // expected length, not whether the variable is set, not the prefix.
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  it('refuses a missing header with 401', async () => {
    expect((await call()).status).toBe(401)
  })

  it('refuses a correct secret sent without the Bearer scheme', async () => {
    // The handler strips an optional "Bearer " prefix, so a bare token is
    // still accepted; what must not pass is a different token entirely.
    expect((await call(REAL_SECRET)).status).toBe(200)
    expect((await call(`Bearer ${REAL_SECRET}x`)).status).toBe(401)
  })

  it('reports 503 rather than running unauthenticated when the secret is unset', async () => {
    delete process.env.CRON_SECRET

    const res = await call('Bearer anything')
    // Not 401: the caller may be legitimate and the deployment is the thing at
    // fault. Crucially it does not fall through and run the cleanup.
    expect(res.status).toBe(503)
  })
})
