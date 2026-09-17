/**
 * Verifies the raw bulk-write SQL in src/lib/responses.ts against the real
 * database. Everything happens inside a transaction that is rolled back, so it
 * is safe to run against production. `npx ts-node --project scripts/tsconfig.json scripts/verify-bulk.ts`
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { upsertResponses, flagResponse, newId } from '../src/lib/responses'

const prisma = new PrismaClient()

async function main() {
  const ids = new Set<string>()
  for (let i = 0; i < 50_000; i++) ids.add(newId())
  console.log(`id generator: ${ids.size}/50000 unique, sample=${newId()}`)

  const questions = await prisma.question.findMany({ take: 5, select: { id: true } })
  if (questions.length === 0) {
    console.log("NO QUESTIONS IN DB - cannot verify SQL")
    process.exitCode = 1
    return
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Fixtures are created inside the transaction and vanish with the rollback.
      const attempt = await createFixtureAttempt(tx)
      console.log("fixture attempt:", attempt.id)
      const rows = questions.map((q, i) => ({
        questionId: q.id,
        selectedAnswer: ['A', 'B', 'C', 'D'][i % 4],
      }))
      console.log('insert pass affected:', await upsertResponses(tx as any, 'CandidateResponse', attempt.id, rows))

      const graded = questions.map((q, i) => ({
        questionId: q.id,
        selectedAnswer: ['A', 'B', 'C', 'D'][i % 4],
        isCorrect: i % 2 === 0,
        marksAwarded: i % 2 === 0 ? 1 : 0,
      }))
      console.log('grade pass affected:', await upsertResponses(tx as any, 'CandidateResponse', attempt.id, graded))
      console.log('flag affected:', await flagResponse(tx as any, 'CandidateResponse', attempt.id, questions[0].id))

      const back = await tx.candidateResponse.findMany({
        where: { attemptId: attempt.id, questionId: { in: questions.map(q => q.id) } },
        select: { questionId: true, selectedAnswer: true, isCorrect: true, marksAwarded: true, answeredAt: true, flagged: true },
      })
      console.table(back)

      // Unanswered rows must not get an answeredAt stamp.
      const unanswered = await upsertResponses(tx as any, 'WalkInResponse', attempt.id, [])
      console.log('empty batch affected (expect 0):', unanswered)

      throw new Error('ROLLBACK_ON_PURPOSE')
    })
  } catch (e: any) {
    if (e.message === 'ROLLBACK_ON_PURPOSE') console.log('OK — rolled back, nothing persisted')
    else throw e
  }
}

/** Minimal college -> user -> student -> test -> schedule -> attempt chain. */
async function createFixtureAttempt(tx: any) {
  const existing = await tx.testAttempt.findFirst({ select: { id: true } })
  if (existing) return existing
  const college = await tx.college.findFirst() ?? await tx.college.create({ data: { name: "verify-bulk temp" } })
  const user = await tx.user.create({
    data: { email: `verify-bulk-${Date.now()}@example.invalid`, name: "verify-bulk", password: "x", role: "STUDENT", collegeId: college.id },
  })
  const student = await tx.studentProfile.create({
    data: { userId: user.id, collegeId: college.id, fullName: "verify-bulk", email: user.email },
  })
  const test = await tx.test.findFirst() ?? await tx.test.create({
    data: { title: "verify-bulk temp", assessmentConfig: [] },
  })
  const schedule = await tx.testSchedule.create({
    data: { testId: test.id, collegeId: college.id, scheduledAt: new Date(), endsAt: new Date(Date.now() + 3600e3) },
  })
  return tx.testAttempt.create({
    data: { scheduleId: schedule.id, studentId: student.id, userId: user.id, questionIds: [] },
  })
}

main()
  .catch(e => { console.error('FAILED:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
