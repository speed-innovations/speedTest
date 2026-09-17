import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const college = await prisma.college.update({
    where: { id: params.id },
    data: { name: body.name, address: body.address, city: body.city, state: body.state, contactEmail: body.contactEmail, contactPhone: body.contactPhone, isActive: body.isActive }
  })
  return NextResponse.json(college)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.college.update({ where: { id: params.id }, data: { isActive: false } })
  return NextResponse.json({ success: true })
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const college = await prisma.college.findUnique({ where: { id: params.id } })
  return NextResponse.json(college)
}
