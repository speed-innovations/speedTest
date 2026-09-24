import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

/**
 * Admin evidence, against a real database.
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
import { getAdminEvidence } from '@/lib/proctoring/admin'
import { requireAdmin, HttpError } from '@/lib/attempt-auth'

const TAG = `admin-test-${Date.now()}`
let collegeId = ''
let testId = ''
let scheduleId = ''
let scheduledAttemptId = ''
let walkInAttemptId = ''
let unproctoredAttemptId = ''
let scheduledSessionId = ''
let walkInSessionId = ''
let adminEmail = ''
let studentEmail = ''
const userIds: string[] = []
const retentionExpiresAt = new Date(Date.now() + 72 * 3_600_000)

async function makeUser(role: 'APP_ADMIN' | 'STUDENT', suffix: string) {
  const email = `${TAG}-${suffix}@example.test`
  const user = await prisma.user.create({ data: { email, name: `${TAG}-${suffix}`, password: 'x', role } })
  userIds.push(user.id)
  return { id: user.id, email }
}

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id
  const test = await prisma.test.create({
    data: { title: `${TAG}-test`, durationMinutes: 60, proctoringEnabled: true, assessmentConfig: [{ area: 'APTITUDE', count: 1 }] },
  })
  testId = test.id
  const schedule = await prisma.testSchedule.create({
    data: { testId, collegeId, scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) },
  })
  scheduleId = schedule.id

  adminEmail = (await makeUser('APP_ADMIN', 'admin')).email
  const student = await makeUser('STUDENT', 'student')
  studentEmail = student.email
  const profile = await prisma.studentProfile.create({
    data: { userId: student.id, collegeId, fullName: TAG, email: student.email },
  })
  scheduledAttemptId = (await prisma.testAttempt.create({
    data: { scheduleId, studentId: profile.id, userId: student.id, questionIds: ['qA', 'qB'] },
  })).id
  walkInAttemptId = (await prisma.walkInAttempt.create({
    data: { testId, studentId: profile.id, userId: student.id, questionIds: ['qA'] },
  })).id

  const other = await makeUser('STUDENT', 'other')
  const otherProfile = await prisma.studentProfile.create({
    data: { userId: other.id, collegeId, fullName: `${TAG}-other`, email: other.email },
  })
  unproctoredAttemptId = (await prisma.testAttempt.create({
    data: { scheduleId, studentId: otherProfile.id, userId: other.id, questionIds: ['qA'] },
  })).id

  scheduledSessionId = (await prisma.proctoringSession.create({
    data: {
      testAttemptId: scheduledAttemptId, status: 'COMPLETED',
      startedAt: new Date(Date.now() - 3_600_000), endedAt: new Date(),
      retentionExpiresAt, screenShareStarted: true, gazeWarningCount: 2,
    },
  })).id
  walkInSessionId = (await prisma.proctoringSession.create({
    data: { walkInAttemptId, status: 'COMPLETED', startedAt: new Date(Date.now() - 1_800_000), retentionExpiresAt },
  })).id

  await prisma.proctoringEvent.createMany({
    data: [
      {
        proctoringSessionId: scheduledSessionId, clientEventId: `${TAG}-e1`, type: 'GAZE_LEFT',
        direction: 'LEFT', occurredAt: new Date(Date.now() - 1000), elapsedMs: 255_000,
        durationMs: 2100, severity: 'WARN',
      },
      {
        proctoringSessionId: scheduledSessionId, clientEventId: `${TAG}-e2`, type: 'SCREEN_SHARE_STOPPED',
        occurredAt: new Date(Date.now() - 500), elapsedMs: 1_112_000, severity: 'WARN',
      },
    ],
  })
})

afterAll(async () => {
  const sessionIds = [scheduledSessionId, walkInSessionId]
  await prisma.proctoringEvent.deleteMany({ where: { proctoringSessionId: { in: sessionIds } } })
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
  getServerSession.mockReset()
})

describe('getAdminEvidence', () => {
  it('returns the session and events for a scheduled attempt', async () => {
    const evidence = await getAdminEvidence(scheduledAttemptId, 'scheduled')
    expect(evidence.session?.id).toBe(scheduledSessionId)
    expect(evidence.session?.gazeWarningCount).toBe(2)
    expect(evidence.events.length).toBe(2)
  })

  it('returns the session for a walk-in attempt', async () => {
    expect((await getAdminEvidence(walkInAttemptId, 'walkin')).session?.id).toBe(walkInSessionId)
  })

  it('does not cross the two attempt kinds', async () => {
    expect((await getAdminEvidence(scheduledAttemptId, 'walkin')).session).toBeNull()
    expect((await getAdminEvidence(walkInAttemptId, 'scheduled')).session).toBeNull()
  })

  it('returns a null session for a never-proctored attempt rather than throwing', async () => {
    expect(await getAdminEvidence(unproctoredAttemptId, 'scheduled')).toEqual({ session: null, events: [] })
  })

  it('carries no media reference of any kind', async () => {
    const body = JSON.stringify(await getAdminEvidence(scheduledAttemptId, 'scheduled'))
    expect(body).not.toMatch(/objectKey|assets|uploadUrl|X-Amz|http|storage|recording/i)
  })

  it('orders events by time', async () => {
    const evidence = await getAdminEvidence(scheduledAttemptId, 'scheduled')
    const times = evidence.events.map(e => new Date(e.occurredAt).getTime())
    expect(times[0]).toBeLessThanOrEqual(times[1])
  })
})

describe('requireAdmin on the proctoring endpoints', () => {
  it('rejects an unauthenticated caller with 401', async () => {
    getServerSession.mockResolvedValue(null)
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an authenticated student with 403, not 401', async () => {
    getServerSession.mockResolvedValue({ user: { email: studentEmail, role: 'STUDENT' } })
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 })
  })

  it('accepts an APP_ADMIN', async () => {
    getServerSession.mockResolvedValue({ user: { email: adminEmail, role: 'APP_ADMIN' } })
    expect((await requireAdmin()).email).toBe(adminEmail)
  })

  it('rejects a deactivated admin with 401', async () => {
    const gone = await makeUser('APP_ADMIN', 'deactivated')
    await prisma.user.update({ where: { id: gone.id }, data: { isActive: false } })
    getServerSession.mockResolvedValue({ user: { email: gone.email, role: 'APP_ADMIN' } })
    await expect(requireAdmin()).rejects.toBeInstanceOf(HttpError)
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 })
  })
})
