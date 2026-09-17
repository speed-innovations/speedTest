'use client'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Plus, KeyRound, User, Mail, Power, PowerOff, Search } from 'lucide-react'

export default function CoordinatorsPage() {
  const [coordinators, setCoordinators] = useState<any[]>([])
  const [colleges, setColleges] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', collegeId: '' })
  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'active' | 'inactive' | 'all'>('active')

  useEffect(() => {
    load()
    fetch('/api/admin/colleges').then(r => r.json()).then(setColleges)
  }, [])

  async function load() {
    const res = await fetch('/api/admin/coordinators')
    setCoordinators(await res.json())
  }

  const filtered = coordinators.filter(c => {
    // Tab filter
    if (activeTab === 'active' && !c.isActive) return false
    if (activeTab === 'inactive' && c.isActive) return false
    // Search filter
    if (!search) return true
    const q = search.toLowerCase()
    return c.name?.toLowerCase().includes(q)
      || c.email?.toLowerCase().includes(q)
      || c.college?.name?.toLowerCase().includes(q)
  })

  const activeCount = coordinators.filter(c => c.isActive).length
  const inactiveCount = coordinators.filter(c => !c.isActive).length

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/admin/coordinators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (data.emailSent === false && data.tempPassword) {
        toast.success(`Coordinator created! Email failed. Temp password: ${data.tempPassword}`, { duration: 10000 })
      } else {
        toast.success('Coordinator created! Credentials sent by email.')
      }
      setShowForm(false)
      setForm({ name: '', email: '', collegeId: '' })
      load()
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  async function handleResetPassword(userId: string) {
    if (!newPassword || newPassword.length < 6) { toast.error('Min 6 characters'); return }
    const res = await fetch(`/api/admin/coordinators/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    })
    if (res.ok) { toast.success('Password reset!'); setResetUserId(null); setNewPassword('') }
    else toast.error('Failed to reset')
  }

  async function handleToggle(userId: string, isActive: boolean) {
    await fetch(`/api/admin/coordinators/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive })
    })
    toast.success(isActive ? 'Coordinator deactivated' : 'Coordinator reactivated')
    load()
  }

  async function handleResendEmail(userId: string) {
    setLoading(true)
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
    finally { setLoading(false) }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="speed-accent w-10 mb-3" />
          <h1 className="text-2xl font-bold text-gray-800">College Coordinators</h1>
          <p className="text-gray-500 text-sm">{coordinators.length} coordinators</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus size={16} /> Add Coordinator
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {([
          { key: 'active' as const, label: 'Active', count: activeCount, color: 'text-green-600 border-green-500' },
          { key: 'inactive' as const, label: 'Inactive', count: inactiveCount, color: 'text-red-600 border-red-500' },
          { key: 'all' as const, label: 'All', count: coordinators.length, color: 'text-gray-600 border-gray-500' },
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

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by name, email, or college..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="table-header text-left p-4">Coordinator</th>
              <th className="table-header text-left p-4">College</th>
              <th className="table-header text-left p-4">Email</th>
              <th className="table-header text-left p-4">Status</th>
              <th className="table-header text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((c: any) => (
              <tr key={c.id} className={`hover:bg-gray-50 ${!c.isActive ? 'opacity-60' : ''}`}>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-brand-purple/10 flex items-center justify-center">
                      <User size={14} className="text-brand-purple" />
                    </div>
                    <span className="text-sm font-medium text-gray-800">{c.name}</span>
                  </div>
                </td>
                <td className="p-4 text-sm text-gray-500">{c.college?.name || '\u2014'}</td>
                <td className="p-4 text-sm text-gray-500">{c.email}</td>
                <td className="p-4">
                  <span className={c.isActive ? 'badge-green' : 'badge-red'}>
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => handleResendEmail(c.id)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Resend credentials email">
                      <Mail size={15} />
                    </button>
                    <button onClick={() => { setResetUserId(c.id); setNewPassword('') }}
                      className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Reset Password">
                      <KeyRound size={15} />
                    </button>
                    {c.isActive ? (
                      <button onClick={() => handleToggle(c.id, true)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Deactivate">
                        <PowerOff size={15} />
                      </button>
                    ) : (
                      <button onClick={() => handleToggle(c.id, false)}
                        className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Reactivate">
                        <Power size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400">
                {search ? 'No coordinators match your search' : activeTab === 'inactive' ? 'No inactive coordinators' : 'No coordinators added yet'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-5">Add Coordinator</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="label">Full Name *</label>
                <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="John Smith" />
              </div>
              <div>
                <label className="label">Email *</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required placeholder="coordinator@college.edu" />
              </div>
              <div>
                <label className="label">College *</label>
                <select className="input" value={form.collegeId} onChange={e => setForm(f => ({ ...f, collegeId: e.target.value }))} required>
                  <option value="">Select college...</option>
                  {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <p className="text-xs text-gray-500 bg-blue-50 p-3 rounded-lg">
                Credentials will be sent automatically to the coordinator's email.
              </p>
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
                  {loading ? 'Creating...' : 'Create & Send Credentials'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetUserId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Reset Password</h2>
            <div>
              <label className="label">New Password</label>
              <input className="input" type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => handleResetPassword(resetUserId)} className="btn-primary flex-1 justify-center">Reset</button>
              <button onClick={() => setResetUserId(null)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
