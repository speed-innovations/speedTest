import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { questionCreateSchema } from '@/lib/schemas/admin'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()
    const { searchParams } = new URL(req.url)
    const area = searchParams.get('area')
    const search = searchParams.get('search')
    const difficulty = searchParams.get('difficulty')

    const questions = await prisma.question.findMany({
      where: {
        isActive: true,
        ...(area ? { area: area as never } : {}),
        ...(difficulty ? { difficulty } : {}),
        ...(search ? { questionText: { contains: search, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(questions)
  } catch (err) {
    return errorResponse(err, 'Questions list error', 'Could not load questions.')
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await parseBody(req, questionCreateSchema)
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
  } catch (err) {
    return errorResponse(err, 'Question create error', 'Could not create the question.')
  }
}
