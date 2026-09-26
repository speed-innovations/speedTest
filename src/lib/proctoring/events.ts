import { prisma } from '@/lib/db'
import type { IncomingEvent } from './schemas'
import { LOOKING_TYPES, severityFor } from './event-types'

/**
 * Proctoring event ingest. Metadata only: what the browser concluded, when,
 * for how long, and how confident. Never frames, never landmarks. Evidence for
 * a reviewer, never a scoring input.
 */

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
    startedAt: new Date(e.startedAt),
    endedAt: e.endedAt ? new Date(e.endedAt) : null,
    // The server's receipt time is authoritative over the client clock.
    receivedAt: now,
    elapsedMs: e.elapsedMs ?? null,
    durationMs: e.durationMs ?? null,
    confidence: e.confidence ?? null,
    // Derived, never client-supplied: a client must not be able to file its
    // own interruptions as INFO.
    severity: severityFor(e.type),
    // Same rule as violation/route.ts: kept only if this attempt was served it.
    questionId: e.questionId && assigned.has(e.questionId) ? e.questionId : null,
    metadata: e.metadata ?? undefined,
  }))

  // skipDuplicates makes a retried batch a no-op.
  const result = await prisma.proctoringEvent.createMany({ data: rows, skipDuplicates: true })

  const lookingAccepted = rows.filter(r => LOOKING_TYPES.indexOf(r.type) !== -1).length
  if (result.count > 0 && lookingAccepted > 0) {
    await prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { gazeWarningCount: { increment: Math.min(lookingAccepted, result.count) } },
    })
  }

  return { accepted: result.count, duplicates: rows.length - result.count }
}
