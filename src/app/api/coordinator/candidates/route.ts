import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'COLLEGE_COORDINATOR')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const coordinator = await prisma.user.findUnique({ where: { email: session.user!.email! } })
  if (!coordinator?.collegeId)
    return NextResponse.json([])

  const students = await prisma.studentProfile.findMany({
    where: { collegeId: coordinator.collegeId },
    include: { user: { select: { id: true } } },
    orderBy: { fullName: 'asc' }
  })

  return NextResponse.json(students.map(s => ({ ...s, userId: s.user.id })))
}
