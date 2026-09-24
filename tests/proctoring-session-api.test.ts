import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/attempt-auth'
import {
  resolveOwnedAttempt,
  startSession,
  activeSessionFor,
  recordHeartbeat,
  finalizeSession,
} from '@/lib/proctoring/session'
import { resetProctoringConfigForTests } from '@/lib/proctoring/config'

/**
 * Integration test for the proctoring session lifecycle, against a real
 * database. It exercises the lib helpers rather than HTTP, matching
 * tests/attempt-ownership.test.ts - the routes are thin wrappers over these.
 */

const TAG = `session-test-${Date.now()}`

let collegeId = ''
let studentAId = ''
let studentBId = ''
const userIds: string[] = []

let proctoredTestId = ''
let proctoredScheduleId = ''
let attemptAId = ''
let submittedAttemptId = ''

let plainTestId = ''
let plainScheduleId = ''
let plainAttemptId = ''

let walkInTestId = ''
let walkInAttemptId = ''

async function makeStudent(email: string) {
  const user = await prisma.user.create({
    data: { email, name: TAG, password: 'x', role: 'STUDENT' },
  })
  userIds.push(user.id)
  const profile = await prisma.studentProfile.create({
    data: { userId: user.id, collegeId, fullName: TAG, email },
  })
  return { userId: user.id, studentId: profile.id }
}

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college` } })
  collegeId = college.id

  const a = await makeStudent(`${TAG}-a@example.test`)
  const b = await makeStudent(`${TAG}-b@example.test`)
  studentAId = a.studentId
  studentBId = b.studentId

  const proctoredTest = await prisma.test.create({
    data: {
      title: `${TAG}-proctored`,
      durationMinutes: 60,
      proctoringEnabled: true,
      assessmentConfig: [{ area: 'APTITUDE', count: 1 }],
    },
  })
  proctoredTestId = proctoredTest.id
  const proctoredSchedule = await prisma.testSchedule.create({
    data: {
      testId: proctoredTestId,
      collegeId,
      scheduledAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
    },
  })
  proctoredScheduleId = proctoredSchedule.id

  const attemptA = await prisma.testAttempt.create({
    data: { scheduleId: proctoredScheduleId, studentId: studentAId, userId: a.userId, questionIds: ['q1'] },
  })
  attemptAId = attemptA.id

  const submitted = await prisma.testAttempt.create({
    data: {
      scheduleId: proctoredScheduleId,
      studentId: studentBId,
      userId: b.userId,
      questionIds: ['q1'],
      isSubmitted: true,
      submittedAt: new Date(),
    },
  })
  submittedAttemptId = submitted.id

  // A test with proctoring off, to prove the non-proctored path is untouched.
  const plainTest = await prisma.test.create({
    data: {
      title: `${TAG}-plain`,
      durationMinutes: 60,
      assessmentConfig: [{ area: 'APTITUDE', count: 1 }],
    },
  })
  plainTestId = plainTest.id
  const plainSchedule = await prisma.testSchedule.create({
    data: {
      testId: plainTestId,
      collegeId,
      scheduledAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
    },
  })
  plainScheduleId = plainSchedule.id
  const plainAttempt = await prisma.testAttempt.create({
    data: { scheduleId: plainScheduleId, studentId: studentAId, userId: a.userId, questionIds: ['q1'] },
  })
  plainAttemptId = plainAttempt.id

  const walkInTest = await prisma.test.create({
    data: {
      title: `${TAG}-walkin`,
      durationMinutes: 30,
      isWalkIn: true,
      status: 'ACTIVE',
      proctoringEnabled: true,
      assessmentConfig: [{ area: 'APTITUDE', count: 1 }],
    },
  })
  walkInTestId = walkInTest.id
  const walkInAttempt = await prisma.walkInAttempt.create({
    data: { testId: walkInTestId, studentId: studentAId, userId: a.userId, questionIds: ['q1'] },
  })
  walkInAttemptId = walkInAttempt.id
})

afterAll(async () => {
  await prisma.proctoringSession.deleteMany({
    where: {
      OR: [
        { testAttemptId: { in: [attemptAId, submittedAttemptId, plainAttemptId] } },
        { walkInAttemptId },
      ],
    },
  })
  await prisma.testAttempt.deleteMany({ where: { scheduleId: { in: [proctoredScheduleId, plainScheduleId] } } })
  await prisma.walkInAttempt.deleteMany({ where: { testId: walkInTestId } })
  await prisma.testSchedule.deleteMany({ where: { id: { in: [proctoredScheduleId, plainScheduleId] } } })
  await prisma.test.deleteMany({ where: { id: { in: [proctoredTestId, plainTestId, walkInTestId] } } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: collegeId } })
  await prisma.$disconnect()
})

beforeEach(() => {
  process.env.PROCTORING_ENABLED = 'true'
  process.env.PROCTORING_OPERATIONAL = 'true'
  resetProctoringConfigForTests()
})

describe('resolveOwnedAttempt', () => {
  it('returns a scheduled attempt to its owner, with the test flag', async () => {
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    expect(a.attemptId).toBe(attemptAId)
    expect(a.kind).toBe('scheduled')
    expect(a.proctoringEnabled).toBe(true)
    expect(a.durationMinutes).toBe(60)
  })

  it('returns a walk-in attempt to its owner, with the test flag', async () => {
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    expect(a.attemptId).toBe(walkInAttemptId)
    expect(a.kind).toBe('walkin')
    expect(a.proctoringEnabled).toBe(true)
    expect(a.durationMinutes).toBe(30)
  })

  it('surfaces proctoringEnabled false for a non-proctored test', async () => {
    const a = await resolveOwnedAttempt(plainAttemptId, 'scheduled', plainScheduleId, studentAId)
    expect(a.proctoringEnabled).toBe(false)
  })

  it('refuses another student with 404, not 403, for both kinds', async () => {
    // 403 would confirm a valid attempt id to someone who does not own it.
    await expect(
      resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentBId)
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentBId)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses an attempt driven through the wrong parent id, for both kinds', async () => {
    await expect(
      resolveOwnedAttempt(attemptAId, 'scheduled', plainScheduleId, studentAId)
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      resolveOwnedAttempt(walkInAttemptId, 'walkin', proctoredTestId, studentAId)
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('startSession', () => {
  it('creates an ACTIVE session', async () => {
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const s = await startSession(a)
    expect(s.status).toBe('ACTIVE')
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.testAttemptId).toBe(attemptAId)
    expect(row.walkInAttemptId).toBeNull()
    expect(row.lastHeartbeatAt).not.toBeNull()
  })

  it('is idempotent - a second call returns the same session', async () => {
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const first = await startSession(a)
    const second = await startSession(a)
    expect(second.id).toBe(first.id)
    const count = await prisma.proctoringSession.count({ where: { testAttemptId: attemptAId } })
    expect(count).toBe(1)
  })

  it('creates a walk-in session against the other FK', async () => {
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    const s = await startSession(a)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.walkInAttemptId).toBe(walkInAttemptId)
    expect(row.testAttemptId).toBeNull()
  })

  it('refuses with 400 when the test is not proctored', async () => {
    const a = await resolveOwnedAttempt(plainAttemptId, 'scheduled', plainScheduleId, studentAId)
    await expect(startSession(a)).rejects.toMatchObject({ status: 400 })
    expect(await prisma.proctoringSession.count({ where: { testAttemptId: plainAttemptId } })).toBe(0)
  })

  it('refuses with 409 when the attempt is already submitted', async () => {
    const a = await resolveOwnedAttempt(submittedAttemptId, 'scheduled', proctoredScheduleId, studentBId)
    await expect(startSession(a)).rejects.toMatchObject({ status: 409 })
  })

  it('refuses with 503 when proctoring is globally disabled', async () => {
    process.env.PROCTORING_ENABLED = 'false'
    resetProctoringConfigForTests()
    await prisma.proctoringSession.deleteMany({ where: { walkInAttemptId } })
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    await expect(startSession(a)).rejects.toMatchObject({
      status: 503,
      message: 'PROCTORING_DISABLED',
    })
  })
})

describe('recordHeartbeat', () => {
  it('advances lastHeartbeatAt', async () => {
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const s = await startSession(a)
    // Deliberately a small backdate, not minutes: a stale-looking heartbeat
    // could be picked up by sweepStaleSessions running in a concurrent test
    // file and marked INTERRUPTED underneath this test.
    const before = new Date(Date.now() - 5_000)
    await prisma.proctoringSession.update({
      where: { id: s.id },
      data: { lastHeartbeatAt: before, status: 'ACTIVE' },
    })
    await recordHeartbeat(s.id, { screenSharing: true, degraded: false })
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.lastHeartbeatAt!.getTime()).toBeGreaterThan(before.getTime())
    expect(row.status).toBe('ACTIVE')
    expect(row.screenShareStarted).toBe(true)
  })

  it('sets DEGRADED when a device is down, and recovers', async () => {
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const s = await startSession(a)
    await recordHeartbeat(s.id, { screenSharing: true, degraded: true })
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('DEGRADED')
    await recordHeartbeat(s.id, { screenSharing: true, degraded: false })
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ACTIVE')
  })

  it('does not resurrect a finalized session', async () => {
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const s = await startSession(a)
    await finalizeSession(s.id, 'COMPLETED')
    await recordHeartbeat(s.id, { screenSharing: true, degraded: false })
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('COMPLETED')
  })
})

describe('finalizeSession', () => {
  it('marks COMPLETED and stamps endedAt', async () => {
    await prisma.proctoringSession.deleteMany({ where: { testAttemptId: attemptAId } })
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const s = await startSession(a)
    await finalizeSession(s.id)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('COMPLETED')
    expect(row.endedAt).not.toBeNull()
  })

  it('is idempotent - a second finalize changes nothing', async () => {
    await prisma.proctoringSession.deleteMany({ where: { testAttemptId: attemptAId } })
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const s = await startSession(a)
    await finalizeSession(s.id)
    const first = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    await finalizeSession(s.id, 'INTERRUPTED')
    const second = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(second.status).toBe('COMPLETED')
    expect(second.endedAt!.getTime()).toBe(first.endedAt!.getTime())
  })

  it('leaves no live session behind, so activeSessionFor reads null', async () => {
    await prisma.proctoringSession.deleteMany({ where: { testAttemptId: attemptAId } })
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const s = await startSession(a)
    await finalizeSession(s.id)
    expect(await activeSessionFor(a)).toBeNull()
  })

  it('refuses a restart after finalize with 409, not a raw Prisma 500', async () => {
    // The unique index is on the attempt FK alone, not on (attempt, status), so
    // a closed session permanently occupies its attempt - by design, one
    // session per attempt. Without an explicit branch the P2002 escapes
    // startSession and errorResponse renders it as a generic 500, which tells
    // the candidate nothing and looks like an outage.
    await prisma.proctoringSession.deleteMany({ where: { testAttemptId: attemptAId } })
    const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
    const s = await startSession(a)
    await finalizeSession(s.id)
    const err = await startSession(a).catch(e => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 409, message: 'PROCTORING_SESSION_CLOSED' })
  })
})
