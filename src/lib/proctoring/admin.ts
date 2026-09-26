import { prisma } from '@/lib/db'
import type { AttemptKind } from './types'

/**
 * Read model for the admin review UI. Metadata only: a session summary and its
 * observation events. `select`, never `omit`, so a column added later is absent
 * until someone decides it belongs here.
 */

export interface AdminEventView {
  id: string
  type: string
  direction: string | null
  startedAt: Date
  endedAt: Date | null
  confidence: number | null
  elapsedMs: number | null
  durationMs: number | null
  severity: string
  questionId: string | null
  metadata: unknown
}

export interface AdminSessionView {
  id: string
  status: string
  version: string
  startedAt: Date | null
  endedAt: Date | null
  lastHeartbeatAt: Date | null
  retentionExpiresAt: Date
  screenShareStarted: boolean
  gazeWarningCount: number
  missedHeartbeatCount: number
  lastHealth: unknown
}

export interface AdminEvidence {
  /** Null when the attempt was never proctored. Not an error. */
  session: AdminSessionView | null
  events: AdminEventView[]
}

const EVENT_SELECT = {
  id: true, type: true, direction: true, startedAt: true, endedAt: true,
  confidence: true, elapsedMs: true, durationMs: true, severity: true,
  questionId: true, metadata: true,
} as const

const SESSION_SELECT = {
  id: true, status: true, version: true, startedAt: true, endedAt: true,
  lastHeartbeatAt: true, retentionExpiresAt: true, screenShareStarted: true,
  gazeWarningCount: true, missedHeartbeatCount: true, lastHealth: true,
} as const

export async function getAdminEvidence(attemptId: string, type: AttemptKind): Promise<AdminEvidence> {
  const where = type === 'scheduled' ? { testAttemptId: attemptId } : { walkInAttemptId: attemptId }
  const session = await prisma.proctoringSession.findFirst({ where, select: SESSION_SELECT })
  if (!session) return { session: null, events: [] }
  const events = await prisma.proctoringEvent.findMany({
    where: { proctoringSessionId: session.id },
    select: EVENT_SELECT,
    orderBy: { startedAt: 'asc' },
  })
  return { session, events }
}
