import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const area = searchParams.get('area')
  const search = searchParams.get('search')
  const difficulty = searchParams.get('difficulty')

  const questions = await prisma.question.findMany({
    where: {
      isActive: true,
      ...(area ? { area: area as any } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(search ? { questionText: { contains: search, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' }
  })
  return NextResponse.json(questions)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const question = await prisma.question.create({
    data: {
      area: body.area,
      questionText: body.questionText,
      optionA: body.optionA,
      optionB: body.optionB,
      optionC: body.optionC,
      optionD: body.optionD,
      correctAnswer: body.correctAnswer,
      weightage: body.weightage || 1,
      difficulty: body.difficulty || 'MEDIUM',
    }
  })
  return NextResponse.json(question, { status: 201 })
}
