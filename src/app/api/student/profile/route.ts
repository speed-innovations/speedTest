import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { email: session.user!.email! },
    include: { studentProfile: { include: { college: true } } }
  })

  if (!user?.studentProfile)
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  return NextResponse.json(user.studentProfile)
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'STUDENT')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const data = JSON.parse(formData.get('data') as string)
    const resumeFile = formData.get('resume') as File | null

    const user = await prisma.user.findUnique({
      where: { email: session.user!.email! },
      include: { studentProfile: true }
    })
    if (!user?.studentProfile)
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

    let resumeUrl = user.studentProfile.resumeUrl

    // Handle resume upload — store as base64 data URL in DB
    if (resumeFile && resumeFile.size > 0) {
      const maxSize = 5 * 1024 * 1024 // 5MB limit
      if (resumeFile.size > maxSize) {
        return NextResponse.json({ error: 'Resume file too large. Max 5MB.' }, { status: 400 })
      }
      const bytes = await resumeFile.arrayBuffer()
      const base64 = Buffer.from(bytes).toString('base64')
      resumeUrl = `data:${resumeFile.type};base64,${base64}`
    }

    const updated = await prisma.studentProfile.update({
      where: { id: user.studentProfile.id },
      data: {
        fullName: data.fullName,
        phone: data.phone || null,
        gender: data.gender || null,
        tenthMarks: data.tenthMarks ? +data.tenthMarks : null,
        tenthBoard: data.tenthBoard || null,
        tenthYear: data.tenthYear ? +data.tenthYear : null,
        twelfthMarks: data.twelfthMarks ? +data.twelfthMarks : null,
        twelfthBoard: data.twelfthBoard || null,
        twelfthYear: data.twelfthYear ? +data.twelfthYear : null,
        graduationMarks: data.graduationMarks ? +data.graduationMarks : null,
        graduationDegree: data.graduationDegree || null,
        graduationYear: data.graduationYear ? +data.graduationYear : null,
        pgMarks: data.pgMarks ? +data.pgMarks : null,
        pgDegree: data.pgDegree || null,
        pgYear: data.pgYear ? +data.pgYear : null,
        certifications: data.certifications || [],
        resumeUrl,
      }
    })

    return NextResponse.json(updated)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
