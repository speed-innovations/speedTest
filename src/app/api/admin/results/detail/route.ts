import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const attemptId = searchParams.get('attemptId')
  const type = searchParams.get('type') // 'scheduled' or 'walkin'

  if (!attemptId || !type)
    return NextResponse.json({ error: 'attemptId and type required' }, { status: 400 })

  if (type === 'walkin') {
    const attempt = await prisma.walkInAttempt.findUnique({
      where: { id: attemptId },
      include: {
        student: { include: { college: true } },
        test: true,
        responses: {
          include: { question: true },
          orderBy: { question: { area: 'asc' } }
        }
      }
    })

    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

    return NextResponse.json({
      student: attempt.student,
      test: attempt.test,
      totalScore: attempt.totalScore,
      areaScores: attempt.areaScores,
      violations: attempt.violations,
      submittedAt: attempt.submittedAt,
      startedAt: attempt.startedAt,
      responses: attempt.responses.map(r => ({
        questionId: r.questionId,
        questionText: r.question.questionText,
        area: r.question.area,
        difficulty: r.question.difficulty,
        optionA: r.question.optionA,
        optionB: r.question.optionB,
        optionC: r.question.optionC,
        optionD: r.question.optionD,
        correctAnswer: r.question.correctAnswer,
        selectedAnswer: r.selectedAnswer,
        isCorrect: r.isCorrect,
        marksAwarded: r.marksAwarded,
        weightage: r.question.weightage,
        flagged: r.flagged,
      }))
    })
  }

  // Scheduled attempt
  const attempt = await prisma.testAttempt.findUnique({
    where: { id: attemptId },
    include: {
      student: { include: { college: true } },
      schedule: { include: { test: true } },
      responses: {
        include: { question: true },
        orderBy: { question: { area: 'asc' } }
      }
    }
  })

  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

  return NextResponse.json({
    student: attempt.student,
    test: attempt.schedule.test,
    totalScore: attempt.totalScore,
    areaScores: attempt.areaScores,
    violations: attempt.violations,
    submittedAt: attempt.submittedAt,
    startedAt: attempt.startedAt,
    responses: attempt.responses.map(r => ({
      questionId: r.questionId,
      questionText: r.question.questionText,
      area: r.question.area,
      difficulty: r.question.difficulty,
      optionA: r.question.optionA,
      optionB: r.question.optionB,
      optionC: r.question.optionC,
      optionD: r.question.optionD,
      correctAnswer: r.question.correctAnswer,
      selectedAnswer: r.selectedAnswer,
      isCorrect: r.isCorrect,
      marksAwarded: r.marksAwarded,
      weightage: r.question.weightage,
      flagged: r.flagged,
    }))
  })
}
