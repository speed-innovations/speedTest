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
  const criteria = await prisma.shortlistCriteria.update({
    where: { id: params.id },
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
  return NextResponse.json(criteria)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.shortlistCriteria.update({
    where: { id: params.id },
    data: { isActive: false }
  })
  return NextResponse.json({ success: true })
}
