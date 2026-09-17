import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { pickQuestionsByConfig } from '@/lib/question-picker'
import {
  requireStudent,
  errorResponse,
  assignedQuestionIds,
  remainingSeconds,
} from '@/lib/attempt-auth'

/** Start (or resume) a walk-in attempt. The request body is ignored. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ testId: string }> }) {
  const params = await ctx.params
  try {
    const student = await requireStudent()

    const test = await prisma.test.findUnique({ where: { id: params.testId } })
    if (!test || !test.isActive || !test.isWalkIn)
      return NextResponse.json({ error: 'Test not available' }, { status: 404 })
    if (test.status !== 'ACTIVE')
      return NextResponse.json({ error: 'Test is not active' }, { status: 400 })

    const eligible = await prisma.walkInEligibleStudent.findUnique({
      where: { testId_studentId: { testId: params.testId, studentId: student.studentId } },
    })
    if (!eligible || !eligible.isEnabled)
      return NextResponse.json({ error: 'You are not enabled for this test' }, { status: 403 })

    let attempt = await prisma.walkInAttempt.findUnique({
      where: { testId_studentId: { testId: params.testId, studentId: student.studentId } },
    })

    if (attempt?.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted' }, { status: 400 })

    if (!attempt) {
      const questionIds = await pickQuestionsByConfig(test.assessmentConfig as any[])
      attempt = await prisma.walkInAttempt.create({
        data: {
          testId: params.testId,
          studentId: student.studentId,
          userId: student.userId,
          questionIds,
        },
      })
    }

    // Start the clock once. Resuming must not extend the deadline.
    if (!attempt.startedAt) {
      const startedAt = new Date()
      const deadline = new Date(startedAt.getTime() + test.durationMinutes * 60_000)
      attempt = await prisma.walkInAttempt.update({
        where: { id: attempt.id },
        data: { startedAt, expiresAt: deadline },
      })
      await prisma.studentProfile.update({
        where: { id: student.studentId },
        data: { status: 'APPEARED' },
      })
    }

    const assigned = assignedQuestionIds(attempt.questionIds)
    const questions = await prisma.question.findMany({
      where: { id: { in: assigned } },
      select: {
        id: true, questionText: true, optionA: true, optionB: true,
        optionC: true, optionD: true, area: true, weightage: true,
      },
    })
    const byId = new Map(questions.map(q => [q.id, q]))

    const responses = await prisma.walkInResponse.findMany({
      where: { attemptId: attempt.id },
      select: { questionId: true, selectedAnswer: true },
    })
    const savedAnswers: Record<string, string> = {}
    for (const r of responses) {
      if (r.selectedAnswer) savedAnswers[r.questionId] = r.selectedAnswer
    }

    return NextResponse.json({
      attemptId: attempt.id,
      questions: assigned.map(id => byId.get(id)).filter(Boolean),
      savedAnswers,
      remainingSeconds: remainingSeconds(attempt.expiresAt),
    })
  } catch (err) {
    return errorResponse(err, 'Walk-in start error', 'Could not start the test. Please retry.')
  }
}
