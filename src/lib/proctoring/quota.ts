import type { ProctoringSessionStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getProctoringConfig, getR2Config } from './config'
import type { StartEligibility } from './types'

/**
 * Storage budget enforcement.
 *
 * The budget is measured against reservations *plus* already-stored bytes,
 * because media is held for the full retention period - it does not free up when
 * an attempt is submitted. Summing only reservations would admit attempts whose
 * storage is already spoken for by the last three days of completed ones.
 */

/** Statuses that still hold an outstanding reservation. */
const RESERVING: ProctoringSessionStatus[] = ['PENDING', 'ACTIVE', 'DEGRADED']

/** Clamp the test's duration to the configured hard maximum. */
export function effectiveDurationMinutes(testDurationMinutes: number, cfg = getProctoringConfig()): number {
  if (!Number.isFinite(testDurationMinutes) || testDurationMinutes < 1) return 1
  return Math.min(Math.floor(testDurationMinutes), cfg.maxDurationMinutes)
}

/**
 * Worst-case bytes for one attempt, with headroom.
 *
 * Deliberately pessimistic: MediaRecorder treats bitrate as a hint, and a busy
 * scene can overshoot. Under-reserving is the expensive mistake - it is
 * discovered when the bucket is already over budget.
 */
export function estimateAttemptBytes(durationMinutes: number, cfg = getProctoringConfig()): number {
  const minutes = Math.max(1, Math.floor(Number.isFinite(durationMinutes) ? durationMinutes : 1))
  const seconds = minutes * 60

  const mediaBytes = (seconds * (cfg.videoBitsPerSecond + cfg.audioBitsPerSecond)) / 8

  // One immediately after start, then one per interval.
  const shots = 1 + Math.ceil((seconds * 1000) / cfg.screenshotIntervalMs)
  const shotBytes = shots * cfg.estimatedScreenshotBytes

  return Math.round((mediaBytes + shotBytes) * cfg.safetyMultiplier)
}

export interface UsageLedger {
  reservedBytes: number
  storedBytes: number
  totalBytes: number
  activeSessions: number
}

/**
 * Current consumption.
 *
 * Read from our own tables, never by listing the bucket: a LIST per request
 * would burn the Class A operation budget and be slower besides.
 *
 * The sums come back as plain JS numbers even past 2^31 - verified against a
 * real database in tests/proctoring-quota-db.test.ts rather than assumed, since
 * Postgres returns bigint from SUM(int). The Number() calls below are for the
 * null case, not a bigint conversion.
 */
export async function currentUsageBytes(): Promise<UsageLedger> {
  const now = new Date()

  const [reservedAgg, storedAgg, activeSessions] = await Promise.all([
    prisma.proctoringSession.aggregate({
      where: { status: { in: RESERVING } },
      _sum: { storageReservedBytes: true },
    }),
    // Uploaded and not yet expired. EXPIRED/DELETED assets no longer count even
    // if R2 has not physically removed them - the lifecycle rule will.
    prisma.proctoringAsset.aggregate({
      where: { status: 'UPLOADED', expiresAt: { gt: now } },
      _sum: { byteSize: true },
    }),
    prisma.proctoringSession.count({ where: { status: { in: RESERVING } } }),
  ])

  const reservedBytes = Number(reservedAgg._sum.storageReservedBytes ?? 0)
  const storedBytes = Number(storedAgg._sum.byteSize ?? 0)

  return {
    reservedBytes,
    storedBytes,
    totalBytes: reservedBytes + storedBytes,
    activeSessions,
  }
}

/**
 * The gate. Structured, never a bare boolean - the caller has to tell a
 * candidate *why*, and the admin page shows the remaining budget.
 */
export async function canStartProctoredAssessment(testDurationMinutes: number): Promise<StartEligibility> {
  const cfg = getProctoringConfig()
  const minutes = effectiveDurationMinutes(testDurationMinutes, cfg)
  const estimatedBytes = estimateAttemptBytes(minutes, cfg)

  const deny = (reason: StartEligibility['reason'], remainingBudget = 0): StartEligibility =>
    ({ allowed: false, reason, estimatedBytes, remainingBudget })

  if (!cfg.enabled) return deny('PROCTORING_DISABLED')
  if (!cfg.operational) return deny('PROCTORING_NOT_OPERATIONAL')

  if (cfg.storageProvider === 'r2') {
    // Fail here rather than at the first upload, when the candidate is already
    // recording and the evidence has nowhere to go.
    try {
      getR2Config()
    } catch {
      return deny('PROCTORING_STORAGE_NOT_CONFIGURED')
    }
  }

  const usage = await currentUsageBytes()
  const remainingBudget = Math.max(0, cfg.storageSafetyBytes - usage.totalBytes)

  if (usage.totalBytes + estimatedBytes > cfg.storageSafetyBytes) {
    return deny('PROCTORING_STORAGE_LIMIT_REACHED', remainingBudget)
  }

  return { allowed: true, reason: 'OK', estimatedBytes, remainingBudget }
}

/**
 * Settle a finished session: keep the bytes actually uploaded, drop the rest of
 * the reservation. The stored bytes keep counting against the budget until they
 * expire - only the unused headroom is given back.
 */
export async function releaseReservation(sessionId: string): Promise<void> {
  const assets = await prisma.proctoringAsset.aggregate({
    where: { proctoringSessionId: sessionId, status: 'UPLOADED' },
    _sum: { byteSize: true },
  })
  const used = Number(assets._sum.byteSize ?? 0)
  await prisma.proctoringSession.update({
    where: { id: sessionId },
    data: { storageReservedBytes: 0, storageUsedBytes: used },
  })
}

/**
 * Reclaim reservations from sessions whose browser vanished.
 *
 * An abandoned tab would otherwise hold ~111 MB of a 7 GB budget forever. The
 * session is marked INTERRUPTED rather than deleted: the evidence it did upload
 * stays reviewable until it expires.
 *
 * Bounded and safe to run repeatedly - the pg pool here is small, so this must
 * never fan out.
 */
export async function sweepStaleReservations(now = new Date()): Promise<number> {
  const cfg = getProctoringConfig()
  const cutoff = new Date(now.getTime() - cfg.staleSessionMs)

  const stale = await prisma.proctoringSession.findMany({
    where: {
      status: { in: RESERVING },
      OR: [
        { lastHeartbeatAt: { lt: cutoff } },
        { lastHeartbeatAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
    take: 200,
  })

  for (const s of stale) {
    await releaseReservation(s.id)
    await prisma.proctoringSession.update({
      where: { id: s.id },
      data: { status: 'INTERRUPTED', endedAt: now },
    })
  }
  return stale.length
}
