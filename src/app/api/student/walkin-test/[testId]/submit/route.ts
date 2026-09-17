import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { gradeAttempt } from '@/lib/grading'
import {
  requireStudent,
  requireWalkInAttempt,
  errorResponse,
  assignedQuestionIds,
  sanitizeAnswers,
  isPastDeadline,
} from '@/lib/attempt-auth'

export async function POST(req: NextRequest, ctx: { params: Promise<{ testId: string }> }) {
  const params = await ctx.params
  try {
    const student = await requireStudent()
    const body = await req.json().catch(() => ({}))

    const attempt = await requireWalkInAttempt(body.attemptId, params.testId, student.studentId)

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

    // Past the deadline the client payload is discarded; grade what was saved.
    const expired = isPastDeadline(attempt.expiresAt)
    const incoming = expired ? {} : sanitizeAnswers(body.answers, assigned)

    const questions = await prisma.question.findMany({
      where: { id: { in: assigned } },
      select: { id: true, area: true, correctAnswer: true, weightage: true },
    })

    const violations = Array.isArray(body.violations) ? body.violations : []

    const result = await prisma.$transaction(async (tx) => {
      const entries = Object.entries(incoming)
      for (let i = 0; i < entries.length; i += 10) {
        const batch = entries.slice(i, i + 10)
        await Promise.all(batch.map(([questionId, answer]) =>
          tx.walkInResponse.upsert({
            where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
            create: { attemptId: attempt.id, questionId, selectedAnswer: answer, answeredAt: new Date() },
            update: { selectedAnswer: answer, answeredAt: new Date() },
          })
        ))
      }

      // Grade from the database, not the request body.
      const persisted = await tx.walkInResponse.findMany({
        where: { attemptId: attempt.id },
        select: { questionId: true, selectedAnswer: true },
      })
      const answers: Record<string, string> = {}
      for (const r of persisted) {
        if (r.selectedAnswer) answers[r.questionId] = r.selectedAnswer
      }

      const { graded, totalScore, areaScores } = gradeAttempt(questions, answers)

      for (let i = 0; i < graded.length; i += 10) {
        const batch = graded.slice(i, i + 10)
        await Promise.all(batch.map(g =>
          tx.walkInResponse.upsert({
            where: { attemptId_questionId: { attemptId: attempt.id, questionId: g.questionId } },
            create: {
              attemptId: attempt.id, questionId: g.questionId,
              selectedAnswer: g.selectedAnswer, isCorrect: g.isCorrect,
              marksAwarded: g.marksAwarded, answeredAt: new Date(),
            },
            update: {
              selectedAnswer: g.selectedAnswer, isCorrect: g.isCorrect,
              marksAwarded: g.marksAwarded,
            },
          })
        ))
      }

      const updated = await tx.walkInAttempt.updateMany({
        where: { id: attempt.id, isSubmitted: false },
        data: {
          isSubmitted: true,
          submittedAt: new Date(),
          totalScore,
          areaScores,
          violations,
        },
      })

      return { totalScore, areaScores, applied: updated.count === 1 }
    }, { timeout: 30000 })

    if (!result.applied) {
      const current = await prisma.walkInAttempt.findUnique({
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
    return errorResponse(err, 'Walk-in submit error', 'Submit failed. Please try again.')
  }
}
