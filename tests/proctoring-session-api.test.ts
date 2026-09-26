import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/lib/db'
import { HttpError } from '@/lib/attempt-auth'
import {
  resolveOwnedAttempt,
  startSession,
  activeSessionFor,
  recordHeartbeat,
  finalizeSession,
  finalizeForStudent,
  recordGapIfMissed,
  sweepStaleSessions,
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
  process.env.PROCTORING_HEARTBEAT_INTERVAL_MS = '20000'
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

const HEALTHY = {
  camera: 'ACTIVE', microphone: 'ACTIVE', screen: 'ACTIVE', gazeMonitor: 'RUNNING',
  clientState: 'ACTIVE', clientTimestamp: new Date().toISOString(),
} as const

/** A brand-new session on attempt A, with its events wiped by the cascade. */
async function freshA() {
  await prisma.proctoringSession.deleteMany({ where: { testAttemptId: attemptAId } })
  const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
  const { session } = await startSession(a)
  return { a, s: session }
}

const eventsOf = (sessionId: string, type: 'HEARTBEAT_MISSED' | 'PROCTORING_RESUMED') =>
  prisma.proctoringEvent.findMany({ where: { proctoringSessionId: sessionId, type } })

describe('startSession', () => {
  it('creates an ACTIVE session', async () => {
    const { s } = await freshA()
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('ACTIVE')
    expect(row.testAttemptId).toBe(attemptAId)
    expect(row.walkInAttemptId).toBeNull()
    expect(row.lastHeartbeatAt).not.toBeNull()
  })

  it('is idempotent - a second call returns the same session, not resumed', async () => {
    const { a, s } = await freshA()
    const again = await startSession(a)
    expect(again.session.id).toBe(s.id)
    expect(again.resumed).toBe(false)
    expect(await prisma.proctoringSession.count({ where: { testAttemptId: attemptAId } })).toBe(1)
  })

  it('creates a walk-in session against the other FK', async () => {
    await prisma.proctoringSession.deleteMany({ where: { walkInAttemptId } })
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    const { session } = await startSession(a)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: session.id } })
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

  it('refuses with 503 when proctoring is globally disabled, and needs no storage', async () => {
    process.env.PROCTORING_ENABLED = 'false'
    resetProctoringConfigForTests()
    await prisma.proctoringSession.deleteMany({ where: { walkInAttemptId } })
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    await expect(startSession(a)).rejects.toMatchObject({ status: 503, message: 'PROCTORING_DISABLED' })
  })

  it('refuses with 503 when proctoring is switched non-operational', async () => {
    process.env.PROCTORING_OPERATIONAL = 'false'
    resetProctoringConfigForTests()
    await prisma.proctoringSession.deleteMany({ where: { walkInAttemptId } })
    const a = await resolveOwnedAttempt(walkInAttemptId, 'walkin', walkInTestId, studentAId)
    await expect(startSession(a)).rejects.toMatchObject({ status: 503, message: 'PROCTORING_NOT_OPERATIONAL' })
  })

  it('resumes an INTERRUPTED session in place and records that it did', async () => {
    const { a, s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { status: 'INTERRUPTED', endedAt: new Date() } })
    const resumed = await startSession(a)
    expect(resumed.resumed).toBe(true)
    expect(resumed.session.id).toBe(s.id)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('ACTIVE')
    expect(row.endedAt).toBeNull()
    const resumeEvents = await eventsOf(s.id, 'PROCTORING_RESUMED')
    expect(resumeEvents.length).toBe(1)
    expect(typeof (resumeEvents[0].metadata as { interruptedAt: number }).interruptedAt).toBe('number')
  })

  it('does not resume once the attempt deadline has passed', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { status: 'INTERRUPTED' } })
    await prisma.testAttempt.update({ where: { id: attemptAId }, data: { expiresAt: new Date(Date.now() - 10 * 60_000) } })
    try {
      const a = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
      await expect(startSession(a)).rejects.toMatchObject({ status: 409, message: 'PROCTORING_SESSION_CLOSED' })
    } finally {
      await prisma.testAttempt.update({ where: { id: attemptAId }, data: { expiresAt: null } })
    }
  })

  // Valid only for a genuinely COMPLETED session: COMPLETED is written by the
  // submit route or by finalizeForStudent once the attempt is over, never
  // before (see 'finalizeForStudent' below), so this cannot lock out a
  // candidate whose submit failed.
  it('never reopens a COMPLETED session', async () => {
    const { a, s } = await freshA()
    await finalizeSession(s.id)
    const err = await startSession(a).catch(e => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err).toMatchObject({ status: 409, message: 'PROCTORING_SESSION_CLOSED' })
  })
})

describe('recordHeartbeat', () => {
  it('advances lastHeartbeatAt and stores device health', async () => {
    const { s } = await freshA()
    const before = new Date(Date.now() - 5_000)
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: before } })
    const r = await recordHeartbeat(s.id, HEALTHY)
    expect(r).toMatchObject({ live: true, status: 'ACTIVE', degraded: false, missed: false })
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.lastHeartbeatAt!.getTime()).toBeGreaterThan(before.getTime())
    expect(row.screenShareStarted).toBe(true)
    expect(row.lastHealth).toMatchObject({ camera: 'ACTIVE', screen: 'ACTIVE', gazeMonitor: 'RUNNING' })
  })

  it('camera stopped: DEGRADED; camera back: ACTIVE again', async () => {
    const { s } = await freshA()
    expect((await recordHeartbeat(s.id, { ...HEALTHY, camera: 'ENDED' })).status).toBe('DEGRADED')
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('DEGRADED')
    expect((await recordHeartbeat(s.id, HEALTHY)).status).toBe('ACTIVE')
  })

  it('microphone muted, screen stopped, or no gaze analysis are each DEGRADED', async () => {
    const { s } = await freshA()
    expect((await recordHeartbeat(s.id, { ...HEALTHY, microphone: 'MUTED' })).degraded).toBe(true)
    expect((await recordHeartbeat(s.id, { ...HEALTHY, screen: 'ENDED' })).degraded).toBe(true)
    expect((await recordHeartbeat(s.id, { ...HEALTHY, gazeMonitor: 'UNAVAILABLE' })).degraded).toBe(true)
  })

  it('gazeMonitor STOPPED on a live session is DEGRADED', async () => {
    const { s } = await freshA()
    const r = await recordHeartbeat(s.id, { ...HEALTHY, gazeMonitor: 'STOPPED' })
    expect(r.status).toBe('DEGRADED')
  })

  it('heartbeat failure: a long gap is recorded once, server-side', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date(Date.now() - 120_000) } })
    expect((await recordHeartbeat(s.id, HEALTHY)).missed).toBe(true)
    // Heartbeat recovery: the next one on time records nothing more.
    expect((await recordHeartbeat(s.id, HEALTHY)).missed).toBe(false)
    const gaps = await eventsOf(s.id, 'HEARTBEAT_MISSED')
    expect(gaps.length).toBe(1)
    expect(gaps[0].durationMs).toBeGreaterThanOrEqual(119_000)
    expect(gaps[0].metadata).toEqual({ source: 'heartbeat' })
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).missedHeartbeatCount).toBe(1)
  })

  it('a heartbeat at normal cadence records no gap', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date(Date.now() - 20_000) } })
    expect((await recordHeartbeat(s.id, HEALTHY)).missed).toBe(false)
  })

  it('does not resurrect a finalized session', async () => {
    const { s } = await freshA()
    await finalizeSession(s.id, 'COMPLETED')
    expect((await recordHeartbeat(s.id, HEALTHY)).live).toBe(false)
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('COMPLETED')
  })
})

describe('recordGapIfMissed', () => {
  it('stores one row for one gap however many callers notice it', async () => {
    const { s } = await freshA()
    const since = new Date(Date.now() - 300_000)
    const now = new Date()
    expect(await recordGapIfMissed(s.id, since, now, 50_000, 'heartbeat')).toBe(true)
    expect(await recordGapIfMissed(s.id, since, now, 50_000, 'sweep')).toBe(false)
    expect((await eventsOf(s.id, 'HEARTBEAT_MISSED')).length).toBe(1)
  })
})

describe('finalizeSession', () => {
  it('marks COMPLETED and stamps endedAt', async () => {
    const { s } = await freshA()
    await finalizeSession(s.id)
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('COMPLETED')
    expect(row.endedAt).not.toBeNull()
  })

  it('is idempotent - a second finalize changes nothing', async () => {
    const { s } = await freshA()
    await finalizeSession(s.id)
    const first = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    await finalizeSession(s.id, 'INTERRUPTED')
    const second = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(second.status).toBe('COMPLETED')
    expect(second.endedAt!.getTime()).toBe(first.endedAt!.getTime())
  })

  it('leaves no live session behind', async () => {
    const { a, s } = await freshA()
    await finalizeSession(s.id)
    expect(await activeSessionFor(a)).toBeNull()
  })

  it('records the trailing gap of a client that stopped heartbeating before submit', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date(Date.now() - 5 * 60_000) } })
    await finalizeSession(s.id)
    const gaps = await eventsOf(s.id, 'HEARTBEAT_MISSED')
    expect(gaps.length).toBe(1)
    expect(gaps[0].metadata).toEqual({ source: 'finalize' })
  })
})

describe("finalizeForStudent (the candidate's own finalize)", () => {
  it('before submit and before the deadline: a no-op, the session stays live', async () => {
    const { a, s } = await freshA()
    expect(await finalizeForStudent(a)).toEqual({ alreadyFinalized: false, completed: false })
    const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
    expect(row.status).toBe('ACTIVE')
    expect(row.endedAt).toBeNull()
    expect((await activeSessionFor(a))?.id).toBe(s.id)
  })

  it('a failed submit followed by a reload resumes monitoring rather than locking the candidate out', async () => {
    const { a, s } = await freshA()
    await finalizeForStudent(a) // the client's call; the submit then fails
    const again = await startSession(a)
    expect(again.session.id).toBe(s.id)
    expect(again.resumed).toBe(false)
  })

  it('after submit: completes the session', async () => {
    const { s } = await freshA()
    await prisma.testAttempt.update({ where: { id: attemptAId }, data: { isSubmitted: true, submittedAt: new Date() } })
    try {
      const submitted = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
      expect(await finalizeForStudent(submitted)).toEqual({ alreadyFinalized: false, completed: true })
      const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
      expect(row.status).toBe('COMPLETED')
      expect(row.endedAt).not.toBeNull()
      // Idempotent: the submit route's safety net or a retry finds nothing live.
      expect(await finalizeForStudent(submitted)).toEqual({ alreadyFinalized: true, completed: false })
    } finally {
      await prisma.testAttempt.update({ where: { id: attemptAId }, data: { isSubmitted: false, submittedAt: null } })
    }
  })

  it('past the deadline: completes the session', async () => {
    const { s } = await freshA()
    await prisma.testAttempt.update({ where: { id: attemptAId }, data: { expiresAt: new Date(Date.now() - 10 * 60_000) } })
    try {
      const expired = await resolveOwnedAttempt(attemptAId, 'scheduled', proctoredScheduleId, studentAId)
      expect(await finalizeForStudent(expired)).toEqual({ alreadyFinalized: false, completed: true })
      const row = await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })
      expect(row.status).toBe('COMPLETED')
    } finally {
      await prisma.testAttempt.update({ where: { id: attemptAId }, data: { expiresAt: null } })
    }
  })
})

describe('sweepStaleSessions', () => {
  it('interrupts a stale session, records the gap, and leaves it resumable', async () => {
    const { a, s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) } })
    await sweepStaleSessions()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('INTERRUPTED')
    const gaps = await eventsOf(s.id, 'HEARTBEAT_MISSED')
    expect(gaps.length).toBe(1)
    expect(gaps[0].metadata).toEqual({ source: 'sweep' })
    expect((await startSession(a)).resumed).toBe(true)
  })

  it('never interrupts a session with a fresh heartbeat, and records no gap', async () => {
    const { s } = await freshA()
    await prisma.proctoringSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: new Date() } })
    await sweepStaleSessions()
    expect((await prisma.proctoringSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ACTIVE')
    expect((await eventsOf(s.id, 'HEARTBEAT_MISSED')).length).toBe(0)
  })
})
