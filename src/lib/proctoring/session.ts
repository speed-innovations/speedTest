import { prisma } from '@/lib/db'
import {
  HttpError,
  requireScheduledAttempt,
  requireWalkInAttempt,
  assignedQuestionIds,
} from '@/lib/attempt-auth'
import { getProctoringConfig } from './config'
import {
  canStartProctoredAssessment,
  estimateAttemptBytes,
  effectiveDurationMinutes,
  releaseReservation,
} from './quota'
import type { AttemptKind } from './types'

/**
 * Proctoring session lifecycle.
 *
 * resolveOwnedAttempt is the single place that knows there are two attempt
 * tables. Everything above it works with ResolvedAttempt, so a route never has
 * to branch on kind - which is what stops the walk-in flow quietly losing
 * features the scheduled flow gets.
 */

export interface ResolvedAttempt {
  kind: AttemptKind
  attemptId: string
  studentId: string
  proctoringEnabled: boolean
  durationMinutes: number
  startedAt: Date | null
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

/**
 * Load an attempt of either kind, proving ownership.
 *
 * Reuses the existing require*Attempt helpers rather than re-querying: they
 * already return 404 (never 403) for a non-owner, so an attacker cannot use this
 * endpoint to confirm that an attempt id exists.
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
    isSubmitted: a.isSubmitted,
    questionIds: assignedQuestionIds(a.questionIds),
  }
}

const linkFor = (a: ResolvedAttempt) =>
  a.kind === 'scheduled' ? { testAttemptId: a.attemptId } : { walkInAttemptId: a.attemptId }

export async function activeSessionFor(a: ResolvedAttempt): Promise<SessionView | null> {
  return prisma.proctoringSession.findFirst({
    where: { ...linkFor(a), status: { in: ['PENDING', 'ACTIVE', 'DEGRADED'] } },
    select: { id: true, status: true, startedAt: true, retentionExpiresAt: true, version: true },
  })
}

/**
 * Create or resume the session for an attempt.
 *
 * Idempotent: a refresh, a double-clicked Start, or a recovery after a crash all
 * land here and must reuse the same session. Creating a second one would split
 * the evidence across two records and reserve the budget twice.
 */
export async function startSession(a: ResolvedAttempt): Promise<SessionView> {
  const cfg = getProctoringConfig()

  if (!a.proctoringEnabled) throw new HttpError(400, 'This assessment is not proctored')
  if (a.isSubmitted) throw new HttpError(409, 'Test already submitted')

  const existing = await activeSessionFor(a)
  if (existing) return existing

  // The quota gate runs before anything is created, and crucially before the
  // test clock starts - a candidate refused here has lost no time.
  const eligibility = await canStartProctoredAssessment(a.durationMinutes)
  if (!eligibility.allowed) {
    // 503, not 403: this is an operational limit, not an authorization failure.
    throw new HttpError(503, eligibility.reason)
  }

  const minutes = effectiveDurationMinutes(a.durationMinutes, cfg)
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
        storageReservedBytes: estimateAttemptBytes(minutes, cfg),
      },
      select: { id: true, status: true, startedAt: true, retentionExpiresAt: true, version: true },
    })
  } catch (err) {
    // Two tabs racing. The unique index on the attempt FK settles it; the loser
    // reads the winner rather than failing the candidate.
    if ((err as { code?: string }).code !== 'P2002') throw err
    const winner = await activeSessionFor(a)
    if (winner) return winner
    // No live session, yet the FK is taken: this attempt's session was already
    // closed. The unique index is per attempt, not per attempt-and-status, so a
    // finished attempt can never be re-proctored. Say so as a 409 rather than
    // letting a raw Prisma error surface as a generic 500.
    throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
  }
}

export interface HeartbeatPatch {
  recording: boolean
  screenSharing: boolean
  degraded: boolean
}

/** Idempotent by construction - it only stamps the latest state. */
export async function recordHeartbeat(sessionId: string, patch: HeartbeatPatch): Promise<void> {
  await prisma.proctoringSession.updateMany({
    // Guarded on status, so a heartbeat arriving after finalize cannot
    // resurrect a COMPLETED or INTERRUPTED session.
    where: { id: sessionId, status: { in: ['ACTIVE', 'DEGRADED'] } },
    data: {
      lastHeartbeatAt: new Date(),
      // These two are latches, not state: once recording has been observed it
      // stays recorded, because the question they answer is "did this ever
      // start?". `undefined` is the deliberate "leave this column alone" - the
      // one place in proctoring where that Prisma behaviour is wanted.
      recordingStarted: patch.recording || undefined,
      screenShareStarted: patch.screenSharing || undefined,
      status: patch.degraded ? 'DEGRADED' : 'ACTIVE',
    },
  })
}

/**
 * Close a session and give back the unused reservation.
 *
 * Idempotent: the guard on status means a second finalize is a no-op rather than
 * a second release. The client calls this on submit; the stale sweep and the
 * submit-route safety net call it for clients that died.
 */
export async function finalizeSession(
  sessionId: string,
  status: 'COMPLETED' | 'INTERRUPTED' = 'COMPLETED'
): Promise<void> {
  const updated = await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: { in: ['PENDING', 'ACTIVE', 'DEGRADED'] } },
    data: { status, endedAt: new Date() },
  })
  if (updated.count === 1) await releaseReservation(sessionId)
}
