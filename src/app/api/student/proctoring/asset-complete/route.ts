import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { assetCompleteSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor } from '@/lib/proctoring/session'
import { completeAsset } from '@/lib/proctoring/upload'
import { rateLimit } from '@/lib/proctoring/rate-limit'

/**
 * Confirm an upload landed. The body carries no size - the store is asked, and
 * its answer is what gets recorded.
 */
export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()

    if (!rateLimit(`asset-complete:${student.studentId}`, 40, 60_000)) {
      throw new HttpError(429, 'Too many upload requests. Please wait a moment.')
    }

    const body = await parseBody(req, assetCompleteSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    if (!session) throw new HttpError(409, 'No active proctoring session')

    // Scoped to this session, so one student cannot complete another's asset
    // even with a guessed id.
    const result = await completeAsset(body.assetId, session.id)

    return NextResponse.json({ ok: true, byteSize: result.byteSize, status: result.status })
  } catch (err) {
    return errorResponse(err, 'Proctoring asset-complete error', 'Could not confirm the upload.')
  }
}
