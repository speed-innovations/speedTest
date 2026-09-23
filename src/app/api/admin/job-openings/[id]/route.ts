import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { jobOpeningUpdateSchema } from '@/lib/schemas/admin'

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const body = await parseBody(req, jobOpeningUpdateSchema)
    // Omitted fields stay undefined so Prisma leaves those columns alone.
    const job = await prisma.jobOpening.update({
      where: { id: params.id },
      data: {
        title: body.title,
        description: body.description,
        location: body.location,
        openings: body.openings,
        requiredSkills: body.requiredSkills,
        niceToHaveSkills: body.niceToHaveSkills,
      }
    })
    return NextResponse.json(job)
  } catch (err) {
    return errorResponse(err, 'Job opening update error', 'Could not update the job opening.')
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const body = await parseBody(req, jobOpeningUpdateSchema)
    const job = await prisma.jobOpening.update({
      where: { id: params.id },
      data: { isActive: body.isActive }
    })
    return NextResponse.json(job)
  } catch (err) {
    return errorResponse(err, 'Job opening patch error', 'Could not update the job opening.')
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    await prisma.jobOpening.update({ where: { id: params.id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, 'Job opening delete error', 'Could not delete the job opening.')
  }
}
