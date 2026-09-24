import { prisma } from '@/lib/db'
import { sweepStaleSessions } from './session'

/**
 * Scheduled housekeeping for proctoring sessions.
 *
 * Metadata only: there are no media objects to delete. What remains is closing
 * sessions whose browser vanished, and marking sessions past their retention
 * window EXPIRED so they can never be resumed. Event rows are kept for review.
 *
 * Bounded and idempotent: GitHub's scheduler runs late and occasionally not at
 * all, so a multi-day gap is an expected input.
 */

export interface CleanupReport {
  sessionsExpired: number
  staleSessionsInterrupted: number
}

export async function runRetentionCleanup(opts: { now?: Date } = {}): Promise<CleanupReport> {
  const now = opts.now ?? new Date()
  const expired = await prisma.proctoringSession.updateMany({
    where: { retentionExpiresAt: { lte: now }, status: { in: ['COMPLETED', 'INTERRUPTED'] } },
    data: { status: 'EXPIRED' },
  })
  const staleSessionsInterrupted = await sweepStaleSessions(now)
  return { sessionsExpired: expired.count, staleSessionsInterrupted }
}
