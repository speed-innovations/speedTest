import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const job = await prisma.jobOpening.update({
    where: { id: params.id },
    data: {
      title: body.title, description: body.description, location: body.location,
      openings: body.openings, requiredSkills: body.requiredSkills, niceToHaveSkills: body.niceToHaveSkills,
    }
  })
  return NextResponse.json(job)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const job = await prisma.jobOpening.update({
    where: { id: params.id },
    data: { isActive: body.isActive }
  })
  return NextResponse.json(job)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.jobOpening.update({ where: { id: params.id }, data: { isActive: false } })
  return NextResponse.json({ success: true })
}
