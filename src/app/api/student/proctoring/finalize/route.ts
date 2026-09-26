import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { finalizeSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, finalizeForStudent } from '@/lib/proctoring/session'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    const body = await parseBody(req, finalizeSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    // Always a success: the client calls this after submitting and must not
    // be told it failed. Before the attempt is over it closes nothing - the
    // session stays live (`completed: false`) until submit or the deadline.
    const result = await finalizeForStudent(attempt)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return errorResponse(err, 'Proctoring finalize error', 'Could not finalize proctoring.')
  }
}
