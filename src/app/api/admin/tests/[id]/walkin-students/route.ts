import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const collegeId = searchParams.get('collegeId')
  if (!collegeId) return NextResponse.json({ error: 'collegeId required' }, { status: 400 })

  // Get all students from this college
  const students = await prisma.studentProfile.findMany({
    where: { collegeId },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, email: true }
  })

  // Get eligibility records for this test
  const eligibleRecords = await prisma.walkInEligibleStudent.findMany({
    where: { testId: params.id, studentId: { in: students.map(s => s.id) } }
  })
  const eligibleMap = new Map(eligibleRecords.map(e => [e.studentId, e.isEnabled]))

  const result = students.map(s => ({
    ...s,
    isEnabled: eligibleMap.get(s.id) || false,
  }))

  return NextResponse.json(result)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { studentId, isEnabled } = await req.json()

  await prisma.walkInEligibleStudent.upsert({
    where: { testId_studentId: { testId: params.id, studentId } },
    create: { testId: params.id, studentId, isEnabled },
    update: { isEnabled }
  })

  return NextResponse.json({ success: true })
}

// Bulk enable/disable students
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { studentIds, isEnabled } = await req.json()

  const upserts = (studentIds as string[]).map(studentId =>
    prisma.walkInEligibleStudent.upsert({
      where: { testId_studentId: { testId: params.id, studentId } },
      create: { testId: params.id, studentId, isEnabled },
      update: { isEnabled }
    })
  )

  await Promise.all(upserts)

  return NextResponse.json({ success: true, count: studentIds.length })
}
