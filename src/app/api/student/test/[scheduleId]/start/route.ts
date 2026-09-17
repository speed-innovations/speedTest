import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: { scheduleId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { email: session.user!.email! },
    include: { studentProfile: true }
  })
  if (!user?.studentProfile)
    return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })

  const schedule = await prisma.testSchedule.findUnique({
    where: { id: params.scheduleId },
    include: { test: true }
  })
  if (!schedule) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  const now = new Date()
  if (now < new Date(schedule.scheduledAt))
    return NextResponse.json({ error: 'Test has not started yet' }, { status: 400 })
  if (now > new Date(schedule.endsAt))
    return NextResponse.json({ error: 'Test has ended' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const questionIds = body.questionIds || null

  // Find or create attempt
  let attempt = await prisma.testAttempt.findUnique({
    where: { scheduleId_studentId: { scheduleId: params.scheduleId, studentId: user.studentProfile.id } }
  })

  if (attempt?.isSubmitted)
    return NextResponse.json({ error: 'Test already submitted' }, { status: 400 })

  if (!attempt) {
    attempt = await prisma.testAttempt.create({
      data: {
        scheduleId: params.scheduleId,
        studentId: user.studentProfile.id,
        userId: user.id,
        startedAt: new Date(),
        questionIds,
      }
    })

    await prisma.studentProfile.update({
      where: { id: user.studentProfile.id },
      data: { status: 'APPEARED' }
    })
  } else if (!attempt.questionIds && questionIds) {
    await prisma.testAttempt.update({
      where: { id: attempt.id },
      data: { questionIds }
    })
  }

  return NextResponse.json({ attemptId: attempt.id })
}
