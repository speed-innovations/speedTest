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
  const q = await prisma.question.update({
    where: { id: params.id },
    data: {
      area: body.area, questionText: body.questionText,
      optionA: body.optionA, optionB: body.optionB,
      optionC: body.optionC, optionD: body.optionD,
      correctAnswer: body.correctAnswer,
      weightage: body.weightage, difficulty: body.difficulty,
    }
  })
  return NextResponse.json(q)
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.question.update({ where: { id: params.id }, data: { isActive: false } })
  return NextResponse.json({ success: true })
}
