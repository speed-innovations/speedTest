import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: { testId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { attemptId, violation } = await req.json()

  const attempt = await prisma.walkInAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

  const existingViolations = (attempt.violations as any[]) || []
  existingViolations.push(violation)

  await prisma.walkInAttempt.update({
    where: { id: attemptId },
    data: { violations: existingViolations }
  })

  // Flag the response for the current question
  if (violation.questionId) {
    await prisma.walkInResponse.updateMany({
      where: { attemptId, questionId: violation.questionId },
      data: { flagged: true }
    })
  }

  return NextResponse.json({ recorded: true })
}
