import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db'
import { isUniqueViolation } from '@/lib/attempt-auth'
import {
  upsertResponses,
  flagResponse,
  appendViolation,
  newId,
  MAX_VIOLATIONS,
} from '@/lib/responses'

/**
 * Integration tests for the bulk answer writes against a real database.
 *
 * These replaced per-row upserts so a whole paper costs one round trip instead
 * of one per question. The statements are hand-written SQL, so the semantics
 * the routes rely on - answeredAt set once, grading not wiping answers, an
 * answer write not clearing `flagged`, violations appending atomically - are
 * only guaranteed by exercising them.
 *
 * Requires DATABASE_URL. Creates and removes its own fixtures.
 */

const TAG = `responses-test-${Date.now()}`

let attemptId: string
let questionIds: string[] = []
const cleanup = {
  userId: '', studentId: '', scheduleId: '', testId: '', collegeId: '',
}

beforeAll(async () => {
  const college = await prisma.college.create({ data: { name: TAG } })
  cleanup.collegeId = college.id

  const user = await prisma.user.create({
    data: { email: `${TAG}@example.invalid`, name: TAG, password: 'x', role: 'STUDENT', collegeId: college.id },
  })
  cleanup.userId = user.id

  const student = await prisma.studentProfile.create({
    data: { userId: user.id, collegeId: college.id, fullName: TAG, email: user.email },
  })
  cleanup.studentId = student.id

  const test = await prisma.test.create({
    data: { title: TAG, assessmentConfig: [] },
  })
  cleanup.testId = test.id

  const schedule = await prisma.testSchedule.create({
    data: {
      testId: test.id, collegeId: college.id,
      scheduledAt: new Date(), endsAt: new Date(Date.now() + 3600_000),
    },
  })
  cleanup.scheduleId = schedule.id

  const questions = await prisma.question.findMany({ take: 3, select: { id: true } })
  if (questions.length < 3) throw new Error('needs at least 3 questions in the bank')
  questionIds = questions.map(q => q.id)

  const attempt = await prisma.testAttempt.create({
    data: { scheduleId: schedule.id, studentId: student.id, userId: user.id, questionIds },
  })
  attemptId = attempt.id
})

afterAll(async () => {
  await prisma.candidateResponse.deleteMany({ where: { attemptId } })
  await prisma.testAttempt.deleteMany({ where: { id: attemptId } })
  await prisma.testSchedule.deleteMany({ where: { id: cleanup.scheduleId } })
  await prisma.test.deleteMany({ where: { id: cleanup.testId } })
  await prisma.studentProfile.deleteMany({ where: { id: cleanup.studentId } })
  await prisma.user.deleteMany({ where: { id: cleanup.userId } })
  await prisma.college.deleteMany({ where: { id: cleanup.collegeId } })
})

describe('newId', () => {
  it('produces unique, cuid-shaped ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 20_000; i++) ids.add(newId())
    expect(ids.size).toBe(20_000)
    for (const id of Array.from(ids).slice(0, 100)) {
      expect(id).toMatch(/^c[a-z0-9]{15,}$/)
    }
  })
})

describe('isUniqueViolation', () => {
  it('recognises P2002 and nothing else', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true)
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})

describe('upsertResponses', () => {
  it('is a no-op for an empty batch', async () => {
    expect(await upsertResponses(prisma, 'CandidateResponse', attemptId, [])).toBe(0)
  })

  it('inserts answers and stamps answeredAt', async () => {
    const n = await upsertResponses(prisma, 'CandidateResponse', attemptId, [
      { questionId: questionIds[0], selectedAnswer: 'A' },
      { questionId: questionIds[1], selectedAnswer: 'B' },
    ])
    expect(n).toBe(2)

    const rows = await prisma.candidateResponse.findMany({
      where: { attemptId }, orderBy: { questionId: 'asc' },
    })
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.answeredAt).toBeInstanceOf(Date)
      expect(r.isCorrect).toBeNull()
      expect(r.flagged).toBe(false)
    }
  })

  it('updates an answer in place rather than duplicating the row', async () => {
    await upsertResponses(prisma, 'CandidateResponse', attemptId, [
      { questionId: questionIds[0], selectedAnswer: 'C' },
    ])
    const rows = await prisma.candidateResponse.findMany({ where: { attemptId, questionId: questionIds[0] } })
    expect(rows).toHaveLength(1)
    expect(rows[0].selectedAnswer).toBe('C')
  })

  it('keeps the original answeredAt when grading writes the same row', async () => {
    const before = await prisma.candidateResponse.findFirstOrThrow({
      where: { attemptId, questionId: questionIds[0] },
    })
    await new Promise(r => setTimeout(r, 20))

    await upsertResponses(prisma, 'CandidateResponse', attemptId, [
      { questionId: questionIds[0], selectedAnswer: 'C', isCorrect: true, marksAwarded: 1 },
    ])

    const after = await prisma.candidateResponse.findFirstOrThrow({
      where: { attemptId, questionId: questionIds[0] },
    })
    expect(after.answeredAt?.getTime()).toBe(before.answeredAt?.getTime())
    expect(after.isCorrect).toBe(true)
    expect(after.marksAwarded).toBe(1)
  })

  it('does not erase a saved answer when grading an unanswered question', async () => {
    // The grading pass sends every assigned question, including ones with no
    // answer. That must not blank out answers saved during the exam.
    await upsertResponses(prisma, 'CandidateResponse', attemptId, [
      { questionId: questionIds[0], selectedAnswer: null, isCorrect: false, marksAwarded: 0 },
    ])
    const row = await prisma.candidateResponse.findFirstOrThrow({
      where: { attemptId, questionId: questionIds[0] },
    })
    expect(row.selectedAnswer).toBe('C')
  })

  it('creates a row with no answeredAt for a question that was never answered', async () => {
    await upsertResponses(prisma, 'CandidateResponse', attemptId, [
      { questionId: questionIds[2], selectedAnswer: null, isCorrect: false, marksAwarded: 0 },
    ])
    const row = await prisma.candidateResponse.findFirstOrThrow({
      where: { attemptId, questionId: questionIds[2] },
    })
    expect(row.selectedAnswer).toBeNull()
    expect(row.answeredAt).toBeNull()
    expect(row.isCorrect).toBe(false)
  })
})

describe('flagResponse', () => {
  it('flags a question without disturbing its answer, and survives later answer writes', async () => {
    await flagResponse(prisma, 'CandidateResponse', attemptId, questionIds[0])
    let row = await prisma.candidateResponse.findFirstOrThrow({
      where: { attemptId, questionId: questionIds[0] },
    })
    expect(row.flagged).toBe(true)
    expect(row.selectedAnswer).toBe('C')

    await upsertResponses(prisma, 'CandidateResponse', attemptId, [
      { questionId: questionIds[0], selectedAnswer: 'D' },
    ])
    row = await prisma.candidateResponse.findFirstOrThrow({
      where: { attemptId, questionId: questionIds[0] },
    })
    expect(row.flagged).toBe(true)
    expect(row.selectedAnswer).toBe('D')
  })

  it('creates the row when the question has not been answered', async () => {
    const fresh = questionIds[1]
    await prisma.candidateResponse.deleteMany({ where: { attemptId, questionId: fresh } })
    await flagResponse(prisma, 'CandidateResponse', attemptId, fresh)
    const row = await prisma.candidateResponse.findFirstOrThrow({ where: { attemptId, questionId: fresh } })
    expect(row.flagged).toBe(true)
    expect(row.selectedAnswer).toBeNull()
  })
})

describe('appendViolation', () => {
  it('loses nothing when reports arrive concurrently', async () => {
    // One alt-tab fires both `visibilitychange` and `blur`, so overlapping
    // reports are normal. Read-modify-write in the route dropped them.
    await prisma.testAttempt.update({ where: { id: attemptId }, data: { violations: [] } })

    const entries = Array.from({ length: 15 }, (_, i) => ({
      questionId: questionIds[0],
      type: `CONCURRENT_${i}`,
      timestamp: new Date().toISOString(),
    }))
    const results = await Promise.all(
      entries.map(e => appendViolation(prisma, 'TestAttempt', attemptId, e))
    )
    expect(results.every(Boolean)).toBe(true)

    const attempt = await prisma.testAttempt.findUniqueOrThrow({ where: { id: attemptId } })
    const stored = attempt.violations as { type: string }[]
    expect(stored).toHaveLength(15)
    expect(new Set(stored.map(v => v.type)).size).toBe(15)
  })

  it('stops appending at the cap and reports it', async () => {
    const filler = Array.from({ length: MAX_VIOLATIONS }, (_, i) => ({
      questionId: null, type: `FILL_${i}`, timestamp: new Date().toISOString(),
    }))
    await prisma.testAttempt.update({ where: { id: attemptId }, data: { violations: filler } })

    const stored = await appendViolation(prisma, 'TestAttempt', attemptId, {
      questionId: null, type: 'OVER_CAP', timestamp: new Date().toISOString(),
    })
    expect(stored).toBe(false)

    const attempt = await prisma.testAttempt.findUniqueOrThrow({ where: { id: attemptId } })
    expect((attempt.violations as unknown[]).length).toBe(MAX_VIOLATIONS)
  })
})
