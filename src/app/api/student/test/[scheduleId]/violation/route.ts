import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  requireStudent,
  requireScheduledAttempt,
  errorResponse,
  assignedQuestionIds,
} from '@/lib/attempt-auth'

/** Cap stored violations so a scripted client cannot grow the row without bound. */
const MAX_VIOLATIONS = 500

export async function POST(req: NextRequest, ctx: { params: Promise<{ scheduleId: string }> }) {
  const params = await ctx.params
  try {
    const student = await requireStudent()
    const body = await req.json().catch(() => ({}))

    const attempt = await requireScheduledAttempt(body.attemptId, params.scheduleId, student.studentId)
    if (attempt.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted' }, { status: 409 })

    const incoming = body.violation
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'Missing violation' }, { status: 400 })

    // Record only fields we control the shape of; the timestamp is the server's.
    const assigned = assignedQuestionIds(attempt.questionIds)
    const questionId =
      typeof incoming.questionId === 'string' && assigned.includes(incoming.questionId)
        ? incoming.questionId
        : null
    const type = typeof incoming.type === 'string' ? incoming.type.slice(0, 64) : 'UNKNOWN'
    const entry = { questionId, type, timestamp: new Date().toISOString() }

    const existing = Array.isArray(attempt.violations) ? attempt.violations : []
    if (existing.length >= MAX_VIOLATIONS)
      return NextResponse.json({ success: true, capped: true })

    await prisma.testAttempt.update({
      where: { id: attempt.id },
      data: { violations: [...existing, entry] },
    })

    if (questionId) {
      await prisma.candidateResponse.upsert({
        where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
        create: { attemptId: attempt.id, questionId, flagged: true },
        update: { flagged: true },
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, 'Test violation error', 'Could not record the violation.')
  }
}
