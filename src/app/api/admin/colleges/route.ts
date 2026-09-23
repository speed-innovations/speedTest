import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { collegeCreateSchema } from '@/lib/schemas/admin'

export async function GET() {
  try {
    await requireAdmin()
    const colleges = await prisma.college.findMany({
      where: { isActive: true },
      include: { _count: { select: { coordinators: { where: { isActive: true } }, students: true } } },
      orderBy: { name: 'asc' }
    })
    return NextResponse.json(colleges)
  } catch (err) {
    return errorResponse(err, 'Colleges list error', 'Could not load colleges.')
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await parseBody(req, collegeCreateSchema)
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
  } catch (err) {
    return errorResponse(err, 'College create error', 'Could not create the college.')
  }
}
