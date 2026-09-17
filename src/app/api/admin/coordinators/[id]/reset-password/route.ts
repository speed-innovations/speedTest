import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  if (!body.password || body.password.length < 6)
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })

  const hashed = await bcrypt.hash(body.password, 12)
  await prisma.user.update({
    where: { id: params.id },
    data: { password: hashed, mustResetPassword: true }
  })
  return NextResponse.json({ success: true })
}
