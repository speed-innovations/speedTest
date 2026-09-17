import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const schedule = await prisma.testSchedule.update({
    where: { id: params.id },
    data: {
      collegeId: body.collegeId,
      scheduledAt: new Date(body.scheduledAt),
      endsAt: new Date(body.endsAt),
      instructions: body.instructions || null,
    },
    include: { college: true }
  })
  return NextResponse.json(schedule)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.testSchedule.update({
    where: { id: params.id },
    data: { isActive: false }
  })
  return NextResponse.json({ success: true })
}
