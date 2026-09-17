import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { sendCredentialsEmail } from '@/lib/email'
import { getLoginUrl } from '@/lib/url'

function generatePassword(length = 10): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const coordinators = await prisma.user.findMany({
    where: { role: 'COLLEGE_COORDINATOR' },
    include: { college: true },
    orderBy: { name: 'asc' }
  })
  return NextResponse.json(coordinators)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const existing = await prisma.user.findUnique({ where: { email: body.email } })
  if (existing) return NextResponse.json({ error: 'Email already in use' }, { status: 400 })

  const rawPassword = generatePassword()
  const hashedPassword = await bcrypt.hash(rawPassword, 12)

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      password: hashedPassword,
      role: 'COLLEGE_COORDINATOR',
      collegeId: body.collegeId,
      mustResetPassword: true,
    }
  })

  const loginUrl = getLoginUrl()
  try {
    await sendCredentialsEmail({
      to: body.email,
      name: body.name,
      email: body.email,
      password: rawPassword,
      loginUrl,
      role: 'College Coordinator',
    })
  } catch (emailErr) {
    console.error('Email send failed:', emailErr)
    // Still return success but note email failed
    return NextResponse.json({ ...user, emailSent: false, tempPassword: rawPassword }, { status: 201 })
  }

  return NextResponse.json({ ...user, emailSent: true }, { status: 201 })
}
