import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin, errorResponse } from '@/lib/attempt-auth'
import { parseBody } from '@/lib/proctoring/http'
import { testCreateSchema } from '@/lib/schemas/admin'
import { assertCanEnableProctoring } from '@/lib/proctoring/session'

export async function GET() {
  try {
    await requireAdmin()
    const tests = await prisma.test.findMany({
      where: { isActive: true },
      include: { jobOpening: true },
      orderBy: { createdAt: 'desc' }
    })
    return NextResponse.json(tests)
  } catch (err) {
    return errorResponse(err, 'Tests list error', 'Could not load tests.')
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin()
    const body = await parseBody(req, testCreateSchema)
    assertCanEnableProctoring(body.proctoringEnabled === true, false)

    // Fields are mapped explicitly rather than spreading the parsed body: the
    // status derivation below and the `|| null` coercions are behaviour this
    // route already has, and a validation change must not quietly drop them.
    const test = await prisma.test.create({
      data: {
        title: body.title,
        description: body.description || null,
        durationMinutes: body.durationMinutes,
        totalMarks: body.totalMarks,
        passingMarks: body.passingMarks,
        assessmentConfig: body.assessmentConfig,
        jobOpeningId: body.jobOpeningId || null,
        isWalkIn: body.isWalkIn || false,
        status: body.isWalkIn ? 'ACTIVE' : 'DRAFT',
        // Strict === true, not a truthy check: this flag decides whether a
        // candidate is monitored, so the string "false" must never switch it on.
        proctoringEnabled: body.proctoringEnabled === true,
      }
    })
    return NextResponse.json(test, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'Test create error', 'Could not create the test.')
  }
}
