import { NextRequest, NextResponse } from 'next/server'
import { runRetentionCleanup } from '@/lib/proctoring/retention'

/**
 * Called by the scheduled GitHub workflow.
 *
 * Authenticated by a shared secret rather than a session: there is no user
 * here. The blast radius of a leaked secret is a forced early cleanup of
 * already-expired objects, not data loss - nothing within its retention window
 * can be touched through this endpoint.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('PROCTORING_CLEANUP_MISCONFIGURED: CRON_SECRET is not set')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  // Length check first so the comparison below is over equal-length strings.
  if (provided.length !== secret.length || provided !== secret) {
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
