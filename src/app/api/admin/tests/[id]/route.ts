import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { testUpdateSchema } from '@/lib/schemas/admin'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const test = await prisma.test.findUnique({
      where: { id: params.id },
      include: { jobOpening: true, schedules: { include: { college: true } } }
    })
    if (!test) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(test)
  } catch (err) {
    return errorResponse(err, 'Test read error', 'Could not load the test.')
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const body = await parseBody(req, testUpdateSchema)

    // Every field is left `undefined` when the caller omitted it, which Prisma
    // reads as "leave this column alone". The admin UI genuinely sends
    // single-field bodies - the tests list's walk-in and proctoring toggles -
    // so a partial update has to be the normal case, not an edge case.
    //
    // jobOpeningId needs the explicit undefined check. It used to read
    // `body.jobOpeningId || null`, which turned an omitted field into null:
    // every toggle from the tests list silently cleared the test's job opening.
    // `null` still clears it deliberately; absent now means absent.
    const test = await prisma.test.update({
      where: { id: params.id },
      data: {
        title: body.title,
        description: body.description,
        durationMinutes: body.durationMinutes,
        totalMarks: body.totalMarks,
        passingMarks: body.passingMarks,
        status: body.status,
        isWalkIn: body.isWalkIn,
        assessmentConfig: body.assessmentConfig,
        jobOpeningId: body.jobOpeningId === undefined ? undefined : (body.jobOpeningId || null),
        proctoringEnabled: body.proctoringEnabled,
      }
    })
    return NextResponse.json(test)
  } catch (err) {
    return errorResponse(err, 'Test update error', 'Could not update the test.')
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    await prisma.test.update({ where: { id: params.id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, 'Test delete error', 'Could not delete the test.')
  }
}
