import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, errorResponse, HttpError } from '@/lib/attempt-auth'
import { getAdminEvidence } from '@/lib/proctoring/admin'

/**
 * Proctoring evidence for one attempt.
 *
 * Addressed as ?type=scheduled|walkin, the same shape
 * /api/admin/results/detail already uses. That route stays untouched: evidence
 * loads separately so the gallery can lazy-load rather than bloating a response
 * that already carries every question and answer.
 *
 * Carries no object key and no signed URL - see the note in lib/proctoring/admin.
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
