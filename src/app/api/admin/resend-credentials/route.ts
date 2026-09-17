import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { sendCredentialsEmail } from '@/lib/email'
import { getLoginUrl } from '@/lib/url'

function generatePassword(length = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Generate new password
  const rawPassword = generatePassword()
  const hashedPassword = await bcrypt.hash(rawPassword, 12)

  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword, mustResetPassword: true }
  })

  const roleName = user.role === 'COLLEGE_COORDINATOR' ? 'College Coordinator' : 'Student'
  const loginUrl = getLoginUrl()

  try {
    await sendCredentialsEmail({
      to: user.email,
      name: user.name,
      email: user.email,
      password: rawPassword,
      loginUrl,
      role: roleName,
    })
    return NextResponse.json({ success: true, emailSent: true })
  } catch (err) {
    console.error('Email send failed:', err)
    return NextResponse.json({ success: true, emailSent: false, tempPassword: rawPassword })
  }
}
