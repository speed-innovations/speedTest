import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { requireScheduledAttempt, requireWalkInAttempt, HttpError } from '@/lib/attempt-auth'

/**
 * Integration test for attempt ownership against a real database.
 *
 * Before the fix, every attempt-scoped route took `attemptId` from the request
 * body and never checked who owned it, so any student could submit against
 * another student's attempt. These tests fail loudly if that regresses.
 *
 * Requires DATABASE_URL. Creates and removes its own fixtures.
 */

const TAG = `ownership-test-${Date.now()}`

let collegeId: string
let otherCollegeId: string
let studentAId: string
let studentBId: string
let scheduleId: string
let walkInTestId: string
let attemptAId: string
let walkInAttemptAId: string
const userIds: string[] = []
let testId: string

async function makeStudent(email: string, cId: string) {
  const user = await prisma.user.create({
    data: { email, name: TAG, password: 'x', role: 'STUDENT' },
  })
  userIds.push(user.id)
  const profile = await prisma.studentProfile.create({
    data: { userId: user.id, collegeId: cId, fullName: TAG, email },
  })
  return { userId: user.id, studentId: profile.id }
}

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: `${TAG}-college-a` } })
  const otherCollege = await prisma.college.create({ data: { name: `${TAG}-college-b` } })
  collegeId = college.id
  otherCollegeId = otherCollege.id

  const a = await makeStudent(`${TAG}-a@example.test`, collegeId)
  const b = await makeStudent(`${TAG}-b@example.test`, otherCollegeId)
  studentAId = a.studentId
  studentBId = b.studentId

  const test = await prisma.test.create({
    data: {
      title: `${TAG}-test`,
      durationMinutes: 60,
      assessmentConfig: [{ area: 'APTITUDE', count: 3 }],
    },
  })
  testId = test.id

  const schedule = await prisma.testSchedule.create({
    data: {
      testId: test.id,
      collegeId,
      scheduledAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3600_000),
    },
  })
  scheduleId = schedule.id

  const attemptA = await prisma.testAttempt.create({
    data: { scheduleId, studentId: studentAId, userId: a.userId, questionIds: ['q1', 'q2'] },
  })
  attemptAId = attemptA.id

  const walkInTest = await prisma.test.create({
    data: {
      title: `${TAG}-walkin`,
      durationMinutes: 30,
      isWalkIn: true,
      status: 'ACTIVE',
      assessmentConfig: [{ area: 'APTITUDE', count: 3 }],
    },
  })
  walkInTestId = walkInTest.id

  const walkInAttemptA = await prisma.walkInAttempt.create({
    data: { testId: walkInTestId, studentId: studentAId, userId: a.userId, questionIds: ['q1'] },
  })
  walkInAttemptAId = walkInAttemptA.id
})

afterAll(async () => {
  await prisma.candidateResponse.deleteMany({ where: { attemptId: attemptAId } })
  await prisma.walkInResponse.deleteMany({ where: { attemptId: walkInAttemptAId } })
  await prisma.testAttempt.deleteMany({ where: { scheduleId } })
  await prisma.walkInAttempt.deleteMany({ where: { testId: walkInTestId } })
  await prisma.testSchedule.deleteMany({ where: { id: scheduleId } })
  await prisma.test.deleteMany({ where: { id: { in: [testId, walkInTestId] } } })
  await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.college.deleteMany({ where: { id: { in: [collegeId, otherCollegeId] } } })
  await prisma.$disconnect()
})

describe('requireScheduledAttempt', () => {
  it('returns the attempt to its owner', async () => {
    const attempt = await requireScheduledAttempt(attemptAId, scheduleId, studentAId)
    expect(attempt.id).toBe(attemptAId)
  })

  it('refuses a different student — the original IDOR', async () => {
    await expect(
      requireScheduledAttempt(attemptAId, scheduleId, studentBId)
    ).rejects.toBeInstanceOf(HttpError)
  })

  it('does not reveal that the attempt exists to a non-owner', async () => {
    // 404, not 403: a 403 would confirm a valid attempt id to an attacker.
    await expect(
      requireScheduledAttempt(attemptAId, scheduleId, studentBId)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses an attempt driven through the wrong schedule', async () => {
    await expect(
      requireScheduledAttempt(attemptAId, 'some-other-schedule-id', studentAId)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('rejects a missing or malformed attemptId with 400', async () => {
    await expect(requireScheduledAttempt(undefined, scheduleId, studentAId))
      .rejects.toMatchObject({ status: 400 })
    await expect(requireScheduledAttempt({ id: attemptAId }, scheduleId, studentAId))
      .rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 for an attempt id that does not exist', async () => {
    await expect(requireScheduledAttempt('nope', scheduleId, studentAId))
      .rejects.toMatchObject({ status: 404 })
  })
})

describe('requireWalkInAttempt', () => {
  it('returns the attempt to its owner', async () => {
    const attempt = await requireWalkInAttempt(walkInAttemptAId, walkInTestId, studentAId)
    expect(attempt.id).toBe(walkInAttemptAId)
  })

  it('refuses a different student', async () => {
    await expect(
      requireWalkInAttempt(walkInAttemptAId, walkInTestId, studentBId)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('refuses an attempt driven through the wrong test', async () => {
    await expect(
      requireWalkInAttempt(walkInAttemptAId, testId, studentAId)
    ).rejects.toMatchObject({ status: 404 })
  })
})
