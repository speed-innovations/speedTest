import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { pickQuestionsByConfig } from '@/lib/question-picker'
import {
  requireStudent,
  errorResponse,
  assignedQuestionIds,
  remainingSeconds,
} from '@/lib/attempt-auth'

/**
 * Start (or resume) an attempt.
 *
 * The request body is ignored entirely. Earlier this route accepted
 * `questionIds` from the client, which let a student choose their own paper.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ scheduleId: string }> }) {
  const params = await ctx.params
  try {
    const student = await requireStudent()

    const schedule = await prisma.testSchedule.findUnique({
      where: { id: params.scheduleId },
      include: { test: true },
    })
    if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
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
    })

    if (attempt?.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted' }, { status: 400 })

    if (!attempt) {
      const questionIds = await pickQuestionsByConfig(schedule.test.assessmentConfig as any[])
      attempt = await prisma.testAttempt.create({
        data: {
          scheduleId: params.scheduleId,
          studentId: student.studentId,
          userId: student.userId,
          questionIds,
        },
      })
    }

    // Start the clock once, on first start. Resuming must not extend the deadline.
    if (!attempt.startedAt) {
      const startedAt = new Date()
      const durationMs = schedule.test.durationMinutes * 60_000
      // The attempt can never outlive the schedule window.
      const deadline = new Date(
        Math.min(startedAt.getTime() + durationMs, new Date(schedule.endsAt).getTime())
      )
      attempt = await prisma.testAttempt.update({
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

    const responses = await prisma.candidateResponse.findMany({
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
    return errorResponse(err, 'Test start error', 'Could not start the test. Please retry.')
  }
}
