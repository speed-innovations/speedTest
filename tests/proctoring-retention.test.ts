import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/db'
import { runRetentionCleanup } from '@/lib/proctoring/retention'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'
import { POST as cleanupRoute } from '@/app/api/cron/proctoring-cleanup/route'

/** Session housekeeping against a real database. No storage is involved. */

const TAG = `retention-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
let profileId = ''
let userId = ''
const attemptIds: string[] = []

async function sessionFor(data: {
  status: 'ACTIVE' | 'COMPLETED' | 'INTERRUPTED'
  lastHeartbeatAt?: Date | null
  retentionExpiresAt: Date
}) {
  const attempt = await prisma.testAttempt.create({
    data: { scheduleId, studentId: profileId, userId, questionIds: [] },
  })
  attemptIds.push(attempt.id)
  return prisma.proctoringSession.create({
    data: {
      testAttemptId: attempt.id,
      status: data.status,
      startedAt: new Date(),
      lastHeartbeatAt: data.lastHeartbeatAt === undefined ? new Date() : data.lastHeartbeatAt,
      retentionExpiresAt: data.retentionExpiresAt,
    },
  })
}

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id
  const test = await prisma.test.create({
    data: { title: TAG, durationMinutes: 60, proctoringEnabled: true, assessmentConfig: [] },
  })
  testId = test.id
  const schedule = await prisma.testSchedule.create({
    data: { testId, collegeId, scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
  })
  scheduleId = schedule.id
})

beforeEach(async () => {
  // One student per case: TestAttempt is unique on (scheduleId, studentId).
  const email = `${TAG}-${Math.random().toString(36).slice(2)}@example.test`
  const user = await prisma.user.create({ data: { email, name: TAG, password: 'x', role: 'STUDENT' } })
  userId = user.id
  const profile = await prisma.studentProfile.create({ data: { userId, collegeId, fullName: TAG, email } })
  profileId = profile.id
  resetProctoringConfigForTests()
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({ where: { testAttemptId: { in: attemptIds } } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  const profiles = await prisma.studentProfile.findMany({ where: { collegeId }, select: { userId: true } })
  await prisma.studentProfile.deleteMany({ where: { collegeId } })
  await prisma.user.deleteMany({ where: { id: { in: profiles.map(p => p.userId) } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

const future = () => new Date(Date.now() + 72 * 3_600_000)
const past = () => new Date(Date.now() - 1000)

describe('runRetentionCleanup', () => {
  it('expires a completed session past its retention window', async () => {
    const s = await sessionFor({ status: 'COMPLETED', retentionExpiresAt: past() })
    await runRetentionCleanup()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('EXPIRED')
  })

  it('leaves a completed session inside its window alone', async () => {
    const s = await sessionFor({ status: 'COMPLETED', retentionExpiresAt: future() })
    await runRetentionCleanup()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('COMPLETED')
  })

  it('interrupts a live session whose heartbeat went stale', async () => {
    const s = await sessionFor({
      status: 'ACTIVE',
      lastHeartbeatAt: new Date(Date.now() - 10 * 60_000),
      retentionExpiresAt: future(),
    })
    const report = await runRetentionCleanup()
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('INTERRUPTED')
    expect(row.endedAt).not.toBeNull()
    expect(report.staleSessionsInterrupted).toBeGreaterThanOrEqual(1)
  })

  it('leaves a live session with a fresh heartbeat alone', async () => {
    const s = await sessionFor({ status: 'ACTIVE', retentionExpiresAt: future() })
    await runRetentionCleanup()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ACTIVE')
  })

  it('is safe to run twice', async () => {
    const s = await sessionFor({ status: 'COMPLETED', retentionExpiresAt: past() })
    await runRetentionCleanup()
    await runRetentionCleanup()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('EXPIRED')
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

  it('runs the cleanup for a correct secret and reports metadata-only counts', async () => {
    const res = await call(`Bearer ${REAL_SECRET}`)
    expect(res.status).toBe(200)
    const report = await res.json()
    expect(Object.keys(report).sort()).toEqual(['sessionsExpired', 'staleSessionsInterrupted'])
  })

  it('refuses a wrong secret with 401 and no detail', async () => {
    const res = await call('Bearer wrong')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('refuses a missing header with 401', async () => {
    expect((await call()).status).toBe(401)
  })

  it('accepts a bare token but not a different one', async () => {
    expect((await call(REAL_SECRET)).status).toBe(200)
    expect((await call(`Bearer ${REAL_SECRET}x`)).status).toBe(401)
  })

  it('reports 503 rather than running unauthenticated when the secret is unset', async () => {
    delete process.env.CRON_SECRET
    expect((await call('Bearer anything')).status).toBe(503)
  })
})
