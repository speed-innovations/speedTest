'use client'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { Mail } from 'lucide-react'

interface Student {
  id: string
  userId: string
  fullName: string
  email: string
  status: string
  graduationDegree: string | null
}

const statusColor: Record<string, string> = {
  REGISTERED: 'badge-yellow',
  APPEARED: 'badge-purple',
  SHORTLISTED: 'badge-green',
  REJECTED: 'badge-red',
}

export default function StudentTable({ students }: { students: Student[] }) {
  const [sending, setSending] = useState<string | null>(null)

  async function handleResendEmail(userId: string) {
    setSending(userId)
    try {
      const res = await fetch('/api/admin/resend-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })
      const data = await res.json()
      if (data.emailSent === false && data.tempPassword) {
        toast.success(`Email failed. New temp password: ${data.tempPassword}`, { duration: 10000 })
      } else {
        toast.success('Credentials email sent!')
      }
    } catch { toast.error('Failed to send') }
    finally { setSending(null) }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr>
            <th className="table-header text-left p-3">Name</th>
            <th className="table-header text-left p-3">Email</th>
            <th className="table-header text-left p-3">Qualification</th>
            <th className="table-header text-left p-3">Status</th>
            <th className="table-header text-right p-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {students.map(s => (
            <tr key={s.id} className="hover:bg-gray-50">
              <td className="p-3 text-sm font-medium text-gray-800">{s.fullName}</td>
              <td className="p-3 text-sm text-gray-500">{s.email}</td>
              <td className="p-3 text-sm text-gray-500">{s.graduationDegree || '\u2014'}</td>
              <td className="p-3">
                <span className={statusColor[s.status] || 'badge-yellow'}>{s.status}</span>
              </td>
              <td className="p-3">
                <div className="flex justify-end">
                  <button onClick={() => handleResendEmail(s.userId)}
                    disabled={sending === s.userId}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                    title="Resend credentials email">
                    {sending === s.userId ? (
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <Mail size={15} />
                    )}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
