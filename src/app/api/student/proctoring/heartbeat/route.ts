import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { heartbeatSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor, recordHeartbeat } from '@/lib/proctoring/session'
import { rateLimit } from '@/lib/proctoring/rate-limit'

/**
 * Liveness and device health. No media passes through here.
 *
 * The session id in the body must be the caller's own live session, resolved
 * from their own attempt. Naming anyone else's session is a 404 - it never
 * confirms that the id exists.
 */
export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    // Normal cadence is ~3/min; 12 allows retries without letting a client hammer it.
    if (!rateLimit(`heartbeat:${student.studentId}`, 12, 60_000)) {
      throw new HttpError(429, 'Too many heartbeats. Please wait a moment.')
    }
    const body = await parseBody(req, heartbeatSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    // Not an error: the client may not have noticed the session closed. It
    // learns here and shows the resume prompt.
    if (!session) return NextResponse.json({ ok: true, session: null })
    if (session.id !== body.sessionId) throw new HttpError(404, 'Proctoring session not found')

    const result = await recordHeartbeat(session.id, body)
    if (!result.live) return NextResponse.json({ ok: true, session: null })
    return NextResponse.json({ ok: true, session: { sessionId: session.id, status: result.status } })
  } catch (err) {
    return errorResponse(err, 'Proctoring heartbeat error', 'Could not record heartbeat.')
  }
}
