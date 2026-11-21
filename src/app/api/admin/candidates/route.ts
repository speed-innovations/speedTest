import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Every column except resumeUrl. Resumes are stored inline as base64 data
  // URLs, so returning them made this list ~20 MB for ~200 students and the
  // Candidates page never finished loading - which also hid the "Resend
  // credentials" button. The page does not show resumes; hasResume is enough.
  const students = await prisma.studentProfile.findMany({
    select: {
      id: true, userId: true, collegeId: true,
      fullName: true, email: true, phone: true, dateOfBirth: true, gender: true,
      tenthMarks: true, tenthBoard: true, tenthYear: true,
      twelfthMarks: true, twelfthBoard: true, twelfthYear: true,
      graduationMarks: true, graduationDegree: true, graduationYear: true,
      pgMarks: true, pgDegree: true, pgYear: true,
      certifications: true, status: true, createdAt: true, updatedAt: true,
      college: { select: { id: true, name: true } },
      user: { select: { id: true, isActive: true } },
    },
    orderBy: { fullName: 'asc' },
  })

  const withResume = await prisma.studentProfile.findMany({
    where: { resumeUrl: { not: null } },
    select: { id: true },
  })
  const hasResume = new Set(withResume.map(s => s.id))

  return NextResponse.json(students.map(s => ({
    ...s,
    userId: s.user.id,
    userIsActive: s.user.isActive,
    hasResume: hasResume.has(s.id),
  })))
}
