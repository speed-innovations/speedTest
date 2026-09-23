import type { ProctoringAssetStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getStorage } from './storage'
import { sweepStaleReservations } from './quota'

/**
 * Retention enforcement.
 *
 * Two mechanisms cover this deliberately: the application refuses access at
 * expiresAt, and R2's lifecycle rule removes the bytes somewhat later. This job
 * closes the gap between them and keeps the storage ledger honest.
 *
 * Neither mechanism is sufficient alone. Lifecycle alone would leave media
 * reachable past the promised window whenever Cloudflare ran late; application
 * expiry alone would leave bytes on the budget forever if this job stopped. The
 * honest claim is "access stops at 72 hours, the bytes are removed shortly
 * after" - not "deleted at exactly 72 hours".
 *
 * Bounded and idempotent: a run that is late, interrupted, or repeated must
 * converge on the same state. GitHub's scheduler is routinely 10-30 minutes
 * late and disables schedules after 60 days of repository inactivity, so a
 * multi-day gap is an expected input, not an incident. The pg pool is max: 3,
 * so deletes are sequential and never fanned out.
 */

const DEFAULT_BATCH = 200

/** Statuses that may still have an object sitting in the bucket. */
const DELETABLE: ProctoringAssetStatus[] = ['UPLOADED', 'PENDING', 'FAILED', 'EXPIRED']

export interface CleanupReport {
  assetsExpired: number
  objectsDeleted: number
  deleteFailures: number
  sessionsExpired: number
  staleReservationsReleased: number
  /** True when the batch filled - the caller should run again soon. */
  batchExhausted: boolean
}

export async function runRetentionCleanup(
  opts: { now?: Date; batchSize?: number } = {}
): Promise<CleanupReport> {
  const now = opts.now ?? new Date()
  const batchSize = opts.batchSize ?? DEFAULT_BATCH
  const storage = getStorage()

  const report: CleanupReport = {
    assetsExpired: 0,
    objectsDeleted: 0,
    deleteFailures: 0,
    sessionsExpired: 0,
    staleReservationsReleased: 0,
    batchExhausted: false,
  }

  // Oldest first: a backlog should drain in the order that frees budget soonest.
  const due = await prisma.proctoringAsset.findMany({
    where: { expiresAt: { lte: now }, status: { in: DELETABLE } },
    orderBy: { expiresAt: 'asc' },
    take: batchSize,
    select: { id: true, objectKey: true, status: true },
  })
  report.batchExhausted = due.length === batchSize

  for (let i = 0; i < due.length; i++) {
    const asset = due[i]
    try {
      // Idempotent at the storage layer: deleting an absent object is not an
      // error, so a re-run after a partial failure is safe.
      await storage.deleteObject(asset.objectKey)
      await prisma.proctoringAsset.update({
        where: { id: asset.id },
        // byteSize to 0 as well: the row stays as a record that evidence
        // existed, but it must stop claiming bytes that are no longer stored.
        data: { status: 'DELETED', byteSize: 0 },
      })
      report.objectsDeleted++
    } catch {
      // Mark EXPIRED but not DELETED, so the next run retries the object.
      // Access is already refused either way - the bytes are what is
      // outstanding, and claiming DELETED here would strand them forever.
      await prisma.proctoringAsset.updateMany({
        where: { id: asset.id, status: { not: 'DELETED' } },
        data: { status: 'EXPIRED' },
      })
      report.deleteFailures++
      // The asset id only - never the object key, which is internal addressing.
      console.error('R2_ASSET_DELETE_FAILED', { assetId: asset.id })
    }
    report.assetsExpired++
  }

  // Sessions whose retention window has closed. Their reservation is zeroed so
  // an abandoned session cannot hold budget past its own retention.
  const expiredSessions = await prisma.proctoringSession.updateMany({
    where: {
      retentionExpiresAt: { lte: now },
      status: { in: ['COMPLETED', 'INTERRUPTED'] },
    },
    data: { status: 'EXPIRED', storageReservedBytes: 0 },
  })
  report.sessionsExpired = expiredSessions.count

  report.staleReservationsReleased = await sweepStaleReservations(now)

  return report
}
