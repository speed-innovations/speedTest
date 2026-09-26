import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

/**
 * The clock cannot start on a proctored test without a live proctoring
 * session, whatever the client says. The attempt is pre-created with an empty
 * question set so the route never calls the question picker.
 */
const getServerSession = vi.fn()
vi.mock('next-auth', () => ({
  default: vi.fn(),
  getServerSession: (...args: unknown[]) => getServerSession(...args),
}))

import { prisma } from '@/lib/db'
import { POST as scheduledStart } from '@/app/api/student/test/[scheduleId]/start/route'
import { POST as walkInStart } from '@/app/api/student/walkin-test/[testId]/start/route'

const TAG = `start-gate-${Date.now()}`
let collegeId = ''
let studentId = ''
let userId = ''
let email = ''
let proctoredTestId = ''
let plainTestId = ''
let proctoredScheduleId = ''
let plainScheduleId = ''
let walkInTestId = ''
let proctoredAttemptId = ''
let plainAttemptId = ''
let walkInAttemptId = ''

const req = (body: unknown = {}) =>
  new Request('http://localhost/start', { method: 'POST', body: JSON.stringify(body) }) as never
const scheduled = (scheduleId: string, body?: unknown) =>
  scheduledStart(req(body), { params: Promise.resolve({ scheduleId }) })
const walkIn = (testId: string, body?: unknown) =>
  walkInStart(req(body), { params: Promise.resolve({ testId }) })

async function setSession(where: { testAttemptId?: string; walkInAttemptId?: string }, status: 'ACTIVE' | 'INTERRUPTED' | 'COMPLETED' | null) {
  await prisma.proctoringSession.deleteMany({ where })
  if (status) {
    await prisma.proctoringSession.create({
      data: { ...where, status, startedAt: new Date(), lastHeartbeatAt: new Date(), retentionExpiresAt: new Date(Date.now() + 3_600_000) },
    })
  }
}

async function resetClock() {
  await prisma.testAttempt.updateMany({ where: { id: { in: [proctoredAttemptId, plainAttemptId] } }, data: { startedAt: null, expiresAt: null } })
  await prisma.walkInAttempt.updateMany({ where: { id: walkInAttemptId }, data: { startedAt: null, expiresAt: null } })
}

beforeAll(async () => {
  collegeId = (await prisma.college.create({ data: { name: `${TAG}-college` } })).id
  email = `${TAG}@example.test`
  const user = await prisma.user.create({ data: { email, name: TAG, password: 'x', role: 'STUDENT' } })
  userId = user.id
  studentId = (await prisma.studentProfile.create({ data: { userId, collegeId, fullName: TAG, email } })).id

  const window = { scheduledAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000) }
  proctoredTestId = (await prisma.test.create({ data: { title: `${TAG}-p`, proctoringEnabled: true, assessmentConfig: [] } })).id
  plainTestId = (await prisma.test.create({ data: { title: `${TAG}-plain`, assessmentConfig: [] } })).id
  proctoredScheduleId = (await prisma.testSchedule.create({ data: { testId: proctoredTestId, collegeId, ...window } })).id
  plainScheduleId = (await prisma.testSchedule.create({ data: { testId: plainTestId, collegeId, ...window } })).id
  proctoredAttemptId = (await prisma.testAttempt.create({ data: { scheduleId: proctoredScheduleId, studentId, userId, questionIds: [] } })).id
  plainAttemptId = (await prisma.testAttempt.create({ data: { scheduleId: plainScheduleId, studentId, userId, questionIds: [] } })).id

  walkInTestId = (await prisma.test.create({
    data: { title: `${TAG}-w`, isWalkIn: true, status: 'ACTIVE', proctoringEnabled: true, assessmentConfig: [] },
  })).id
  await prisma.walkInEligibleStudent.create({ data: { testId: walkInTestId, studentId } })
  walkInAttemptId = (await prisma.walkInAttempt.create({ data: { testId: walkInTestId, studentId, userId, questionIds: [] } })).id
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({
    where: { OR: [{ testAttemptId: { in: [proctoredAttemptId, plainAttemptId] } }, { walkInAttemptId }] },
  })
  await prisma.testAttempt.deleteMany({ where: { scheduleId: { in: [proctoredScheduleId, plainScheduleId] } } })
  await prisma.walkInAttempt.deleteMany({ where: { testId: walkInTestId } })
  await prisma.walkInEligibleStudent.deleteMany({ where: { testId: walkInTestId } })
  await prisma.testSchedule.deleteMany({ where: { id: { in: [proctoredScheduleId, plainScheduleId] } } })
  await prisma.test.deleteMany({ where: { id: { in: [proctoredTestId, plainTestId, walkInTestId] } } })
  await prisma.studentProfile.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(async () => {
  getServerSession.mockResolvedValue({ user: { email, role: 'STUDENT' } })
  await resetClock()
})

const startedAt = async (kind: 'scheduled' | 'walkin', id: string) =>
  kind === 'scheduled'
    ? (await prisma.testAttempt.findUniqueOrThrow({ where: { id } })).startedAt
    : (await prisma.walkInAttempt.findUniqueOrThrow({ where: { id } })).startedAt

describe('/start on a proctored scheduled test', () => {
  it('refuses without any proctoring session, and the clock does not start', async () => {
    await setSession({ testAttemptId: proctoredAttemptId }, null)
    const res = await scheduled(proctoredScheduleId)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROCTORING_REQUIRED')
    expect(await startedAt('scheduled', proctoredAttemptId)).toBeNull()
  })

  it('ignores a client that simply claims proctoring is active', async () => {
    await setSession({ testAttemptId: proctoredAttemptId }, null)
    const res = await scheduled(proctoredScheduleId, { proctoringActive: true, sessionId: 'made-up' })
    expect(res.status).toBe(409)
  })

  it('refuses an INTERRUPTED or COMPLETED session', async () => {
    for (const status of ['INTERRUPTED', 'COMPLETED'] as const) {
      await setSession({ testAttemptId: proctoredAttemptId }, status)
      expect((await scheduled(proctoredScheduleId)).status).toBe(409)
    }
  })

  it('starts the clock once a live session exists', async () => {
    await setSession({ testAttemptId: proctoredAttemptId }, 'ACTIVE')
    const res = await scheduled(proctoredScheduleId)
    expect(res.status).toBe(200)
    expect(await startedAt('scheduled', proctoredAttemptId)).not.toBeNull()
  })

  it('refuses an unauthenticated caller even with a live session in place', async () => {
    await setSession({ testAttemptId: proctoredAttemptId }, 'ACTIVE')
    getServerSession.mockResolvedValue(null)
    expect((await scheduled(proctoredScheduleId)).status).toBe(401)
  })
})

describe('/start on a proctored walk-in test', () => {
  it('refuses without a live session', async () => {
    await setSession({ walkInAttemptId }, null)
    const res = await walkIn(walkInTestId)
    expect(res.status).toBe(409)
    expect(await startedAt('walkin', walkInAttemptId)).toBeNull()
  })

  it('starts once a live session exists', async () => {
    await setSession({ walkInAttemptId }, 'ACTIVE')
    expect((await walkIn(walkInTestId)).status).toBe(200)
    expect(await startedAt('walkin', walkInAttemptId)).not.toBeNull()
  })
})

describe('/start on a non-proctored test (regression)', () => {
  it('starts exactly as before, with no proctoring session and none created', async () => {
    const res = await scheduled(plainScheduleId)
    expect(res.status).toBe(200)
    expect(await startedAt('scheduled', plainAttemptId)).not.toBeNull()
    expect(await prisma.proctoringSession.count({ where: { testAttemptId: plainAttemptId } })).toBe(0)
  })
})
