import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const criteria = await prisma.shortlistCriteria.findUnique({ where: { id: params.id } })
  if (!criteria) return NextResponse.json({ error: 'Criteria not found' }, { status: 404 })

  // Fetch scheduled test attempts
  const scheduledAttempts = await prisma.testAttempt.findMany({
    where: {
      isSubmitted: true,
      ...(criteria.testId ? { schedule: { testId: criteria.testId } } : {}),
    },
    include: { student: { include: { college: true } } }
  })

  // Fetch walk-in test attempts
  const walkInAttempts = await prisma.walkInAttempt.findMany({
    where: {
      isSubmitted: true,
      ...(criteria.testId ? { testId: criteria.testId } : {}),
    },
    include: { student: { include: { college: true } } }
  })

  const minAreaScores = criteria.minAreaScores as Record<string, number> | null

  // Combine both attempt types into a uniform shape
  const allAttempts = [
    ...scheduledAttempts.map(a => ({ student: a.student, totalScore: a.totalScore, areaScores: a.areaScores })),
    ...walkInAttempts.map(a => ({ student: a.student, totalScore: a.totalScore, areaScores: a.areaScores })),
  ]

  const results = []
  let shortlisted = 0

  for (const attempt of allAttempts) {
    const s = attempt.student
    const areaScores = attempt.areaScores as Record<string, number> | null || {}

    let passes = true

    if (criteria.minTotalScore && (attempt.totalScore || 0) < criteria.minTotalScore) passes = false
    if (criteria.minTenthMarks && (s.tenthMarks || 0) < criteria.minTenthMarks) passes = false
    if (criteria.minTwelfthMarks && (s.twelfthMarks || 0) < criteria.minTwelfthMarks) passes = false
    if (criteria.minGradMarks && (s.graduationMarks || 0) < criteria.minGradMarks) passes = false

    if (minAreaScores) {
      for (const [area, minScore] of Object.entries(minAreaScores)) {
        if ((areaScores[area] || 0) < minScore) { passes = false; break }
      }
    }

    if (passes) {
      shortlisted++
      await prisma.studentProfile.update({
        where: { id: s.id },
        data: { status: 'SHORTLISTED' }
      })
    }

    results.push({
      studentId: s.id,
      fullName: s.fullName,
      college: s.college?.name,
      totalScore: attempt.totalScore,
      passes,
    })
  }

  results.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))

  return NextResponse.json({ results, shortlisted, total: allAttempts.length })
}
