import { prisma } from '@/lib/db'
import type { IncomingEvent } from './schemas'
import { LOOKING_TYPES, severityFor } from './event-types'
import type { ServerEventType } from './event-types'

/**
 * Proctoring event ingest. Metadata only: what the browser concluded, when,
 * for how long, and how confident. Never frames, never landmarks. Evidence for
 * a reviewer, never a scoring input.
 */

/**
 * Hard ceiling on stored events per session. A normal hour produces tens of
 * rows. This bounds what a hostile client cycling fresh clientEventIds can
 * write, on top of the per-student rate limit.
 */
export const MAX_EVENTS_PER_SESSION = 2000

export async function ingestEvents(
  sessionId: string,
  events: IncomingEvent[],
  assignedQuestionIds: string[]
): Promise<{ accepted: number; duplicates: number; capped: boolean }> {
  const assigned = new Set(assignedQuestionIds)
  const now = new Date()

  const stored = await prisma.proctoringEvent.count({ where: { proctoringSessionId: sessionId } })
  const room = Math.max(0, MAX_EVENTS_PER_SESSION - stored)
  if (room === 0) return { accepted: 0, duplicates: 0, capped: true }
  const admitted = events.slice(0, room)

  const rows = admitted.map(e => ({
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

  return { accepted: result.count, duplicates: rows.length - result.count, capped: admitted.length < events.length }
}

/**
 * An event the server itself observed. The deterministic `srv-` id makes a
 * repeat observation of the same fact a no-op, and clients may not use that
 * prefix (schemas.ts). Returns true when a row was actually inserted.
 */
export async function recordServerEvent(
  sessionId: string,
  e: {
    clientEventId: string
    type: ServerEventType
    startedAt: Date
    endedAt?: Date
    durationMs?: number
    metadata?: Record<string, string | number | boolean>
  }
): Promise<boolean> {
  const result = await prisma.proctoringEvent.createMany({
    data: [{
      proctoringSessionId: sessionId,
      clientEventId: e.clientEventId,
      type: e.type,
      startedAt: e.startedAt,
      endedAt: e.endedAt ?? null,
      durationMs: e.durationMs ?? null,
      severity: severityFor(e.type),
      metadata: e.metadata ?? undefined,
    }],
    skipDuplicates: true,
  })
  return result.count === 1
}
