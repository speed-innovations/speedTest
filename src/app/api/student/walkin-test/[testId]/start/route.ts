import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: { testId: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { email: session.user!.email! },
    include: { studentProfile: true }
  })
  if (!user?.studentProfile)
    return NextResponse.json({ error: 'Student profile not found' }, { status: 404 })

  const test = await prisma.test.findUnique({ where: { id: params.testId } })
  if (!test || !test.isActive || !test.isWalkIn)
    return NextResponse.json({ error: 'Test not available' }, { status: 404 })
  if (test.status !== 'ACTIVE')
    return NextResponse.json({ error: 'Test is not active' }, { status: 400 })

  // Check eligibility
  const eligible = await prisma.walkInEligibleStudent.findUnique({
    where: { testId_studentId: { testId: params.testId, studentId: user.studentProfile.id } }
  })
  if (!eligible || !eligible.isEnabled)
    return NextResponse.json({ error: 'You are not enabled for this test' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const questionIds = body.questionIds || null

  // Find or create attempt
  let attempt = await prisma.walkInAttempt.findUnique({
    where: { testId_studentId: { testId: params.testId, studentId: user.studentProfile.id } }
  })

  if (attempt?.isSubmitted)
    return NextResponse.json({ error: 'Test already submitted' }, { status: 400 })

  if (!attempt) {
    attempt = await prisma.walkInAttempt.create({
      data: {
        testId: params.testId,
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
    // Attempt exists but no questions saved yet — save them now
    await prisma.walkInAttempt.update({
      where: { id: attempt.id },
      data: { questionIds }
    })
  }

  return NextResponse.json({ attemptId: attempt.id })
}
