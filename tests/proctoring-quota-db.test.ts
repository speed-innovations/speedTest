import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import {
  currentUsageBytes,
  canStartProctoredAssessment,
  releaseReservation,
  sweepStaleReservations,
} from '@/lib/proctoring/quota'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'

const TAG = `quota-test-${Date.now()}`
const ids: string[] = []
let collegeId = ''
let testId = ''
let scheduleId = ''
const userIds: string[] = []

/**
 * Integration test against a real database. Byte counters are Int columns; the
 * sum across rows can exceed 2^31, and Postgres returns bigint from SUM(int).
 * Rather than assume how the Prisma driver adapter surfaces that, this asserts
 * it - a wrong type here would silently corrupt every budget decision.
 */
beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id
  const test = await prisma.test.create({
    data: { title: `${TAG}-test`, durationMinutes: 60, assessmentConfig: [{ area: 'APTITUDE', count: 1 }] },
  })
  testId = test.id
  const schedule = await prisma.testSchedule.create({
    data: { testId, collegeId, scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
  })
  scheduleId = schedule.id

  // Four sessions at 2 GB each: 8e9 total, comfortably past 2^31 (2.147e9).
  for (let i = 0; i < 4; i++) {
    const user = await prisma.user.create({
      data: { email: `${TAG}-${i}@example.test`, name: TAG, password: 'x', role: 'STUDENT' },
    })
    userIds.push(user.id)
    const profile = await prisma.studentProfile.create({
      data: { userId: user.id, collegeId, fullName: TAG, email: `${TAG}-${i}@example.test` },
    })
    const attempt = await prisma.testAttempt.create({
      data: { scheduleId, studentId: profile.id, userId: user.id, questionIds: [] },
    })
    const s = await prisma.proctoringSession.create({
      data: {
        testAttemptId: attempt.id,
        status: 'ACTIVE',
        retentionExpiresAt: new Date(Date.now() + 72 * 3_600_000),
        storageReservedBytes: 2_000_000_000,
      },
    })
    ids.push(s.id)
  }
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({ where: { id: { in: ids } } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: testId } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

describe('byte sums past 2^31', () => {
  it('returns a plain JS number, not a bigint or a string', async () => {
    const agg = await prisma.proctoringSession.aggregate({
      where: { id: { in: ids } },
      _sum: { storageReservedBytes: true },
    })
    const sum = agg._sum.storageReservedBytes
    expect(typeof sum).toBe('number')
    expect(sum).toBe(8_000_000_000)
    expect(Number.isSafeInteger(sum as number)).toBe(true)
  })
})

describe('currentUsageBytes', () => {
  it('counts reservations from sessions that still hold them', async () => {
    const usage = await currentUsageBytes()
    expect(usage.reservedBytes).toBeGreaterThanOrEqual(8_000_000_000)
    expect(usage.totalBytes).toBe(usage.reservedBytes + usage.storedBytes)
  })
})

describe('canStartProctoredAssessment', () => {
  it('refuses when the budget cannot cover another attempt', async () => {
    process.env.PROCTORING_ENABLED = 'true'
    process.env.PROCTORING_STORAGE_PROVIDER = 'mock'
    resetProctoringConfigForTests()
    // The fixtures alone reserve 8 GB against a 7 GB budget.
    const r = await canStartProctoredAssessment(60)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('PROCTORING_STORAGE_LIMIT_REACHED')
    expect(r.estimatedBytes).toBeGreaterThan(0)
    expect(r.remainingBudget).toBe(0)
  })

  it('refuses when proctoring is disabled, without touching the database', async () => {
    process.env.PROCTORING_ENABLED = 'false'
    resetProctoringConfigForTests()
    const r = await canStartProctoredAssessment(60)
    expect(r.reason).toBe('PROCTORING_DISABLED')
  })
})

describe('releaseReservation', () => {
  it('zeroes the reservation and records what was actually used', async () => {
    await releaseReservation(ids[0])
    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: ids[0] } })
    expect(s.storageReservedBytes).toBe(0)
    expect(s.storageUsedBytes).toBe(0) // no assets uploaded in this fixture
  })
})

describe('sweepStaleReservations', () => {
  it('interrupts sessions whose heartbeat stopped and frees their reservation', async () => {
    process.env.PROCTORING_STALE_SESSION_MS = '60000'
    resetProctoringConfigForTests()
    await prisma.proctoringSession.update({
      where: { id: ids[1] },
      data: { lastHeartbeatAt: new Date(Date.now() - 600_000) },
    })
    const n = await sweepStaleReservations()
    expect(n).toBeGreaterThanOrEqual(1)
    const s = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: ids[1] } })
    expect(s.status).toBe('INTERRUPTED')
    expect(s.storageReservedBytes).toBe(0)
    expect(s.endedAt).not.toBeNull()
  })

  it('is safe to run twice', async () => {
    await sweepStaleReservations()
    const second = await sweepStaleReservations()
    expect(second).toBe(0)
  })
})
