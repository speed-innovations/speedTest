import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { finalizeSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor, finalizeSession } from '@/lib/proctoring/session'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    const body = await parseBody(req, finalizeSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    // Idempotent: already finalized is success, not a conflict. The client
    // retries this during submit and must not be told it failed.
    if (!session) return NextResponse.json({ ok: true, alreadyFinalized: true })
    await finalizeSession(session.id, 'COMPLETED')
    return NextResponse.json({ ok: true, alreadyFinalized: false })
  } catch (err) {
    return errorResponse(err, 'Proctoring finalize error', 'Could not finalize proctoring.')
  }
}
