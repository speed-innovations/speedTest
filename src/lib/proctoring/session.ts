import type { ProctoringSessionStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  HttpError,
  requireScheduledAttempt,
  requireWalkInAttempt,
  assignedQuestionIds,
  isPastDeadline,
} from '@/lib/attempt-auth'
import { getProctoringConfig } from './config'
import { recordServerEvent } from './events'
import type { HeartbeatInput } from './schemas'
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

export interface StartResult {
  session: SessionView
  /** True when an INTERRUPTED session was reopened rather than created. */
  resumed: boolean
}

/**
 * Create or resume the session for an attempt. Idempotent.
 *
 * One session per attempt, ever: the FK is unique. An INTERRUPTED session -
 * closed by the sweep after its heartbeat went stale - is reopened while the
 * attempt is still running, because a dropped network is not a finished
 * attempt. The gap it left stays on record as HEARTBEAT_MISSED. COMPLETED and
 * EXPIRED sessions, and attempts past their deadline, stay closed.
 */
export async function startSession(a: ResolvedAttempt): Promise<StartResult> {
  const cfg = getProctoringConfig()

  if (!a.proctoringEnabled) throw new HttpError(400, 'This assessment is not proctored')
  if (a.isSubmitted) throw new HttpError(409, 'Test already submitted')

  const existing = await activeSessionFor(a)
  if (existing) return { session: existing, resumed: false }

  assertProctoringAvailable(cfg)

  const previous = await prisma.proctoringSession.findFirst({
    where: linkFor(a),
    select: { id: true, status: true },
  })
  if (previous) {
    if (previous.status !== 'INTERRUPTED' || isPastDeadline(a.expiresAt)) {
      throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
    }
    return { session: await resumeInterrupted(previous.id), resumed: true }
  }

  const now = new Date()
  try {
    const session = await prisma.proctoringSession.create({
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
    return { session, resumed: false }
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') throw err
    const winner = await activeSessionFor(a)
    if (winner) return { session: winner, resumed: false }
    throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
  }
}

async function resumeInterrupted(sessionId: string): Promise<SessionView> {
  const now = new Date()
  const updated = await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: 'INTERRUPTED' },
    data: { status: 'ACTIVE', endedAt: null, lastHeartbeatAt: now },
  })
  if (updated.count === 1) {
    await recordServerEvent(sessionId, {
      clientEventId: `srv-resumed-${sessionId}-${now.getTime()}`,
      type: 'PROCTORING_RESUMED',
      startedAt: now,
    })
  }
  // This call or a racing one reopened it; either way, read what is live now.
  const live = await prisma.proctoringSession.findFirst({
    where: { id: sessionId, status: { in: LIVE_STATUSES } },
    select: SESSION_VIEW_SELECT,
  })
  if (!live) throw new HttpError(409, 'PROCTORING_SESSION_CLOSED')
  return live
}

/** A gap longer than this many heartbeat intervals is recorded as missed. */
export const HEARTBEAT_MISSED_FACTOR = 2.5
const MAX_GAP_MS = 14_400_000

/**
 * Record a heartbeat gap as a server-side HEARTBEAT_MISSED event.
 *
 * The id derives from the session and the last heartbeat seen, so the
 * heartbeat route, the sweep and finalize can all notice the same gap and it
 * is still stored once. Written by the server, so a client that simply stops
 * sending cannot prevent it.
 */
export async function recordGapIfMissed(
  sessionId: string,
  since: Date | null,
  now: Date,
  thresholdMs: number,
  source: 'heartbeat' | 'sweep' | 'finalize'
): Promise<boolean> {
  if (!since) return false
  const gap = now.getTime() - since.getTime()
  if (gap <= thresholdMs) return false
  const inserted = await recordServerEvent(sessionId, {
    clientEventId: `srv-hb-${sessionId}-${since.getTime()}`,
    type: 'HEARTBEAT_MISSED',
    startedAt: since,
    endedAt: now,
    durationMs: Math.min(gap, MAX_GAP_MS),
    metadata: { source },
  })
  if (inserted) {
    await prisma.proctoringSession.update({
      where: { id: sessionId },
      data: { missedHeartbeatCount: { increment: 1 } },
    })
  }
  return inserted
}

export type HeartbeatHealth = Pick<
  HeartbeatInput,
  'camera' | 'microphone' | 'screen' | 'gazeMonitor' | 'clientState' | 'clientTimestamp' | 'droppedEvents'
>

export interface HeartbeatResult {
  live: boolean
  status: string | null
  degraded: boolean
  missed: boolean
}

/**
 * Stamp liveness and health. The server decides: any required device not
 * ACTIVE, or no gaze analysis at all, is DEGRADED - whatever the client's own
 * state name says.
 */
export async function recordHeartbeat(
  sessionId: string,
  report: HeartbeatHealth,
  now = new Date()
): Promise<HeartbeatResult> {
  const cfg = getProctoringConfig()
  const session = await prisma.proctoringSession.findUnique({
    where: { id: sessionId },
    select: { status: true, lastHeartbeatAt: true },
  })
  if (!session || (session.status !== 'ACTIVE' && session.status !== 'DEGRADED')) {
    return { live: false, status: session ? session.status : null, degraded: false, missed: false }
  }

  const missed = await recordGapIfMissed(
    sessionId, session.lastHeartbeatAt, now, cfg.heartbeatIntervalMs * HEARTBEAT_MISSED_FACTOR, 'heartbeat'
  )

  const degraded =
    report.camera !== 'ACTIVE' ||
    report.microphone !== 'ACTIVE' ||
    (cfg.screenRequired && report.screen !== 'ACTIVE') ||
    report.gazeMonitor === 'UNAVAILABLE'
  const status = degraded ? 'DEGRADED' : 'ACTIVE'
  const clientMs = Date.parse(report.clientTimestamp)

  await prisma.proctoringSession.updateMany({
    // Guarded on status, so a late heartbeat cannot resurrect a closed session.
    where: { id: sessionId, status: { in: ['ACTIVE', 'DEGRADED'] } },
    data: {
      lastHeartbeatAt: now,
      // Latch: "did screen sharing ever start?". `undefined` leaves it alone.
      screenShareStarted: report.screen === 'ACTIVE' || undefined,
      status,
      lastHealth: {
        camera: report.camera,
        microphone: report.microphone,
        screen: report.screen,
        gazeMonitor: report.gazeMonitor,
        clientState: report.clientState,
        droppedEvents: report.droppedEvents ?? 0,
        // Recorded, never trusted: a candidate's clock can be wrong on purpose.
        clockSkewMs: Number.isFinite(clientMs) ? now.getTime() - clientMs : null,
        receivedAt: now.toISOString(),
      },
    },
  })
  return { live: true, status, degraded, missed }
}

/**
 * Close a session. Idempotent. A trailing heartbeat gap is recorded first:
 * stopping the proctoring script and then submitting is the cheapest bypass,
 * and it must leave a mark even when the cron sweep never ran.
 */
export async function finalizeSession(
  sessionId: string,
  status: 'COMPLETED' | 'INTERRUPTED' = 'COMPLETED',
  now = new Date()
): Promise<void> {
  const cfg = getProctoringConfig()
  const s = await prisma.proctoringSession.findUnique({
    where: { id: sessionId },
    select: { status: true, lastHeartbeatAt: true },
  })
  if (!s || LIVE_STATUSES.indexOf(s.status) === -1) return
  await recordGapIfMissed(sessionId, s.lastHeartbeatAt, now, cfg.heartbeatIntervalMs * HEARTBEAT_MISSED_FACTOR, 'finalize')
  await prisma.proctoringSession.updateMany({
    where: { id: sessionId, status: { in: LIVE_STATUSES } },
    data: { status, endedAt: now },
  })
}

/** Close sessions whose browser vanished, recording the gap. Bounded. */
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
    select: { id: true, lastHeartbeatAt: true, createdAt: true },
    take: 200,
  })
  let interrupted = 0
  for (const s of stale) {
    const updated = await prisma.proctoringSession.updateMany({
      where: { id: s.id, status: { in: LIVE_STATUSES } },
      data: { status: 'INTERRUPTED', endedAt: now },
    })
    if (updated.count !== 1) continue
    interrupted++
    await recordGapIfMissed(s.id, s.lastHeartbeatAt ?? s.createdAt, now, cfg.staleSessionMs, 'sweep')
  }
  return interrupted
}
