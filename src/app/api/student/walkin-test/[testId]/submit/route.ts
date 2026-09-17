import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: { testId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'STUDENT')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { attemptId, answers, violations } = body

    if (!attemptId)
      return NextResponse.json({ error: 'Missing attemptId' }, { status: 400 })

    const attempt = await prisma.walkInAttempt.findUnique({
      where: { id: attemptId },
      include: { test: true }
    })
    if (!attempt)
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

    // If already submitted, return success (idempotent — allows retry)
    if (attempt.isSubmitted)
      return NextResponse.json({ success: true, totalScore: attempt.totalScore, areaScores: attempt.areaScores })

    // Grade the test
    const answerEntries = Object.entries(answers || {}) as [string, string][]
    const questionIds = answerEntries.map(([qId]) => qId)

    const questions = questionIds.length > 0
      ? await prisma.question.findMany({ where: { id: { in: questionIds } } })
      : []

    let totalScore = 0
    const areaScores: Record<string, number> = {}

    const graded = questions.map(q => {
      const selectedAnswer = answers[q.id]
      const isCorrect = selectedAnswer === q.correctAnswer
      const marksAwarded = isCorrect ? q.weightage : 0
      totalScore += marksAwarded
      areaScores[q.area] = (areaScores[q.area] || 0) + marksAwarded
      return { questionId: q.id, selectedAnswer, isCorrect, marksAwarded }
    })

    // Use a transaction to ensure atomicity — batch responses in chunks to avoid pool exhaustion
    await prisma.$transaction(async (tx) => {
      // Process responses in batches of 10
      for (let i = 0; i < graded.length; i += 10) {
        const batch = graded.slice(i, i + 10)
        await Promise.all(batch.map(g =>
          tx.walkInResponse.upsert({
            where: { attemptId_questionId: { attemptId, questionId: g.questionId } },
            create: {
              attemptId, questionId: g.questionId,
              selectedAnswer: g.selectedAnswer, isCorrect: g.isCorrect,
              marksAwarded: g.marksAwarded, answeredAt: new Date(),
            },
            update: { selectedAnswer: g.selectedAnswer, isCorrect: g.isCorrect, marksAwarded: g.marksAwarded }
          })
        ))
      }

      // Mark as submitted
      await tx.walkInAttempt.update({
        where: { id: attemptId },
        data: {
          isSubmitted: true,
          submittedAt: new Date(),
          totalScore,
          areaScores,
          violations: violations || [],
        }
      })
    }, { timeout: 30000 })

    return NextResponse.json({ success: true, totalScore, areaScores })
  } catch (err: any) {
    console.error('Walk-in submit error:', err)
    return NextResponse.json(
      { error: 'Submit failed. Please try again.', detail: err.message },
      { status: 500 }
    )
  }
}
