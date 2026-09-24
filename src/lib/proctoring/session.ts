import type { ProctoringSessionStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  HttpError,
  requireScheduledAttempt,
  requireWalkInAttempt,
  assignedQuestionIds,
} from '@/lib/attempt-auth'
import { getProctoringConfig } from './config'
import type { AttemptKind } from './types'

/**
 * Proctoring session lifecycle.
 *
 * resolveOwnedAttempt is the single place that knows there are two attempt
 * tables. Everything above it works with ResolvedAttempt, so a route never
 * branches on kind.
 */

export interface ResolvedAttempt {
  kind: AttemptKind
  attemptId: string
  studentId: string
  proctoringEnabled: boolean
  durationMinutes: number
  startedAt: Date | null
  expiresAt: Date | null
  isSubmitted: boolean
  questionIds: string[]
}

export interface SessionView {
  id: string
  status: string
  startedAt: Date | null
  retentionExpiresAt: Date
  version: string
}

/** A session in one of these states is still running. */
export const LIVE_STATUSES: ProctoringSessionStatus[] = ['PENDING', 'ACTIVE', 'DEGRADED']

const SESSION_VIEW_SELECT = {
  id: true, status: true, startedAt: true, retentionExpiresAt: true, version: true,
} as const

/**
 * Load an attempt of either kind, proving ownership. The require*Attempt
 * helpers return 404 (never 403) for a non-owner, so this endpoint cannot be
 * used to confirm that an attempt id exists.
 */
export async function resolveOwnedAttempt(
  attemptId: unknown,
  kind: AttemptKind,
  parentId: string,
  studentId: string
): Promise<ResolvedAttempt> {
  if (kind === 'scheduled') {
    const a = await requireScheduledAttempt(attemptId, parentId, studentId)
    return {
      kind,
      attemptId: a.id,
      studentId: a.studentId,
      proctoringEnabled: a.schedule.test.proctoringEnabled,
      durationMinutes: a.schedule.test.durationMinutes,
      startedAt: a.startedAt,
      expiresAt: a.expiresAt,
      isSubmitted: a.isSubmitted,
      questionIds: assignedQuestionIds(a.questionIds),
    }
  }
  const a = await requireWalkInAttempt(attemptId, parentId, studentId)
  return {
    kind,
    attemptId: a.id,
    studentId: a.studentId,
    proctoringEnabled: a.test.proctoringEnabled,
    durationMinutes: a.test.durationMinutes,
    startedAt: a.startedAt,
    expiresAt: a.expiresAt,
    isSubmitted: a.isSubmitted,
    questionIds: assignedQuestionIds(a.questionIds),
  }
}

export const linkFor = (a: ResolvedAttempt) =>
  a.kind === 'scheduled' ? { testAttemptId: a.attemptId } : { walkInAttemptId: a.attemptId }

export async function activeSessionFor(a: ResolvedAttempt): Promise<SessionView | null> {
  return prisma.proctoringSession.findFirst({
    where: { ...linkFor(a), status: { in: LIVE_STATUSES } },
    select: SESSION_VIEW_SELECT,
  })
}

/**
 * Whether proctored sessions may start at all. A deployment switch, not a
 * capacity check - nothing is stored that could run out.
 */
export function assertProctoringAvailable(cfg = getProctoringConfig()): void {
  if (!cfg.enabled) throw new HttpError(503, 'PROCTORING_DISABLED')
  if (!cfg.operational) throw new HttpError(503, 'PROCTORING_NOT_OPERATIONAL')
}

/**
 * Create or resume the session for an attempt. Idempotent: a refresh, a
 * double-clicked Start, or a recovery all land here and reuse one session.
 */
export async function startSession(a: ResolvedAttempt): Promise<SessionView> {
  const cfg = getProctoringConfig()

  if (!a.proctoringEnabled) throw new HttpError(400, 'This assessment is not proctored')
  if (a.isSubmitted) throw new HttpError(409, 'Test already submitted')

  const existing = await activeSessionFor(a)
  if (existing) return existing

  assertProctoringAvailable(cfg)

  const now = new Date()
  try {
    return await prisma.proctoringSession.create({
      data: {
        ...linkFor(a),
        status: 'ACTIVE',
        version: cfg.version,
        startedAt: now,
        lastHeartbeatAt: now,
        retentionExpiresAt: new Date(now.getTime() + cfg.retentionHours * 3_600_000),
      },
      select: SESSION_VIEW_SELECT,
    })
  } catch (err) {
    // Two tabs racing: the unique index on the attempt FK picks a winner.
    if ((err as { code?: string }).code !== 'P2002') throw err
    const winner = await activeSessionFor(a)
    if (winner) return winner
    throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
  }
}

/** Idempotent by construction - it only stamps the latest state. */
export async function recordHeartbeat(
  sessionId: string,
  patch: { screenSharing: boolean; degraded: boolean }
): Promise<void> {
  await prisma.proctoringSession.updateMany({
    // Guarded on status, so a late heartbeat cannot resurrect a closed session.
    where: { id: sessionId, status: { in: ['ACTIVE', 'DEGRADED'] } },
    data: {
      lastHeartbeatAt: new Date(),
      // A latch: "did screen sharing ever start?". `undefined` deliberately
      // leaves the column alone once it is true.
      screenShareStarted: patch.screenSharing || undefined,
      status: patch.degraded ? 'DEGRADED' : 'ACTIVE',
    },
  })
}

/** Close a session. Idempotent: the status guard makes a second call a no-op. */
export async function finalizeSession(
  sessionId: string,
  status: 'COMPLETED' | 'INTERRUPTED' = 'COMPLETED'
): Promise<void> {
  await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: { in: LIVE_STATUSES } },
    data: { status, endedAt: new Date() },
  })
}

/**
 * Close sessions whose browser vanished. Marked INTERRUPTED, not deleted, so
 * their events stay reviewable. Bounded - the pg pool is small.
 */
export async function sweepStaleSessions(now = new Date()): Promise<number> {
  const cfg = getProctoringConfig()
  const cutoff = new Date(now.getTime() - cfg.staleSessionMs)
  const stale = await prisma.proctoringSession.findMany({
    where: {
      status: { in: LIVE_STATUSES },
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
    take: 200,
  })
  let interrupted = 0
  for (const s of stale) {
    const updated = await prisma.proctoringSession.updateMany({
      where: { id: s.id, status: { in: LIVE_STATUSES } },
      data: { status: 'INTERRUPTED', endedAt: now },
    })
    interrupted += updated.count
  }
  return interrupted
}
