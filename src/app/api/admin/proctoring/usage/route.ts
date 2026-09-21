import { NextResponse } from 'next/server'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { getUsageReport } from '@/lib/proctoring/admin'

/**
 * Remaining proctoring capacity.
 *
 * Read from our own tables, never by listing the bucket. "Storage limit
 * reached" is a routine state at the configured budget rather than an edge
 * case, so an operator needs this number before a drive, not after one fails.
 */
export async function GET() {
  try {
    await requireAdmin()
    return NextResponse.json(await getUsageReport())
  } catch (err) {
    return errorResponse(err, 'Proctoring usage error', 'Could not load proctoring usage.')
  }
}
