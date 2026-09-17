import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const students = await prisma.studentProfile.findMany({
    include: {
      college: { select: { id: true, name: true } },
      user: { select: { id: true, isActive: true } }
    },
    orderBy: { fullName: 'asc' }
  })

  return NextResponse.json(students.map(s => ({
    ...s,
    userId: s.user.id,
    userIsActive: s.user.isActive,
  })))
}
