import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: { scheduleId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { attemptId, violation } = await req.json()

  const attempt = await prisma.testAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt || attempt.isSubmitted)
    return NextResponse.json({ error: 'Invalid attempt' }, { status: 400 })

  const existingViolations = (attempt.violations as any[]) || []
  await prisma.testAttempt.update({
    where: { id: attemptId },
    data: { violations: [...existingViolations, violation] }
  })

  // Also flag the response for this question
  if (violation.questionId) {
    await prisma.candidateResponse.upsert({
      where: { attemptId_questionId: { attemptId, questionId: violation.questionId } },
      create: { attemptId, questionId: violation.questionId, flagged: true },
      update: { flagged: true }
    })
  }

  return NextResponse.json({ success: true })
}
