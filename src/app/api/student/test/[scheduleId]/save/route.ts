import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
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

    if (attempt.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted' }, { status: 409 })
    if (!attempt.startedAt)
      return NextResponse.json({ error: 'Test has not been started' }, { status: 409 })
    if (isPastDeadline(attempt.expiresAt))
      return NextResponse.json({ error: 'Time is up' }, { status: 409 })

    const raw: Record<string, unknown> = { ...(body.answers ?? {}) }
    // Backward compat: single save { attemptId, questionId, answer }
    if (body.questionId && body.answer) raw[body.questionId] = body.answer

    const answers = sanitizeAnswers(raw, assignedQuestionIds(attempt.questionIds))
    const entries = Object.entries(answers)
    if (entries.length === 0) return NextResponse.json({ saved: true, count: 0 })

    for (let i = 0; i < entries.length; i += 5) {
      const batch = entries.slice(i, i + 5)
      await Promise.all(batch.map(([questionId, answer]) =>
        prisma.candidateResponse.upsert({
          where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
          create: { attemptId: attempt.id, questionId, selectedAnswer: answer, answeredAt: new Date() },
          update: { selectedAnswer: answer, answeredAt: new Date() },
        })
      ))
    }

    return NextResponse.json({ saved: true, count: entries.length })
  } catch (err) {
    return errorResponse(err, 'Test save error', 'Could not save your answer.')
  }
}
