import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function GET() {
  const headers = [
    'Full Name', 'Email', 'Phone',
    '10th Marks (%)', '10th Board', '10th Year',
    '12th Marks (%)', '12th Board', '12th Year',
    'Graduation Marks (%)', 'Graduation Degree', 'Graduation Year',
    'PG Marks (%)', 'PG Degree', 'PG Year',
  ]

  const sampleRow = {
    'Full Name': 'Rahul Sharma',
    'Email': 'rahul.sharma@example.com',
    'Phone': '9876543210',
    '10th Marks (%)': 85,
    '10th Board': 'CBSE',
    '10th Year': 2018,
    '12th Marks (%)': 78,
    '12th Board': 'CBSE',
    '12th Year': 2020,
    'Graduation Marks (%)': 72,
    'Graduation Degree': 'B.Tech Computer Science',
    'Graduation Year': 2024,
    'PG Marks (%)': '',
    'PG Degree': '',
    'PG Year': '',
  }

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet([sampleRow])
  XLSX.utils.book_append_sheet(wb, ws, 'Candidates')

  // Instructions sheet
  const instrRows = [
    { Field: 'Full Name', Required: 'Yes', Notes: 'Student full name' },
    { Field: 'Email', Required: 'Yes', Notes: 'Unique email for login' },
    { Field: 'Phone', Required: 'No', Notes: '10-digit mobile number' },
    { Field: '10th Marks (%)', Required: 'No', Notes: 'e.g. 85.5' },
    { Field: '12th Marks (%)', Required: 'No', Notes: 'e.g. 78.2' },
    { Field: 'Graduation Marks (%)', Required: 'No', Notes: 'e.g. 72.0 (CGPA * 10)' },
    { Field: 'Graduation Degree', Required: 'No', Notes: 'e.g. B.Tech Computer Science' },
    { Field: 'PG Marks (%)', Required: 'No', Notes: 'Leave blank if not applicable' },
  ]
  const wsInstr = XLSX.utils.json_to_sheet(instrRows)
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions')

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="candidates_template.xlsx"',
    }
  })
}
