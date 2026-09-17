import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const jobs = await prisma.jobOpening.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(jobs)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const job = await prisma.jobOpening.create({
    data: {
      title: body.title,
      description: body.description || null,
      location: body.location || null,
      openings: body.openings || 1,
      requiredSkills: body.requiredSkills || [],
      niceToHaveSkills: body.niceToHaveSkills || [],
    }
  })
  return NextResponse.json(job, { status: 201 })
}
