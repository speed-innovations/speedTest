import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runRetentionCleanup } from '@/lib/proctoring/retention'

/**
 * Called by the scheduled GitHub workflow.
 *
 * Authenticated by a shared secret rather than a session: there is no user
 * here. The blast radius of a leaked secret is an early close of already-stale
 * sessions - no data is deleted through this endpoint.
 */
/**
 * Constant-time comparison. timingSafeEqual needs equal-length buffers, so a
 * length mismatch is rejected first; that reveals only the length, never the
 * secret's content.
 */
function secretMatches(provided: string, secret: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(secret, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('PROCTORING_CLEANUP_MISCONFIGURED: CRON_SECRET is not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!secretMatches(provided, secret)) {
    // No detail: an unauthenticated caller learns nothing about why.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await runRetentionCleanup()
    console.log('PROCTORING_CLEANUP_COMPLETED', report)
    return NextResponse.json(report)
  } catch (err) {
    console.error('PROCTORING_CLEANUP_FAILED:', err)
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
