import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { heartbeatSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor, recordHeartbeat } from '@/lib/proctoring/session'

/**
 * Liveness only. No media passes through here - it exists so the backend can
 * tell a finished session from an abandoned one.
 */
export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    const body = await parseBody(req, heartbeatSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    // A heartbeat for a finalized session is not an error - the client may not
    // have noticed yet. Tell it, and let it stop.
    if (!session) return NextResponse.json({ ok: true, session: null })

    const degraded = (body.pendingUploads ?? 0) > 5 || !body.recording
    await recordHeartbeat(session.id, {
      recording: body.recording,
      screenSharing: body.screenSharing,
      degraded,
    })
    return NextResponse.json({ ok: true, session: { sessionId: session.id, degraded } })
  } catch (err) {
    return errorResponse(err, 'Proctoring heartbeat error', 'Could not record heartbeat.')
  }
}
