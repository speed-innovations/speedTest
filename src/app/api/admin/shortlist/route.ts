import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const criteria = await prisma.shortlistCriteria.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' }
  })
  return NextResponse.json(criteria)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const criteria = await prisma.shortlistCriteria.create({
    data: {
      name: body.name,
      testId: body.testId || null,
      minTotalScore: body.minTotalScore || null,
      minTenthMarks: body.minTenthMarks || null,
      minTwelfthMarks: body.minTwelfthMarks || null,
      minGradMarks: body.minGradMarks || null,
      minAreaScores: body.minAreaScores || null,
    }
  })
  return NextResponse.json(criteria, { status: 201 })
}
