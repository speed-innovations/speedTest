import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { gradeAttempt } from '@/lib/grading'
import { upsertResponses } from '@/lib/responses'
import {
  requireStudent,
  requireScheduledAttempt,
  errorResponse,
  assignedQuestionIds,
  sanitizeAnswers,
  isPastDeadline,
} from '@/lib/attempt-auth'

export async function POST(req: NextRequest, ctx: { params: Promise<{ scheduleId: string }> }) {
  const params = await ctx.params
  try {
    const student = await requireStudent()
    const body = await req.json().catch(() => ({}))

    const attempt = await requireScheduledAttempt(body.attemptId, params.scheduleId, student.studentId)

    // Idempotent: a retry after a successful submit returns the stored result.
    if (attempt.isSubmitted) {
      return NextResponse.json({
        success: true,
        totalScore: attempt.totalScore,
        areaScores: attempt.areaScores,
      })
    }
    if (!attempt.startedAt)
      return NextResponse.json({ error: 'Test has not been started' }, { status: 409 })

    const assigned = assignedQuestionIds(attempt.questionIds)

    // Past the deadline the client payload is discarded and the attempt is graded
    // on what was already saved, so a late submit cannot add answers.
    const expired = isPastDeadline(attempt.expiresAt)
    const incoming = expired ? {} : sanitizeAnswers(body.answers, assigned)

    const questions = await prisma.question.findMany({
      where: { id: { in: assigned } },
      select: { id: true, area: true, correctAnswer: true, weightage: true },
    })

    // Violations recorded through the violation endpoint are authoritative. The
    // client copy only seeds an attempt that has none, so a submit cannot erase
    // what the server already saw.
    const serverViolations = Array.isArray(attempt.violations) ? attempt.violations : []
    const clientViolations = Array.isArray(body.violations) ? body.violations.slice(0, 500) : []
    const violationsPatch =
      serverViolations.length === 0 && clientViolations.length > 0
        ? { violations: clientViolations }
        : {}

    // Four round trips, whatever the paper length. This used to be one upsert
    // per question inside the transaction, so a 60 question paper held a
    // connection open across ~130 sequential round trips - with a cohort
    // finishing in the same minute that is what exhausted the pool.
    const result = await prisma.$transaction(async (tx) => {
      // Persist whatever the client sent that survived sanitizing.
      await upsertResponses(
        tx,
        'CandidateResponse',
        attempt.id,
        Object.entries(incoming).map(([questionId, selectedAnswer]) => ({ questionId, selectedAnswer }))
      )

      // Grade from the database, not the request. This is the single source of
      // truth and covers answers saved earlier but missing from this payload.
      const persisted = await tx.candidateResponse.findMany({
        where: { attemptId: attempt.id },
        select: { questionId: true, selectedAnswer: true },
      })
      const answers: Record<string, string> = {}
      for (const r of persisted) {
        if (r.selectedAnswer) answers[r.questionId] = r.selectedAnswer
      }

      const { graded, totalScore, areaScores } = gradeAttempt(questions, answers)

      await upsertResponses(tx, 'CandidateResponse', attempt.id, graded)

      // Guard against a concurrent submit landing first.
      const updated = await tx.testAttempt.updateMany({
        where: { id: attempt.id, isSubmitted: false },
        data: {
          isSubmitted: true,
          submittedAt: new Date(),
          totalScore,
          areaScores,
          ...violationsPatch,
        },
      })

      return { totalScore, areaScores, applied: updated.count === 1 }
    }, { timeout: 20_000, maxWait: 10_000 })

    if (!result.applied) {
      const current = await prisma.testAttempt.findUnique({
        where: { id: attempt.id },
        select: { totalScore: true, areaScores: true },
      })
      return NextResponse.json({
        success: true,
        totalScore: current?.totalScore,
        areaScores: current?.areaScores,
      })
    }

    return NextResponse.json({
      success: true,
      totalScore: result.totalScore,
      areaScores: result.areaScores,
      expired,
    })
  } catch (err) {
    return errorResponse(err, 'Test submit error', 'Submit failed. Please try again.')
  }
}
