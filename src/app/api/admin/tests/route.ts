import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tests = await prisma.test.findMany({
    where: { isActive: true },
    include: { jobOpening: true },
    orderBy: { createdAt: 'desc' }
  })
  return NextResponse.json(tests)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const test = await prisma.test.create({
    data: {
      title: body.title,
      description: body.description || null,
      durationMinutes: body.durationMinutes,
      totalMarks: body.totalMarks,
      passingMarks: body.passingMarks,
      assessmentConfig: body.assessmentConfig,
      jobOpeningId: body.jobOpeningId || null,
      isWalkIn: body.isWalkIn || false,
      status: body.isWalkIn ? 'ACTIVE' : 'DRAFT',
    }
  })
  return NextResponse.json(test, { status: 201 })
}
