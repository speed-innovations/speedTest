import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const collegeId = searchParams.get('collegeId')
  const testId = searchParams.get('testId')
  const search = searchParams.get('search')

  // Scheduled test attempts
  const scheduledAttempts = await prisma.testAttempt.findMany({
    where: {
      isSubmitted: true,
      ...(testId ? { schedule: { testId } } : {}),
      ...(collegeId ? { student: { collegeId } } : {}),
      ...(search ? { student: { fullName: { contains: search, mode: 'insensitive' as const } } } : {}),
    },
    include: {
      student: { include: { college: true } },
      schedule: { include: { test: true } },
    },
    orderBy: { totalScore: 'desc' }
  })

  // Walk-in test attempts
  const walkInAttempts = await prisma.walkInAttempt.findMany({
    where: {
      isSubmitted: true,
      ...(testId ? { testId } : {}),
      ...(collegeId ? { student: { collegeId } } : {}),
      ...(search ? { student: { fullName: { contains: search, mode: 'insensitive' as const } } } : {}),
    },
    include: {
      student: { include: { college: true } },
      test: true,
    },
    orderBy: { totalScore: 'desc' }
  })

  // Normalize walk-in attempts to match scheduled attempt shape
  const normalizedWalkIn = walkInAttempts.map(a => ({
    ...a,
    type: 'walkin' as const,
    schedule: { test: a.test },
  }))

  const normalizedScheduled = scheduledAttempts.map(a => ({
    ...a,
    type: 'scheduled' as const,
  }))

  // Merge and sort by score descending
  const allResults = [...normalizedScheduled, ...normalizedWalkIn].sort((a, b) => {
    const scoreA = a.totalScore ?? 0
    const scoreB = b.totalScore ?? 0
    return scoreB - scoreA
  })

  return NextResponse.json(allResults)
}
