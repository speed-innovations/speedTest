import { prisma } from '@/lib/db'
import { getProctoringConfig } from './config'
import { currentUsageBytes, estimateAttemptBytes } from './quota'
import type { AttemptKind } from './types'

/**
 * Read models for the admin review UI.
 *
 * Kept out of the route handlers so the leak checks in
 * tests/proctoring-admin-api.test.ts can assert against the real serialized
 * shape rather than a hand-written fixture. A future `include` that pulled in
 * objectKey would be caught here.
 *
 * Two rules govern everything in this file:
 *
 * 1. **No object key ever leaves.** It is internal addressing, and handing it
 *    to a browser invites requests constructed around it.
 * 2. **No signed URL ever leaves.** URLs are issued one at a time by
 *    /api/admin/proctoring/assets/[id]/download-url, when an admin actually
 *    opens that asset. Bulk-signing a session would hand out dozens of live
 *    bearer tokens on page load, most of them never used.
 */

export interface AdminAssetView {
  id: string
  type: 'WEBCAM_SEGMENT' | 'SCREENSHOT'
  sequence: number
  contentType: string
  byteSize: number
  status: string
  capturedAt: Date
  uploadedAt: Date | null
  expiresAt: Date
  elapsedMs: number | null
  questionId: string | null
}

export interface AdminEventView {
  id: string
  type: string
  direction: string | null
  occurredAt: Date
  elapsedMs: number | null
  durationMs: number | null
  severity: string
  questionId: string | null
}

export interface AdminSessionView {
  id: string
  status: string
  version: string
  startedAt: Date | null
  endedAt: Date | null
  lastHeartbeatAt: Date | null
  retentionExpiresAt: Date
  recordingStarted: boolean
  screenShareStarted: boolean
  storageUsedBytes: number
  uploadFailureCount: number
  gazeWarningCount: number
}

export interface AdminEvidence {
  /** Null when the attempt was never proctored. Not an error. */
  session: AdminSessionView | null
  assets: AdminAssetView[]
  events: AdminEventView[]
}

/**
 * Field lists, written out rather than spread.
 *
 * `select` and not `omit`: a column added to the schema later is then absent by
 * default instead of silently joining the response. That is the difference
 * between a new field being a decision and being an accident.
 */
const ASSET_SELECT = {
  id: true,
  type: true,
  sequence: true,
  contentType: true,
  byteSize: true,
  status: true,
  capturedAt: true,
  uploadedAt: true,
  expiresAt: true,
  elapsedMs: true,
  questionId: true,
} as const

const EVENT_SELECT = {
  id: true,
  type: true,
  direction: true,
  occurredAt: true,
  elapsedMs: true,
  durationMs: true,
  severity: true,
  questionId: true,
} as const

const SESSION_SELECT = {
  id: true,
  status: true,
  version: true,
  startedAt: true,
  endedAt: true,
  lastHeartbeatAt: true,
  retentionExpiresAt: true,
  recordingStarted: true,
  screenShareStarted: true,
  storageUsedBytes: true,
  uploadFailureCount: true,
  gazeWarningCount: true,
} as const

/**
 * Evidence for one attempt of either kind.
 *
 * Addressed the same way /api/admin/results/detail already addresses attempts -
 * attemptId plus scheduled|walkin - rather than inventing a second scheme for
 * admins to get wrong.
 */
export async function getAdminEvidence(
  attemptId: string,
  type: AttemptKind
): Promise<AdminEvidence> {
  const where =
    type === 'scheduled' ? { testAttemptId: attemptId } : { walkInAttemptId: attemptId }

  const session = await prisma.proctoringSession.findFirst({
    where,
    select: SESSION_SELECT,
  })

  // A never-proctored attempt is an ordinary outcome: most attempts are not
  // proctored. The panel renders "not proctored" and the reviewer moves on.
  if (!session) return { session: null, assets: [], events: [] }

  const [assets, events] = await Promise.all([
    prisma.proctoringAsset.findMany({
      where: { proctoringSessionId: session.id },
      select: ASSET_SELECT,
      // Type first so segments and screenshots arrive as two runs, each in
      // capture order - the player walks one and the gallery the other.
      orderBy: [{ type: 'asc' }, { sequence: 'asc' }],
    }),
    prisma.proctoringEvent.findMany({
      where: { proctoringSessionId: session.id },
      select: EVENT_SELECT,
      orderBy: { occurredAt: 'asc' },
    }),
  ])

  return { session, assets, events }
}

export interface UsageReport {
  reservedBytes: number
  storedBytes: number
  totalBytes: number
  safetyBytes: number
  remainingBytes: number
  activeSessions: number
  /** Past retention but not yet physically deleted. The cleanup job's backlog. */
  assetsAwaitingCleanup: number
  expiredAssets: number
  uploadFailures: number
  avgSegmentBytes: number
  avgScreenshotBytes: number
  /** Bytes one 60-minute attempt reserves, for reference on the page. */
  bytesPerAttempt: number
  estimatedAttemptsRemaining: number
  retentionHours: number
  storageProvider: string
}

/**
 * Operational capacity, from our own ledger.
 *
 * Deliberately does not call R2. A LIST per page load would burn the Class A
 * operation budget for no benefit - the database already knows what was
 * uploaded and what expired.
 */
export async function getUsageReport(now = new Date()): Promise<UsageReport> {
  const cfg = getProctoringConfig()

  const [usage, awaitingCleanup, expiredAssets, uploadFailures, segAvg, shotAvg] =
    await Promise.all([
      currentUsageBytes(),
      // Still holding bytes in the bucket after their retention instant. If the
      // scheduled job stalls, this is the number that grows.
      prisma.proctoringAsset.count({
        where: { expiresAt: { lte: now }, status: { in: ['UPLOADED', 'EXPIRED'] } },
      }),
      prisma.proctoringAsset.count({ where: { status: 'EXPIRED' } }),
      prisma.proctoringAsset.count({ where: { status: 'FAILED' } }),
      prisma.proctoringAsset.aggregate({
        where: { status: 'UPLOADED', type: 'WEBCAM_SEGMENT' },
        _avg: { byteSize: true },
      }),
      prisma.proctoringAsset.aggregate({
        where: { status: 'UPLOADED', type: 'SCREENSHOT' },
        _avg: { byteSize: true },
      }),
    ])

  // Never negative: over-budget is a real state - a reservation can be made and
  // then exceeded - and a negative "remaining" reads as a bug rather than as
  // "full", which is what it means.
  const remainingBytes = Math.max(0, cfg.storageSafetyBytes - usage.totalBytes)

  // Sized on 60 minutes, which is the drive-planning unit. This is a rolling
  // figure, not a concurrency one: media is held for the full retention period,
  // so completed attempts keep consuming it rather than freeing up at
  // submission. Staggering a cohort into waves does not raise it.
  const bytesPerAttempt = estimateAttemptBytes(60, cfg)

  return {
    reservedBytes: usage.reservedBytes,
    storedBytes: usage.storedBytes,
    totalBytes: usage.totalBytes,
    safetyBytes: cfg.storageSafetyBytes,
    remainingBytes,
    activeSessions: usage.activeSessions,
    assetsAwaitingCleanup: awaitingCleanup,
    expiredAssets,
    uploadFailures,
    avgSegmentBytes: Math.round(Number(segAvg._avg.byteSize ?? 0)),
    avgScreenshotBytes: Math.round(Number(shotAvg._avg.byteSize ?? 0)),
    bytesPerAttempt,
    estimatedAttemptsRemaining: Math.floor(remainingBytes / bytesPerAttempt),
    retentionHours: cfg.retentionHours,
    storageProvider: cfg.storageProvider,
  }
}
