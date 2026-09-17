'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Calendar, Plus, ArrowLeft, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'

export default function ScheduleTestPage() {
  const { id } = useParams()
  const router = useRouter()
  const [test, setTest] = useState<any>(null)
  const [colleges, setColleges] = useState<any[]>([])
  const [schedules, setSchedules] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    collegeId: '', scheduledAt: '', endsAt: '', instructions: ''
  })
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    collegeId: '', scheduledAt: '', endsAt: '', instructions: ''
  })

  useEffect(() => {
    fetch(`/api/admin/tests/${id}`).then(r => r.json()).then(setTest)
    fetch('/api/admin/colleges').then(r => r.json()).then(setColleges)
    loadSchedules()
  }, [id])

  async function loadSchedules() {
    const res = await fetch(`/api/admin/tests/${id}/schedules`)
    setSchedules(await res.json())
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/tests/${id}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success('Schedule created!')
      loadSchedules()
      setForm({ collegeId: '', scheduledAt: '', endsAt: '', instructions: '' })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  function startEdit(s: any) {
    setEditId(s.id)
    setEditForm({
      collegeId: s.college?.id || s.collegeId,
      scheduledAt: new Date(s.scheduledAt).toISOString().slice(0, 16),
      endsAt: new Date(s.endsAt).toISOString().slice(0, 16),
      instructions: s.instructions || '',
    })
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/schedules/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success('Schedule updated!')
      setEditId(null)
      loadSchedules()
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  async function handleDelete(scheduleId: string) {
    if (!confirm('Delete this schedule?')) return
    const res = await fetch(`/api/admin/schedules/${scheduleId}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Schedule deleted'); loadSchedules() }
    else toast.error('Failed to delete')
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <Link href="/admin/tests" className="text-sm text-gray-500 hover:text-brand-purple flex items-center gap-1 mb-4">
          <ArrowLeft size={15} /> Back to Tests
        </Link>
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">Schedule: {test?.title}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Add Schedule Form */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <Plus size={18} className="text-brand-purple" /> Add Schedule
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">College *</label>
              <select className="input" value={form.collegeId} onChange={e => setForm(f => ({ ...f, collegeId: e.target.value }))} required>
                <option value="">Select college...</option>
                {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Start Date & Time *</label>
              <input className="input" type="datetime-local" value={form.scheduledAt}
                onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))} required />
            </div>
            <div>
              <label className="label">End Date & Time *</label>
              <input className="input" type="datetime-local" value={form.endsAt}
                onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Instructions</label>
              <textarea className="input h-20 resize-none" value={form.instructions}
                onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                placeholder="Special instructions for candidates..." />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              <Calendar size={16} /> {loading ? 'Scheduling...' : 'Schedule Test'}
            </button>
          </form>
        </div>

        {/* Existing Schedules */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4">Existing Schedules</h2>
          <div className="space-y-3">
            {schedules.map((s: any) => (
              <div key={s.id} className="p-3 border border-gray-100 rounded-lg">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-medium text-sm text-gray-800">{s.college?.name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(s.scheduledAt).toLocaleString()} &ndash; {new Date(s.endsAt).toLocaleString()}
                    </div>
                    {s.instructions && (
                      <div className="text-xs text-gray-400 mt-1 italic">{s.instructions}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={s.isActive ? 'badge-green' : 'badge-red'}>
                      {s.isActive ? 'Active' : 'Cancelled'}
                    </span>
                    <button onClick={() => startEdit(s)}
                      className="p-1 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded" title="Edit">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => handleDelete(s.id)}
                      className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {schedules.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-8">No schedules yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Edit Schedule Modal */}
      {editId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Edit Schedule</h2>
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="label">College</label>
                <select className="input" value={editForm.collegeId} onChange={e => setEditForm(f => ({ ...f, collegeId: e.target.value }))} required>
                  <option value="">Select college...</option>
                  {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Start Date & Time</label>
                <input className="input" type="datetime-local" value={editForm.scheduledAt}
                  onChange={e => setEditForm(f => ({ ...f, scheduledAt: e.target.value }))} required />
              </div>
              <div>
                <label className="label">End Date & Time</label>
                <input className="input" type="datetime-local" value={editForm.endsAt}
                  onChange={e => setEditForm(f => ({ ...f, endsAt: e.target.value }))} required />
              </div>
              <div>
                <label className="label">Instructions</label>
                <textarea className="input h-20 resize-none" value={editForm.instructions}
                  onChange={e => setEditForm(f => ({ ...f, instructions: e.target.value }))} />
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
                <button type="button" onClick={() => setEditId(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
