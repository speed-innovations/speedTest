import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

/**
 * Reset a student's test attempt — deletes responses and clears questionIds
 * so the student gets a fresh question set on next load.
 * Works for both scheduled and walk-in tests.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { studentId, type } = await req.json()
  if (!studentId || !type)
    return NextResponse.json({ error: 'studentId and type required' }, { status: 400 })

  try {
    if (type === 'walkin') {
      const attempt = await prisma.walkInAttempt.findUnique({
        where: { testId_studentId: { testId: params.id, studentId } }
      })
      if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
      if (attempt.isSubmitted)
        return NextResponse.json({ error: 'Cannot reset a submitted attempt' }, { status: 400 })

      await prisma.$transaction([
        prisma.walkInResponse.deleteMany({ where: { attemptId: attempt.id } }),
        prisma.walkInAttempt.update({
          where: { id: attempt.id },
          data: { questionIds: undefined as any, startedAt: null, violations: [] }
        })
      ])
      return NextResponse.json({ success: true })
    } else {
      // Scheduled test
      const attempt = await prisma.testAttempt.findFirst({
        where: { schedule: { testId: params.id }, studentId }
      })
      if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
      if (attempt.isSubmitted)
        return NextResponse.json({ error: 'Cannot reset a submitted attempt' }, { status: 400 })

      await prisma.$transaction([
        prisma.candidateResponse.deleteMany({ where: { attemptId: attempt.id } }),
        prisma.testAttempt.update({
          where: { id: attempt.id },
          data: { questionIds: undefined as any, startedAt: null, violations: [] }
        })
      ])
      return NextResponse.json({ success: true })
    }
  } catch (err: any) {
    console.error('Reset attempt error:', err)
    return NextResponse.json({ error: 'Failed to reset attempt' }, { status: 500 })
  }
}
