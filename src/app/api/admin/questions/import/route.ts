import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import * as XLSX from 'xlsx'

import { AREAS as VALID_AREAS } from '@/lib/areas'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws) as any[]

    let imported = 0
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const area = (row['Area'] || '').toString().toUpperCase().trim()
      const correctAnswer = (row['Correct Answer'] || '').toString().toUpperCase().trim()

      if (!VALID_AREAS.includes(area)) {
        errors.push(`Row ${i + 2}: Invalid area "${area}"`)
        continue
      }
      if (!['A','B','C','D'].includes(correctAnswer)) {
        errors.push(`Row ${i + 2}: Invalid correct answer "${correctAnswer}"`)
        continue
      }
      if (!row['Question']) {
        errors.push(`Row ${i + 2}: Question text is required`)
        continue
      }

      await prisma.question.create({
        data: {
          area: area as any,
          questionText: row['Question'].toString(),
          optionA: (row['Option A'] || '').toString(),
          optionB: (row['Option B'] || '').toString(),
          optionC: (row['Option C'] || '').toString(),
          optionD: (row['Option D'] || '').toString(),
          correctAnswer,
          weightage: parseFloat(row['Marks'] || '1') || 1,
          difficulty: ['EASY','MEDIUM','HARD'].includes((row['Difficulty']||'').toString().toUpperCase())
            ? row['Difficulty'].toString().toUpperCase()
            : 'MEDIUM',
        }
      })
      imported++
    }

    return NextResponse.json({ imported, errors, total: rows.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
