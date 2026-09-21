import { prisma } from '@/lib/db'
import type { IncomingEvent } from './schemas'

/**
 * Proctoring event ingest.
 *
 * These rows are evidence for a human reviewer. They are never inputs to
 * scoring, and they never carry raw frames or face landmarks - only the
 * classification the browser arrived at, and when.
 */

/** Events that count towards the session's gaze warning tally. */
const GAZE_TYPES = new Set(['GAZE_LEFT', 'GAZE_RIGHT', 'GAZE_UP', 'GAZE_DOWN'])

export async function ingestEvents(
  sessionId: string,
  events: IncomingEvent[],
  assignedQuestionIds: string[]
): Promise<{ accepted: number; duplicates: number }> {
  const assigned = new Set(assignedQuestionIds)
  const now = new Date()

  const rows = events.map(e => ({
    proctoringSessionId: sessionId,
    clientEventId: e.clientEventId,
    type: e.type,
    direction: e.direction ?? null,
    // The client clock orders events within a batch; receivedAt is the
    // server's own and is authoritative when the two disagree.
    occurredAt: new Date(e.occurredAt),
    receivedAt: now,
    elapsedMs: e.elapsedMs ?? null,
    durationMs: e.durationMs ?? null,
    severity: e.severity,
    // Same rule as violation/route.ts: accept the question id, but only if it
    // is one this attempt was actually served. An unassigned id nulls the
    // column rather than rejecting the event - the observation is still
    // evidence even when we cannot say which question it happened on.
    questionId: e.questionId && assigned.has(e.questionId) ? e.questionId : null,
    metadata: e.metadata ?? undefined,
  }))

  // One statement, and skipDuplicates makes a retried batch a no-op. Without
  // this a lost response would double-count a candidate's warnings.
  const result = await prisma.proctoringEvent.createMany({ data: rows, skipDuplicates: true })

  const gazeAccepted = rows.filter(r => GAZE_TYPES.has(r.type)).length
  if (result.count > 0 && gazeAccepted > 0) {
    // Approximate when a batch was partially duplicate. The exact tally is
    // always recoverable by counting rows; this is a convenience for listings.
    await prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { gazeWarningCount: { increment: Math.min(gazeAccepted, result.count) } },
    })
  }

  return { accepted: result.count, duplicates: rows.length - result.count }
}
