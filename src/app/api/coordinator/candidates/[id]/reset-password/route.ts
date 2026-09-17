import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'COLLEGE_COORDINATOR')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.password || body.password.length < 6)
    return NextResponse.json({ error: 'Min 6 characters' }, { status: 400 })

  // Verify the target user is a student from this coordinator's college
  const coordinator = await prisma.user.findUnique({ where: { email: session.user!.email! } })
  const targetUser = await prisma.user.findUnique({
    where: { id: params.id },
    include: { studentProfile: true }
  })

  if (!targetUser || targetUser.role !== 'STUDENT')
    return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (targetUser.studentProfile?.collegeId !== coordinator?.collegeId)
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const hashed = await bcrypt.hash(body.password, 12)
  await prisma.user.update({ where: { id: params.id }, data: { password: hashed } })
  return NextResponse.json({ success: true })
}
