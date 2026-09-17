import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'
import * as XLSX from 'xlsx'
import { sendCredentialsEmail } from '@/lib/email'
import { getLoginUrl } from '@/lib/url'

function generatePassword(length = 8): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    const collegeId = formData.get('collegeId') as string

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    if (!collegeId) return NextResponse.json({ error: 'College is required' }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws) as any[]

    let imported = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const email = (row['Email'] || '').toString().trim().toLowerCase()
      const fullName = (row['Full Name'] || '').toString().trim()

      if (!email || !fullName) {
        errors.push(`Row ${i + 2}: Full Name and Email are required`)
        continue
      }
      if (!/\S+@\S+\.\S+/.test(email)) {
        errors.push(`Row ${i + 2}: Invalid email "${email}"`)
        continue
      }

      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        errors.push(`Row ${i + 2}: Email "${email}" already exists`)
        continue
      }

      const rawPassword = generatePassword()
      const hashedPassword = await bcrypt.hash(rawPassword, 10)

      const user = await prisma.user.create({
        data: { name: fullName, email, password: hashedPassword, role: 'STUDENT', mustResetPassword: false }
      })

      await prisma.studentProfile.create({
        data: {
          userId: user.id,
          collegeId,
          fullName,
          email,
          phone: (row['Phone'] || '').toString() || null,
          tenthMarks: row['10th Marks (%)'] ? +row['10th Marks (%)'] : null,
          tenthBoard: (row['10th Board'] || '').toString() || null,
          tenthYear: row['10th Year'] ? +row['10th Year'] : null,
          twelfthMarks: row['12th Marks (%)'] ? +row['12th Marks (%)'] : null,
          twelfthBoard: (row['12th Board'] || '').toString() || null,
          twelfthYear: row['12th Year'] ? +row['12th Year'] : null,
          graduationMarks: row['Graduation Marks (%)'] ? +row['Graduation Marks (%)'] : null,
          graduationDegree: (row['Graduation Degree'] || '').toString() || null,
          graduationYear: row['Graduation Year'] ? +row['Graduation Year'] : null,
          pgMarks: row['PG Marks (%)'] ? +row['PG Marks (%)'] : null,
          pgDegree: (row['PG Degree'] || '').toString() || null,
          pgYear: row['PG Year'] ? +row['PG Year'] : null,
        }
      })

      try {
        await sendCredentialsEmail({
          to: email, name: fullName, email, password: rawPassword,
          loginUrl: getLoginUrl(),
          role: 'Student',
        })
      } catch { /* email failure should not block import */ }

      imported++
    }

    return NextResponse.json({ imported, errors, total: rows.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
