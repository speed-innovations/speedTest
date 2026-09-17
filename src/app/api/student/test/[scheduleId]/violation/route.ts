import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { appendViolation, flagResponse } from '@/lib/responses'
import {
  requireStudent,
  requireScheduledAttempt,
  errorResponse,
  assignedQuestionIds,
} from '@/lib/attempt-auth'

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

    // Appended in the database rather than read-modify-written here: one alt-tab
    // fires both `visibilitychange` and `blur`, so two requests used to read the
    // same array and the second overwrote the first. The cap is applied in the
    // same statement.
    const stored = await appendViolation(prisma, 'TestAttempt', attempt.id, entry)
    if (!stored) return NextResponse.json({ success: true, capped: true })

    if (questionId) {
      await flagResponse(prisma, 'CandidateResponse', attempt.id, questionId)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, 'Test violation error', 'Could not record the violation.')
  }
}
