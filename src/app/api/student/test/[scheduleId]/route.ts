import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { pickQuestionsByConfig } from '@/lib/question-picker'

export async function GET(req: NextRequest, { params }: { params: { scheduleId: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'STUDENT')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Parallel fetch: user + schedule
    const [user, schedule] = await Promise.all([
      prisma.user.findUnique({
        where: { email: session.user!.email! },
        include: { studentProfile: true }
      }),
      prisma.testSchedule.findUnique({
        where: { id: params.scheduleId },
        include: { test: { include: { jobOpening: true } }, college: true }
      })
    ])

    if (!user?.studentProfile)
      return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })
    if (!schedule)
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    if (schedule.collegeId !== user.studentProfile.collegeId)
      return NextResponse.json({ error: 'Not authorized for this test' }, { status: 403 })

    const now = new Date()
    if (now < new Date(schedule.scheduledAt))
      return NextResponse.json({ error: 'Test has not started yet' }, { status: 400 })
    if (now > new Date(schedule.endsAt))
      return NextResponse.json({ error: 'Test has ended' }, { status: 400 })

    const existingAttempt = await prisma.testAttempt.findUnique({
      where: { scheduleId_studentId: { scheduleId: params.scheduleId, studentId: user.studentProfile.id } },
      include: { responses: { select: { questionId: true, selectedAnswer: true } } }
    })

    if (existingAttempt?.isSubmitted)
      return NextResponse.json({ error: 'Test already submitted', isSubmitted: true }, { status: 400 })

    let finalQuestionIds: string[]
    const config = schedule.test.assessmentConfig as any[]
    const configuredCount = config.reduce((sum: number, c: any) => sum + (c.count || 0), 0)

    if (existingAttempt?.questionIds) {
      const persisted = existingAttempt.questionIds as string[]
      if (persisted.length < configuredCount) {
        const freshPicks = await pickQuestionsByConfig(config)
        const existingSet = new Set(persisted)
        const additions = freshPicks.filter(id => !existingSet.has(id)).slice(0, configuredCount - persisted.length)
        finalQuestionIds = [...persisted, ...additions]
        await prisma.testAttempt.update({
          where: { id: existingAttempt.id },
          data: { questionIds: finalQuestionIds }
        })
        console.log(`Supplemented attempt ${existingAttempt.id}: was ${persisted.length}, now ${finalQuestionIds.length}`)
      } else {
        finalQuestionIds = persisted
      }
    } else {
      finalQuestionIds = await pickQuestionsByConfig(config)
      if (existingAttempt) {
        await prisma.testAttempt.update({
          where: { id: existingAttempt.id },
          data: { questionIds: finalQuestionIds }
        })
      }
    }

    console.log(`Test ${params.scheduleId} for student ${user.studentProfile.id}: serving ${finalQuestionIds.length} questions (configured: ${configuredCount})`)

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
      schedule,
      questions: orderedQuestions,
      attemptId: existingAttempt?.id || null,
      savedAnswers,
      isSubmitted: false,
    })
  } catch (err: any) {
    console.error('Test GET error:', err)
    return NextResponse.json({ error: 'Failed to load test. Please refresh.' }, { status: 500 })
  }
}
