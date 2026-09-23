import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { questionUpdateSchema } from '@/lib/schemas/admin'

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    const body = await parseBody(req, questionUpdateSchema)
    // Omitted fields stay undefined so Prisma leaves those columns alone.
    const q = await prisma.question.update({
      where: { id: params.id },
      data: {
        area: body.area,
        questionText: body.questionText,
        optionA: body.optionA,
        optionB: body.optionB,
        optionC: body.optionC,
        optionD: body.optionD,
        correctAnswer: body.correctAnswer,
        weightage: body.weightage,
        difficulty: body.difficulty,
      }
    })
    return NextResponse.json(q)
  } catch (err) {
    return errorResponse(err, 'Question update error', 'Could not update the question.')
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  try {
    await requireAdmin()
    await prisma.question.update({ where: { id: params.id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, 'Question delete error', 'Could not delete the question.')
  }
}
