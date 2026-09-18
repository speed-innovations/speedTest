import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import * as XLSX from 'xlsx'
import { AREAS, AREA_LABELS } from '@/lib/areas'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const collegeId = searchParams.get('collegeId')
  const testId = searchParams.get('testId')

  // Scheduled test attempts
  const scheduledAttempts = await prisma.testAttempt.findMany({
    where: {
      isSubmitted: true,
      ...(testId ? { schedule: { testId } } : {}),
      ...(collegeId ? { student: { collegeId } } : {}),
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
    },
    include: {
      student: { include: { college: true } },
      test: true,
    },
    orderBy: { totalScore: 'desc' }
  })

  function mapRow(a: any, testTitle: string, totalMarks: number, mode: string) {
    const s = a.student
    const areas = (a.areaScores as any) || {}
    const violations = (a.violations as any[]) || []
    const tabSwitchCount = violations.filter((v: any) => v.type === 'TAB_SWITCH').length
    const windowBlurCount = violations.filter((v: any) => v.type === 'WINDOW_BLUR').length
    return {
      'Full Name': s?.fullName || '',
      'Email': s?.email || '',
      'College': s?.college?.name || '',
      'Qualification': s?.pgDegree || s?.graduationDegree || '',
      '10th Marks (%)': s?.tenthMarks || '',
      '12th Marks (%)': s?.twelfthMarks || '',
      'Graduation Marks (%)': s?.graduationMarks || '',
      'PG Marks (%)': s?.pgMarks || '',
      'Test': testTitle,
      'Mode': mode,
      // Built from the shared area list rather than one hard-coded column per
      // area, so adding an assessment area does not silently drop its score
      // from every exported report.
      ...Object.fromEntries(AREAS.map(a => [`${AREA_LABELS[a]} Score`, areas[a] || ''])),
      'Total Score': a.totalScore || '',
      'Max Marks': totalMarks,
      'Tab Switches': tabSwitchCount,
      'Window Blurs': windowBlurCount,
      'Total Violations': violations.length,
      'Status': s?.status || '',
      'Submitted At': a.submittedAt ? new Date(a.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '',
    }
  }

  const rows = [
    ...scheduledAttempts.map((a: any) =>
      mapRow(a, a.schedule?.test?.title || '', a.schedule?.test?.totalMarks || 0, 'Scheduled')
    ),
    ...walkInAttempts.map((a: any) =>
      mapRow(a, a.test?.title || '', a.test?.totalMarks || 0, 'Walk-in')
    ),
  ]

  // Sort by total score descending
  rows.sort((a, b) => (Number(b['Total Score']) || 0) - (Number(a['Total Score']) || 0))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Results')
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="results_export.xlsx"',
    }
  })
}
