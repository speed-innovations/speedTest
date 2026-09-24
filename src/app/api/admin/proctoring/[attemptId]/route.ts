import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, errorResponse, HttpError } from '@/lib/attempt-auth'
import { getAdminEvidence } from '@/lib/proctoring/admin'

/**
 * Proctoring observations for one attempt, addressed as ?type=scheduled|walkin
 * like /api/admin/results/detail. Metadata only.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ attemptId: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()

    const type = new URL(req.url).searchParams.get('type')
    if (type !== 'scheduled' && type !== 'walkin') {
      throw new HttpError(400, 'type must be scheduled or walkin')
    }

    const evidence = await getAdminEvidence(params.attemptId, type)
    return NextResponse.json(evidence)
  } catch (err) {
    return errorResponse(err, 'Proctoring evidence error', 'Could not load proctoring evidence.')
  }
}
