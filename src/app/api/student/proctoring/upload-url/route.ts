import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { uploadUrlSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, activeSessionFor } from '@/lib/proctoring/session'
import { issueUploadUrl } from '@/lib/proctoring/upload'
import { rateLimit } from '@/lib/proctoring/rate-limit'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()

    // Generous relative to legitimate use - one segment per 5 minutes plus one
    // screenshot per minute is well under 40/min even with retries.
    if (!rateLimit(`upload-url:${student.studentId}`, 40, 60_000)) {
      throw new HttpError(429, 'Too many upload requests. Please wait a moment.')
    }

    const body = await parseBody(req, uploadUrlSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    if (!session) throw new HttpError(409, 'No active proctoring session')

    // Question correlation is client-supplied, so validate membership in the
    // assigned set exactly as violation/route.ts does. Never trust it blind.
    const questionId =
      body.questionId && attempt.questionIds.includes(body.questionId) ? body.questionId : null

    const issued = await issueUploadUrl({
      sessionId: session.id,
      type: body.type,
      sequence: body.sequence,
      contentType: body.contentType,
      capturedAt: new Date(body.capturedAt),
      elapsedMs: body.elapsedMs,
      questionId,
      retentionExpiresAt: session.retentionExpiresAt,
    })

    // Deliberately no objectKey: the client has no use for it, and exposing the
    // key surface serves no purpose.
    return NextResponse.json({
      assetId: issued.assetId,
      uploadUrl: issued.uploadUrl,
      expiresAt: issued.expiresAt,
    })
  } catch (err) {
    return errorResponse(err, 'Proctoring upload-url error', 'Could not prepare the upload.')
  }
}
