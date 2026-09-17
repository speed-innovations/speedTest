import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { pickQuestionsByConfig } from '@/lib/question-picker'

export async function GET(req: NextRequest, { params }: { params: { testId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'STUDENT')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Parallel fetch: user + test in one go
    const [user, test] = await Promise.all([
      prisma.user.findUnique({
        where: { email: session.user!.email! },
        include: { studentProfile: true }
      }),
      prisma.test.findUnique({
        where: { id: params.testId },
        include: { jobOpening: true }
      })
    ])

    if (!user?.studentProfile)
      return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })
    if (!test || !test.isActive || !test.isWalkIn || test.status !== 'ACTIVE')
      return NextResponse.json({ error: 'Test not available' }, { status: 404 })

    const studentId = user.studentProfile.id

    // Parallel fetch: eligibility + existing attempt
    const [eligible, existingAttempt] = await Promise.all([
      prisma.walkInEligibleStudent.findUnique({
        where: { testId_studentId: { testId: params.testId, studentId } }
      }),
      prisma.walkInAttempt.findUnique({
        where: { testId_studentId: { testId: params.testId, studentId } },
        include: { responses: { select: { questionId: true, selectedAnswer: true } } }
      })
    ])

    if (!eligible || !eligible.isEnabled)
      return NextResponse.json({ error: 'You are not enabled for this test. Contact your administrator.' }, { status: 403 })

    if (existingAttempt?.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted', isSubmitted: true }, { status: 400 })

    let finalQuestionIds: string[]
    const config = test.assessmentConfig as any[]
    const configuredCount = config.reduce((sum: number, c: any) => sum + (c.count || 0), 0)

    if (existingAttempt?.questionIds) {
      const persisted = existingAttempt.questionIds as string[]
      if (persisted.length < configuredCount) {
        // Supplement: keep existing questions (and answers), add more to reach configured count
        const freshPicks = await pickQuestionsByConfig(config)
        const existingSet = new Set(persisted)
        const additions = freshPicks.filter(id => !existingSet.has(id)).slice(0, configuredCount - persisted.length)
        finalQuestionIds = [...persisted, ...additions]
        await prisma.walkInAttempt.update({
          where: { id: existingAttempt.id },
          data: { questionIds: finalQuestionIds }
        })
        console.log(`Supplemented attempt ${existingAttempt.id}: was ${persisted.length}, now ${finalQuestionIds.length} (configured ${configuredCount})`)
      } else {
        finalQuestionIds = persisted
      }
    } else {
      finalQuestionIds = await pickQuestionsByConfig(config)
      if (existingAttempt) {
        await prisma.walkInAttempt.update({
          where: { id: existingAttempt.id },
          data: { questionIds: finalQuestionIds }
        })
      }
    }

    console.log(`Walk-in test ${params.testId} for student ${studentId}: serving ${finalQuestionIds.length} questions (configured: ${configuredCount})`)

    const questions = await prisma.question.findMany({
      where: { id: { in: finalQuestionIds } },
      select: {
        id: true, questionText: true, optionA: true, optionB: true,
        optionC: true, optionD: true, area: true, weightage: true
      }
    })

    const questionMap = new Map(questions.map(q => [q.id, q]))
    const orderedQuestions = finalQuestionIds.map(id => questionMap.get(id)).filter(Boolean)

    const savedAnswers: Record<string, string> = {}
    if (existingAttempt) {
      existingAttempt.responses.forEach(r => {
        if (r.selectedAnswer) savedAnswers[r.questionId] = r.selectedAnswer
      })
    }

    return NextResponse.json({
      test: { id: test.id, title: test.title, description: test.description, durationMinutes: test.durationMinutes, totalMarks: test.totalMarks, passingMarks: test.passingMarks, jobOpening: test.jobOpening },
      questions: orderedQuestions,
      attemptId: existingAttempt?.id || null,
      savedAnswers,
      isSubmitted: false,
    })
  } catch (err: any) {
    console.error('Walk-in test GET error:', err)
    return NextResponse.json({ error: 'Failed to load test. Please refresh.' }, { status: 500 })
  }
}
