'use client'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { KeyRound, Search, User, Download } from 'lucide-react'

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [resetId, setResetId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/coordinator/candidates')
    setCandidates(await res.json())
    setLoading(false)
  }

  async function handleReset() {
    if (!newPassword || newPassword.length < 6) { toast.error('Min 6 characters'); return }
    const res = await fetch(`/api/coordinator/candidates/${resetId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    })
    if (res.ok) { toast.success('Password reset!'); setResetId(null); setNewPassword('') }
    else toast.error('Failed')
  }

  const filtered = candidates.filter(c =>
    c.fullName.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="speed-accent w-10 mb-3" />
          <h1 className="text-2xl font-bold text-gray-800">Candidates</h1>
          <p className="text-gray-500 text-sm">{candidates.length} registered students</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by name or email..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="table-header text-left p-4">Candidate</th>
              <th className="table-header text-left p-4">Education</th>
              <th className="table-header text-left p-4">12th %</th>
              <th className="table-header text-left p-4">Grad %</th>
              <th className="table-header text-left p-4">Status</th>
              <th className="table-header text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">Loading...</td></tr>
            ) : filtered.map((c: any) => (
              <tr key={c.id} className="hover:bg-gray-50 group">
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-brand-purple/10 flex items-center justify-center flex-shrink-0">
                      <User size={14} className="text-brand-purple" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-800">{c.fullName}</div>
                      <div className="text-xs text-gray-500">{c.email}</div>
                    </div>
                  </div>
                </td>
                <td className="p-4 text-sm text-gray-500">{c.graduationDegree || c.pgDegree || '—'}</td>
                <td className="p-4 text-sm text-gray-500">{c.twelfthMarks ? `${c.twelfthMarks}%` : '—'}</td>
                <td className="p-4 text-sm text-gray-500">{c.graduationMarks ? `${c.graduationMarks}%` : '—'}</td>
                <td className="p-4">
                  <span className={
                    c.status === 'SHORTLISTED' ? 'badge-green' :
                    c.status === 'APPEARED' ? 'badge-teal' :
                    c.status === 'REJECTED' ? 'badge-red' : 'badge-yellow'
                  }>{c.status}</span>
                </td>
                <td className="p-4">
                  <div className="flex gap-1 justify-end">
                    {c.resumeUrl && (
                      <a href={c.resumeUrl} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg">
                        <Download size={15} />
                      </a>
                    )}
                    <button onClick={() => { setResetId(c.userId); setNewPassword('') }}
                      className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Reset Password">
                      <KeyRound size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">No candidates found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {resetId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Reset Student Password</h2>
            <div>
              <label className="label">New Password</label>
              <input className="input" type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleReset} className="btn-primary flex-1 justify-center">Reset</button>
              <button onClick={() => setResetId(null)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
