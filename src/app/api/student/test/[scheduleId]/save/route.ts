import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: { scheduleId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { attemptId } = body

  // Support batch saves: { attemptId, answers: { qId: "A", qId2: "B" } }
  const answers: Record<string, string> = body.answers || {}
  // Backward compat: single save
  if (body.questionId && body.answer) {
    answers[body.questionId] = body.answer
  }

  const entries = Object.entries(answers)
  if (entries.length === 0) return NextResponse.json({ saved: true })

  // Batch upsert in chunks of 5
  for (let i = 0; i < entries.length; i += 5) {
    const batch = entries.slice(i, i + 5)
    await Promise.all(batch.map(([questionId, answer]) =>
      prisma.candidateResponse.upsert({
        where: { attemptId_questionId: { attemptId, questionId } },
        create: { attemptId, questionId, selectedAnswer: answer, answeredAt: new Date() },
        update: { selectedAnswer: answer, answeredAt: new Date() }
      })
    ))
  }

  return NextResponse.json({ saved: true })
}
