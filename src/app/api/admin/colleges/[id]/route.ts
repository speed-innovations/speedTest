import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { collegeUpdateSchema } from '@/lib/schemas/admin'

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const body = await parseBody(req, collegeUpdateSchema)
    // Omitted fields stay undefined so Prisma leaves those columns alone.
    const college = await prisma.college.update({
      where: { id: params.id },
      data: {
        name: body.name,
        address: body.address,
        city: body.city,
        state: body.state,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        isActive: body.isActive,
      }
    })
    return NextResponse.json(college)
  } catch (err) {
    return errorResponse(err, 'College update error', 'Could not update the college.')
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    await prisma.college.update({ where: { id: params.id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, 'College delete error', 'Could not delete the college.')
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const college = await prisma.college.findUnique({ where: { id: params.id } })
    return NextResponse.json(college)
  } catch (err) {
    return errorResponse(err, 'College read error', 'Could not load the college.')
  }
}
