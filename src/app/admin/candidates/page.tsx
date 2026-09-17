'use client'
import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { Search, Upload, Download, User, Mail, KeyRound, Users } from 'lucide-react'

export default function AdminCandidatesPage() {
  const [candidates, setCandidates] = useState<any[]>([])
  const [colleges, setColleges] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCollege, setFilterCollege] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'inactive'>('all')

  // Import state
  const [importing, setImporting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importCollege, setImportCollege] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Password reset
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => {
    load()
    fetch('/api/admin/colleges').then(r => r.json()).then(setColleges)
  }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/candidates')
    setCandidates(await res.json())
    setLoading(false)
  }

  const filtered = candidates.filter(c => {
    if (activeTab === 'active' && !c.userIsActive) return false
    if (activeTab === 'inactive' && c.userIsActive) return false
    if (filterCollege && c.college?.id !== filterCollege) return false
    if (!search) return true
    const q = search.toLowerCase()
    return c.fullName?.toLowerCase().includes(q)
      || c.email?.toLowerCase().includes(q)
      || c.college?.name?.toLowerCase().includes(q)
  })

  const activeCount = candidates.filter(c => c.userIsActive).length
  const inactiveCount = candidates.filter(c => !c.userIsActive).length

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !importCollege) { toast.error('Select a college first'); return }
    setImporting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('collegeId', importCollege)
      const res = await fetch('/api/admin/candidates/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${data.imported} candidates imported!${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`)
        if (data.errors?.length) {
          data.errors.slice(0, 5).forEach((e: string) => toast.error(e, { duration: 5000 }))
        }
        setShowImport(false)
        load()
      } else {
        toast.error(data.error || 'Import failed')
      }
    } catch { toast.error('Import failed') }
    finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleResendEmail(userId: string) {
    try {
      const res = await fetch('/api/admin/resend-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })
      const data = await res.json()
      if (data.emailSent === false && data.tempPassword) {
        toast.success(`Email failed. Temp password: ${data.tempPassword}`, { duration: 10000 })
      } else {
        toast.success('Credentials email sent!')
      }
    } catch { toast.error('Failed to send') }
  }

  async function handleResetPassword() {
    if (!newPassword || newPassword.length < 6) { toast.error('Min 6 characters'); return }
    const res = await fetch(`/api/admin/coordinators/${resetUserId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    })
    if (res.ok) { toast.success('Password reset!'); setResetUserId(null); setNewPassword('') }
    else toast.error('Failed to reset')
  }

  function downloadTemplate() {
    const a = document.createElement('a')
    a.href = '/api/admin/candidates/template'
    a.download = 'candidates_template.xlsx'
    a.click()
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="speed-accent w-10 mb-3" />
          <h1 className="text-2xl font-bold text-gray-800">Candidates</h1>
          <p className="text-gray-500 text-sm">{candidates.length} students</p>
        </div>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className="btn-secondary text-sm py-2 flex items-center gap-1">
            <Download size={14} /> Template
          </button>
          <button onClick={() => setShowImport(true)} className="btn-primary text-sm py-2 flex items-center gap-1">
            <Upload size={14} /> Import Candidates
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {([
          { key: 'all' as const, label: 'All', count: candidates.length, color: 'text-gray-600 border-gray-500' },
          { key: 'active' as const, label: 'Active', count: activeCount, color: 'text-green-600 border-green-500' },
          { key: 'inactive' as const, label: 'Inactive', count: inactiveCount, color: 'text-red-600 border-red-500' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
              activeTab === tab.key ? tab.color : 'text-gray-400 border-transparent hover:text-gray-600'
            }`}>
            {tab.label}
            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === tab.key ? 'bg-gray-100 text-gray-700' : 'bg-gray-50 text-gray-400'
            }`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by name, email, or college..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-52" value={filterCollege} onChange={e => setFilterCollege(e.target.value)}>
          <option value="">All Colleges</option>
          {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="table-header text-left p-4">Candidate</th>
              <th className="table-header text-left p-4">College</th>
              <th className="table-header text-left p-4">Education</th>
              <th className="table-header text-left p-4">12th %</th>
              <th className="table-header text-left p-4">Grad %</th>
              <th className="table-header text-left p-4">Status</th>
              <th className="table-header text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td></tr>
            ) : filtered.map((c: any) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${!c.userIsActive ? 'opacity-60' : ''}`}>
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
                <td className="p-4 text-sm text-gray-500">{c.college?.name || '\u2014'}</td>
                <td className="p-4 text-sm text-gray-500">{c.graduationDegree || c.pgDegree || '\u2014'}</td>
                <td className="p-4 text-sm text-gray-500">{c.twelfthMarks ? `${c.twelfthMarks}%` : '\u2014'}</td>
                <td className="p-4 text-sm text-gray-500">{c.graduationMarks ? `${c.graduationMarks}%` : '\u2014'}</td>
                <td className="p-4">
                  <span className={
                    c.status === 'SHORTLISTED' ? 'badge-green' :
                    c.status === 'APPEARED' ? 'badge-teal' :
                    c.status === 'REJECTED' ? 'badge-red' : 'badge-yellow'
                  }>{c.status}</span>
                </td>
                <td className="p-4">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => handleResendEmail(c.userId)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Resend credentials email">
                      <Mail size={15} />
                    </button>
                    <button onClick={() => { setResetUserId(c.userId); setNewPassword('') }}
                      className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Reset Password">
                      <KeyRound size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">
                {search || filterCollege ? 'No candidates match your filters' : 'No candidates added yet'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Import Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Import Candidates</h2>
            <div className="space-y-4">
              <div>
                <label className="label">College *</label>
                <select className="input" value={importCollege} onChange={e => setImportCollege(e.target.value)} required>
                  <option value="">Select college...</option>
                  {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Excel File *</label>
                <div className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                  importing ? 'border-brand-purple bg-brand-purple/5' : 'border-gray-200 hover:border-brand-purple'
                }`} onClick={() => !importing && importCollege && fileRef.current?.click()}>
                  {importing ? (
                    <div className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5 text-brand-purple" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span className="text-sm text-brand-purple">Importing...</span>
                    </div>
                  ) : (
                    <>
                      <Upload size={20} className="text-gray-300 mx-auto mb-1" />
                      <p className="text-sm text-gray-500">
                        {importCollege ? 'Click to select Excel file' : 'Select a college first'}
                      </p>
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleImport} />
              </div>
              <p className="text-xs text-gray-500 bg-blue-50 p-3 rounded-lg">
                Use the template to format your data. Credentials will be emailed automatically to each student.
              </p>
              <div className="flex gap-3">
                <button onClick={downloadTemplate} className="btn-secondary flex-1 justify-center text-sm">
                  <Download size={14} /> Download Template
                </button>
                <button onClick={() => setShowImport(false)} className="btn-secondary text-sm">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUserId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Reset Student Password</h2>
            <div>
              <label className="label">New Password</label>
              <input className="input" type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleResetPassword} className="btn-primary flex-1 justify-center">Reset</button>
              <button onClick={() => setResetUserId(null)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
