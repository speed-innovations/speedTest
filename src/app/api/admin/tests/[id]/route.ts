import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const test = await prisma.test.findUnique({
    where: { id: params.id },
    include: { jobOpening: true, schedules: { include: { college: true } } }
  })
  if (!test) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(test)
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
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
      jobOpeningId: body.jobOpeningId || null,
      // undefined when the caller did not send the field, which Prisma reads as
      // "leave this column alone". That is deliberate here and is how every
      // other field in this route already behaves: the tests list sends partial
      // bodies (the walk-in toggle sends only isWalkIn and status), and those
      // must not silently switch proctoring off. Only an explicit boolean
      // changes it.
      proctoringEnabled:
        typeof body.proctoringEnabled === 'boolean' ? body.proctoringEnabled : undefined,
    }
  })
  return NextResponse.json(test)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.test.update({
    where: { id: params.id },
    data: { isActive: false }
  })
  return NextResponse.json({ success: true })
}
