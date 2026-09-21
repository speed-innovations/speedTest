import { NextRequest, NextResponse } from 'next/server'
import { requireStudent, errorResponse, HttpError } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { sessionStartSchema } from '@/lib/proctoring/schemas'
import { resolveOwnedAttempt, startSession, activeSessionFor } from '@/lib/proctoring/session'
import { getProctoringConfig } from '@/lib/proctoring/config'
import type { AttemptKind } from '@/lib/proctoring/types'

export async function POST(req: NextRequest) {
  try {
    const student = await requireStudent()
    const body = await parseBody(req, sessionStartSchema)
    const attempt = await resolveOwnedAttempt(body.attemptId, body.kind, body.parentId, student.studentId)
    const session = await startSession(attempt)
    const cfg = getProctoringConfig()

    return NextResponse.json({
      sessionId: session.id,
      status: session.status,
      version: session.version,
      retentionExpiresAt: session.retentionExpiresAt,
      // Client capture parameters come from the server so a deploy can retune
      // them without shipping new client code.
      config: {
        screenshotIntervalMs: cfg.screenshotIntervalMs,
        videoSegmentMs: cfg.videoSegmentMs,
        videoBitsPerSecond: cfg.videoBitsPerSecond,
        audioBitsPerSecond: cfg.audioBitsPerSecond,
        gazeWarningMs: cfg.gazeWarningMs,
        gazeWarningCooldownMs: cfg.gazeWarningCooldownMs,
        faceMissingWarningMs: cfg.faceMissingWarningMs,
        multipleFacesWarningMs: cfg.multipleFacesWarningMs,
        maxScreenshotBytes: cfg.maxScreenshotBytes,
        heartbeatIntervalMs: cfg.heartbeatIntervalMs,
        screenRequired: cfg.screenRequired,
      },
    })
  } catch (err) {
    return errorResponse(err, 'Proctoring session start error', 'Could not start proctoring. Please try again.')
  }
}

/** Recovery: does this attempt already have a live session? */
export async function GET(req: NextRequest) {
  try {
    const student = await requireStudent()
    const { searchParams } = new URL(req.url)
    const attemptId = searchParams.get('attemptId')
    const kind = searchParams.get('kind') as AttemptKind | null
    const parentId = searchParams.get('parentId')
    if (!attemptId || !parentId || (kind !== 'scheduled' && kind !== 'walkin')) {
      throw new HttpError(400, 'attemptId, kind and parentId are required')
    }
    const attempt = await resolveOwnedAttempt(attemptId, kind, parentId, student.studentId)
    const session = await activeSessionFor(attempt)
    return NextResponse.json({
      proctoringEnabled: attempt.proctoringEnabled,
      session: session ? { sessionId: session.id, status: session.status, startedAt: session.startedAt } : null,
    })
  } catch (err) {
    return errorResponse(err, 'Proctoring session read error', 'Could not read proctoring state.')
  }
}
