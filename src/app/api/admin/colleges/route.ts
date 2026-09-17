import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const colleges = await prisma.college.findMany({
    where: { isActive: true },
    include: { _count: { select: { coordinators: { where: { isActive: true } }, students: true } } },
    orderBy: { name: 'asc' }
  })
  return NextResponse.json(colleges)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json()
  const college = await prisma.college.create({
    data: {
      name: body.name,
      address: body.address || null,
      city: body.city || null,
      state: body.state || null,
      contactEmail: body.contactEmail || null,
      contactPhone: body.contactPhone || null,
      isActive: body.isActive ?? true,
    }
  })
  return NextResponse.json(college, { status: 201 })
}
