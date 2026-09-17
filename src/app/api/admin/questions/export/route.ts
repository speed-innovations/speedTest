import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import * as XLSX from 'xlsx'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'APP_ADMIN')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const questions = await prisma.question.findMany({ where: { isActive: true } })

  const rows = questions.map(q => ({
    Area: q.area,
    Question: q.questionText,
    'Option A': q.optionA,
    'Option B': q.optionB,
    'Option C': q.optionC,
    'Option D': q.optionD,
    'Correct Answer': q.correctAnswer,
    Marks: q.weightage,
    Difficulty: q.difficulty,
  }))

  // Add template row if empty
  if (rows.length === 0) {
    rows.push({
      Area: 'APTITUDE',
      Question: 'Sample question?',
      'Option A': 'Option 1',
      'Option B': 'Option 2',
      'Option C': 'Option 3',
      'Option D': 'Option 4',
      'Correct Answer': 'A',
      Marks: 1,
      Difficulty: 'MEDIUM',
    })
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Questions')

  // Add instruction sheet
  const instrRows = [
    { Field: 'Area', Values: 'APTITUDE, DOTNET, COMMUNICATION, AI, PYTHON, JAVA, JAVASCRIPT, SQL' },
    { Field: 'Correct Answer', Values: 'A, B, C, or D' },
    { Field: 'Difficulty', Values: 'EASY, MEDIUM, or HARD' },
    { Field: 'Marks', Values: 'Numeric value e.g. 1, 2, 0.5' },
  ]
  const wsInstr = XLSX.utils.json_to_sheet(instrRows)
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="questions_export.xlsx"',
    }
  })
}
