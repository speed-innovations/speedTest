import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { jobOpeningCreateSchema } from '@/lib/schemas/admin'

/**
 * Deliberately unauthenticated, as it already was: the student-facing pages
 * read job openings. Left alone here - widening or narrowing access is not a
 * validation change, and doing it silently inside one would be worse than the
 * status quo.
 */
export async function GET() {
  const jobs = await prisma.jobOpening.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json(jobs)
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await parseBody(req, jobOpeningCreateSchema)
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
  } catch (err) {
    return errorResponse(err, 'Job opening create error', 'Could not create the job opening.')
  }
}
