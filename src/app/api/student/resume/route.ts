import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const studentId = searchParams.get('studentId')

  const role = (session.user as any).role
  let resumeUrl: string | null = null
  let studentName = 'resume'

  if (studentId && (role === 'APP_ADMIN' || role === 'COLLEGE_COORDINATOR')) {
    const profile = await prisma.studentProfile.findUnique({
      where: { id: studentId },
      select: { resumeUrl: true, fullName: true, collegeId: true }
    })

    // A coordinator may only read resumes from their own college. Without this
    // check any coordinator can pull any student's resume across the platform.
    if (role === 'COLLEGE_COORDINATOR') {
      const coordinator = await prisma.user.findUnique({
        where: { email: session.user!.email! },
        select: { collegeId: true }
      })
      if (!coordinator?.collegeId || profile?.collegeId !== coordinator.collegeId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    }

    resumeUrl = profile?.resumeUrl || null
    studentName = profile?.fullName || 'resume'
  } else {
    const user = await prisma.user.findUnique({
      where: { email: session.user!.email! },
      include: { studentProfile: { select: { resumeUrl: true, fullName: true } } }
    })
    resumeUrl = user?.studentProfile?.resumeUrl || null
    studentName = user?.studentProfile?.fullName || 'resume'
  }

  if (!resumeUrl) {
    return NextResponse.json({ error: 'No resume uploaded' }, { status: 404 })
  }

  // Old placeholder URLs like /uploads/filename are invalid
  if (resumeUrl.startsWith('/uploads/')) {
    return NextResponse.json({ error: 'Resume was uploaded with an older version. Please re-upload.' }, { status: 404 })
  }

  // Handle base64 data URL
  if (resumeUrl.startsWith('data:')) {
    const match = resumeUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) return NextResponse.json({ error: 'Invalid resume data' }, { status: 500 })
    const mimeType = match[1]
    const base64Data = match[2]
    const buffer = Buffer.from(base64Data, 'base64')
    const ext = mimeType.includes('pdf') ? 'pdf' : mimeType.includes('word') || mimeType.includes('docx') ? 'docx' : 'doc'
    const safeName = studentName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `inline; filename="${safeName}_resume.${ext}"`,
        'Content-Length': buffer.length.toString(),
      }
    })
  }

  // External URL — redirect
  return NextResponse.redirect(resumeUrl)
}
