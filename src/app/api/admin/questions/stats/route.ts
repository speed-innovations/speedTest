import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const questions = await prisma.question.findMany({
    where: { isActive: true },
    select: { area: true, weightage: true, difficulty: true }
  })

  const stats: Record<string, { count: number; totalWeightage: number; easy: number; medium: number; hard: number }> = {}
  for (const q of questions) {
    if (!stats[q.area]) stats[q.area] = { count: 0, totalWeightage: 0, easy: 0, medium: 0, hard: 0 }
    stats[q.area].count++
    stats[q.area].totalWeightage += q.weightage
    if (q.difficulty === 'EASY') stats[q.area].easy++
    else if (q.difficulty === 'MEDIUM') stats[q.area].medium++
    else if (q.difficulty === 'HARD') stats[q.area].hard++
  }

  const result: Record<string, { count: number; avgWeightage: number; easy: number; medium: number; hard: number }> = {}
  for (const [area, s] of Object.entries(stats)) {
    result[area] = {
      count: s.count,
      avgWeightage: s.count > 0 ? Math.round((s.totalWeightage / s.count) * 10) / 10 : 0,
      easy: s.easy,
      medium: s.medium,
      hard: s.hard,
    }
  }

  return NextResponse.json(result)
}
