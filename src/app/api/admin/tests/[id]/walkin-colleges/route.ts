import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const mappings = await prisma.walkInTestCollege.findMany({
    where: { testId: params.id, isActive: true },
    include: {
      college: true,
    },
    orderBy: { createdAt: 'desc' }
  })
  return NextResponse.json(mappings)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { collegeId } = await req.json()

  const existing = await prisma.walkInTestCollege.findUnique({
    where: { testId_collegeId: { testId: params.id, collegeId } }
  })

  if (existing) {
    // Re-enable if soft-deleted
    const updated = await prisma.walkInTestCollege.update({
      where: { id: existing.id },
      data: { isActive: true },
      include: { college: true }
    })
    return NextResponse.json(updated)
  }

  const mapping = await prisma.walkInTestCollege.create({
    data: { testId: params.id, collegeId },
    include: { college: true }
  })
  return NextResponse.json(mapping, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { collegeId } = await req.json()

  await prisma.walkInTestCollege.updateMany({
    where: { testId: params.id, collegeId },
    data: { isActive: false }
  })

  // Also disable all eligible students from this college for this test
  const students = await prisma.studentProfile.findMany({
    where: { collegeId },
    select: { id: true }
  })
  if (students.length > 0) {
    await prisma.walkInEligibleStudent.updateMany({
      where: { testId: params.id, studentId: { in: students.map(s => s.id) } },
      data: { isEnabled: false }
    })
  }

  return NextResponse.json({ success: true })
}
