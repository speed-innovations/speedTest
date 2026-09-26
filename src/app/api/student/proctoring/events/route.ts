import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { eventBatchSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor } from '@/lib/proctoring/session'
import { ingestEvents } from '@/lib/proctoring/events'
import { rateLimit } from '@/lib/proctoring/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()

    // Normal operation flushes every 5-10 seconds: ~12/min. 30 allows for
    // retries and a burst without letting a client stream single events.
    if (!rateLimit(`events:${student.studentId}`, 30, 60_000)) {
      throw new HttpError(429, 'Too many event batches. Please wait a moment.')
    }

    const body = await parseBody(req, eventBatchSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    // A finalized session is not an error - the client may still be flushing.
    // Accept the call, store nothing, and let it stop.
    if (!session) return NextResponse.json({ accepted: 0, duplicates: 0, capped: false, session: null })
    // The session the client names must be its own live session. Events for
    // anyone else's session are refused as not found, never stored.
    if (session.id !== body.sessionId) throw new HttpError(404, 'Proctoring session not found')

    const result = await ingestEvents(session.id, body.events, attempt.questionIds)
    return NextResponse.json({ ...result, session: session.id })
  } catch (err) {
    return errorResponse(err, 'Proctoring events error', 'Could not record proctoring events.')
  }
}
