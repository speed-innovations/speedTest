import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { pickQuestionsByConfig } from '@/lib/question-picker'
import {
  requireStudent,
  errorResponse,
  assignedQuestionIds,
  remainingSeconds,
  isUniqueViolation,
} from '@/lib/attempt-auth'

export async function GET(req: NextRequest, ctx: { params: Promise<{ scheduleId: string }> }) {
  const params = await ctx.params
  try {
    const student = await requireStudent()

    const schedule = await prisma.testSchedule.findUnique({
      where: { id: params.scheduleId },
      include: { test: { include: { jobOpening: true } }, college: true },
    })

    if (!schedule)
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    if (schedule.collegeId !== student.collegeId)
      return NextResponse.json({ error: 'Not authorized for this test' }, { status: 403 })

    const now = new Date()
    if (now < new Date(schedule.scheduledAt))
      return NextResponse.json({ error: 'Test has not started yet' }, { status: 400 })
    if (now > new Date(schedule.endsAt))
      return NextResponse.json({ error: 'Test has ended' }, { status: 400 })

    let attempt = await prisma.testAttempt.findUnique({
      where: {
        scheduleId_studentId: { scheduleId: params.scheduleId, studentId: student.studentId },
      },
      include: { responses: { select: { questionId: true, selectedAnswer: true } } },
    })

    if (attempt?.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted', isSubmitted: true }, { status: 400 })

    // The server owns the question set. It is chosen and persisted here, before
    // the student can influence it, and never accepted from the request body.
    if (!attempt) {
      const questionIds = await pickQuestionsByConfig(schedule.test.assessmentConfig as any[])
      const where = {
        scheduleId_studentId: { scheduleId: params.scheduleId, studentId: student.studentId },
      }
      const include = { responses: { select: { questionId: true, selectedAnswer: true } } }
      try {
        attempt = await prisma.testAttempt.create({
          data: {
            scheduleId: params.scheduleId,
            studentId: student.studentId,
            userId: student.userId,
            questionIds,
          },
          include,
        })
      } catch (err) {
        // This route and /start both create the attempt lazily, so a page load
        // racing the Start click can arrive twice. The unique index settles it;
        // the loser reads the winner's row instead of failing.
        if (!isUniqueViolation(err)) throw err
        // Read the winner inside a transaction: Hyperdrive does not cache
        // reads made in one, so this cannot come back as a stale "no row"
        // from the same SELECT that just lost the race.
        attempt = await prisma.$transaction(tx => tx.testAttempt.findUniqueOrThrow({ where, include }))
      }
    }

    const assigned = assignedQuestionIds(attempt.questionIds)

    // Questions are withheld until the attempt is explicitly started. Serving
    // them earlier would let a student read the paper with the clock stopped.
    if (!attempt.startedAt) {
      return NextResponse.json({
        schedule,
        started: false,
        isSubmitted: false,
        questionCount: assigned.length,
        attemptId: attempt.id,
        questions: [],
        savedAnswers: {},
      })
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: assigned } },
      select: {
        id: true, questionText: true, optionA: true, optionB: true,
        optionC: true, optionD: true, area: true, weightage: true,
      },
    })
    const byId = new Map(questions.map(q => [q.id, q]))
    const orderedQuestions = assigned.map(id => byId.get(id)).filter(Boolean)

    const savedAnswers: Record<string, string> = {}
    for (const r of attempt.responses) {
      if (r.selectedAnswer) savedAnswers[r.questionId] = r.selectedAnswer
    }

    return NextResponse.json({
      schedule,
      started: true,
      isSubmitted: false,
      questions: orderedQuestions,
      questionCount: orderedQuestions.length,
      attemptId: attempt.id,
      savedAnswers,
      remainingSeconds: remainingSeconds(attempt.expiresAt),
    })
  } catch (err) {
    return errorResponse(err, 'Test GET error', 'Failed to load test. Please refresh.')
  }
}
