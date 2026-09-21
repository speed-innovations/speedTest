import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { issueDownloadUrl } from '@/lib/proctoring/upload'

/**
 * Admin-only. The returned URL is a bearer token for the object: short-lived,
 * never logged, never persisted, and never handed to a candidate.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const url = await issueDownloadUrl(params.id)
    return NextResponse.json({ url })
  } catch (err) {
    return errorResponse(err, 'Proctoring download-url error', 'Could not prepare the download.')
  }
}
