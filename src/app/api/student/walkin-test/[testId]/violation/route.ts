import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { appendViolation, flagResponse } from '@/lib/responses'
import {
  requireStudent,
  requireWalkInAttempt,
  errorResponse,
  assignedQuestionIds,
} from '@/lib/attempt-auth'

export async function POST(req: NextRequest, ctx: { params: Promise<{ testId: string }> }) {
  const params = await ctx.params
  try {
    const student = await requireStudent()
    const body = await req.json().catch(() => ({}))

    const attempt = await requireWalkInAttempt(body.attemptId, params.testId, student.studentId)
    if (attempt.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted' }, { status: 409 })

    const incoming = body.violation
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'Missing violation' }, { status: 400 })

    const assigned = assignedQuestionIds(attempt.questionIds)
    const questionId =
      typeof incoming.questionId === 'string' && assigned.includes(incoming.questionId)
        ? incoming.questionId
        : null
    const type = typeof incoming.type === 'string' ? incoming.type.slice(0, 64) : 'UNKNOWN'
    const entry = { questionId, type, timestamp: new Date().toISOString() }

    // Atomic append - see the scheduled-test violation route for the rationale.
    const stored = await appendViolation(prisma, 'WalkInAttempt', attempt.id, entry)
    if (!stored) return NextResponse.json({ success: true, capped: true })

    if (questionId) {
      await flagResponse(prisma, 'WalkInResponse', attempt.id, questionId)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, 'Walk-in violation error', 'Could not record the violation.')
  }
}
