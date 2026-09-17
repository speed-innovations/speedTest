import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const schedules = await prisma.testSchedule.findMany({
    where: { testId: params.id, isActive: true },
    include: { college: true, _count: { select: { attempts: true } } },
    orderBy: { scheduledAt: 'asc' }
  })
  return NextResponse.json(schedules)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const schedule = await prisma.testSchedule.create({
    data: {
      testId: params.id,
      collegeId: body.collegeId,
      scheduledAt: new Date(body.scheduledAt),
      endsAt: new Date(body.endsAt),
      instructions: body.instructions || null,
    },
    include: { college: true, test: true }
  })

  // Update test status to SCHEDULED
  await prisma.test.update({ where: { id: params.id }, data: { status: 'SCHEDULED' } })

  return NextResponse.json(schedule, { status: 201 })
}
