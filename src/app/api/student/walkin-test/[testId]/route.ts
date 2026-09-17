import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { pickQuestionsByConfig } from '@/lib/question-picker'
import {
  requireStudent,
  errorResponse,
  assignedQuestionIds,
  remainingSeconds,
} from '@/lib/attempt-auth'

export async function GET(req: NextRequest, { params }: { params: { testId: string } }) {
  try {
    const student = await requireStudent()

    const test = await prisma.test.findUnique({
      where: { id: params.testId },
      include: { jobOpening: true },
    })
    if (!test || !test.isActive || !test.isWalkIn || test.status !== 'ACTIVE')
      return NextResponse.json({ error: 'Test not available' }, { status: 404 })

    const eligible = await prisma.walkInEligibleStudent.findUnique({
      where: { testId_studentId: { testId: params.testId, studentId: student.studentId } },
    })
    if (!eligible || !eligible.isEnabled)
      return NextResponse.json(
        { error: 'You are not enabled for this test. Contact your administrator.' },
        { status: 403 }
      )

    let attempt = await prisma.walkInAttempt.findUnique({
      where: { testId_studentId: { testId: params.testId, studentId: student.studentId } },
      include: { responses: { select: { questionId: true, selectedAnswer: true } } },
    })

    if (attempt?.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted', isSubmitted: true }, { status: 400 })

    // Server picks and persists the question set before the student can influence it.
    if (!attempt) {
      const questionIds = await pickQuestionsByConfig(test.assessmentConfig as any[])
      attempt = await prisma.walkInAttempt.create({
        data: {
          testId: params.testId,
          studentId: student.studentId,
          userId: student.userId,
          questionIds,
        },
        include: { responses: { select: { questionId: true, selectedAnswer: true } } },
      })
    }

    const assigned = assignedQuestionIds(attempt.questionIds)
    const testPayload = {
      id: test.id, title: test.title, description: test.description,
      durationMinutes: test.durationMinutes, totalMarks: test.totalMarks,
      passingMarks: test.passingMarks, jobOpening: test.jobOpening,
    }

    // Questions stay hidden until the attempt is started.
    if (!attempt.startedAt) {
      return NextResponse.json({
        test: testPayload,
        started: false,
        isSubmitted: false,
        questionCount: assigned.length,
        attemptId: attempt.id,
        questions: [],
        savedAnswers: {},
      })
    }

    const questions = await prisma.question.findMany({
      where: { id: { in: assigned } },
      select: {
        id: true, questionText: true, optionA: true, optionB: true,
        optionC: true, optionD: true, area: true, weightage: true,
      },
    })
    const byId = new Map(questions.map(q => [q.id, q]))
    const orderedQuestions = assigned.map(id => byId.get(id)).filter(Boolean)

    const savedAnswers: Record<string, string> = {}
    for (const r of attempt.responses) {
      if (r.selectedAnswer) savedAnswers[r.questionId] = r.selectedAnswer
    }

    return NextResponse.json({
      test: testPayload,
      started: true,
      isSubmitted: false,
      questions: orderedQuestions,
      questionCount: orderedQuestions.length,
      attemptId: attempt.id,
      savedAnswers,
      remainingSeconds: remainingSeconds(attempt.expiresAt),
    })
  } catch (err) {
    return errorResponse(err, 'Walk-in test GET error', 'Failed to load test. Please refresh.')
  }
}
