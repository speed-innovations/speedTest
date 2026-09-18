'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { ArrowLeft, Calendar, Clock, CheckSquare, Users, Pencil, Trash2, Zap, Building2, UserCheck, UserX, CheckCheck } from 'lucide-react'
import { AREA_LABELS } from '@/lib/areas'

const statusColor: Record<string, string> = {
  DRAFT: 'badge-yellow', SCHEDULED: 'badge-purple', ACTIVE: 'badge-teal',
  COMPLETED: 'badge-green', CANCELLED: 'badge-red',
}

export default function TestDetailPage() {
  const { id } = useParams()
  const [test, setTest] = useState<any>(null)
  const [schedules, setSchedules] = useState<any[]>([])
  const [editSchedule, setEditSchedule] = useState<any>(null)
  const [editForm, setEditForm] = useState({ collegeId: '', scheduledAt: '', endsAt: '', instructions: '' })
  const [colleges, setColleges] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Walk-in college mapping state
  const [mappedColleges, setMappedColleges] = useState<any[]>([])
  const [addCollegeId, setAddCollegeId] = useState('')
  const [selectedCollege, setSelectedCollege] = useState<any>(null)
  const [students, setStudents] = useState<any[]>([])
  const [loadingStudents, setLoadingStudents] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/tests/${id}`).then(r => r.json()).then(setTest)
    loadSchedules()
    fetch('/api/admin/colleges').then(r => r.json()).then(setColleges)
  }, [id])

  useEffect(() => {
    if (test?.isWalkIn) loadMappedColleges()
  }, [test?.isWalkIn])

  async function loadSchedules() {
    const res = await fetch(`/api/admin/tests/${id}/schedules`)
    setSchedules(await res.json())
  }

  async function loadMappedColleges() {
    const res = await fetch(`/api/admin/tests/${id}/walkin-colleges`)
    setMappedColleges(await res.json())
  }

  async function addCollege() {
    if (!addCollegeId) return
    setLoading(true)
    const res = await fetch(`/api/admin/tests/${id}/walkin-colleges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collegeId: addCollegeId })
    })
    if (res.ok) {
      toast.success('College mapped')
      setAddCollegeId('')
      loadMappedColleges()
    } else toast.error('Failed to add')
    setLoading(false)
  }

  async function removeCollege(collegeId: string) {
    if (!confirm('Remove this college from walk-in test?')) return
    await fetch(`/api/admin/tests/${id}/walkin-colleges`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collegeId })
    })
    toast.success('College removed')
    loadMappedColleges()
    if (selectedCollege?.collegeId === collegeId) {
      setSelectedCollege(null)
      setStudents([])
    }
  }

  async function loadStudents(collegeId: string) {
    setLoadingStudents(true)
    const res = await fetch(`/api/admin/tests/${id}/walkin-students?collegeId=${collegeId}`)
    setStudents(await res.json())
    setLoadingStudents(false)
  }

  function selectCollege(mapping: any) {
    setSelectedCollege(mapping)
    loadStudents(mapping.collegeId)
  }

  async function toggleStudent(studentId: string, currentEnabled: boolean) {
    await fetch(`/api/admin/tests/${id}/walkin-students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, isEnabled: !currentEnabled })
    })
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, isEnabled: !currentEnabled } : s))
  }

  async function enableAll() {
    const ids = students.map(s => s.id)
    await fetch(`/api/admin/tests/${id}/walkin-students`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: ids, isEnabled: true })
    })
    setStudents(prev => prev.map(s => ({ ...s, isEnabled: true })))
    toast.success('All students enabled')
  }

  async function disableAll() {
    const ids = students.map(s => s.id)
    await fetch(`/api/admin/tests/${id}/walkin-students`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentIds: ids, isEnabled: false })
    })
    setStudents(prev => prev.map(s => ({ ...s, isEnabled: false })))
    toast.success('All students disabled')
  }

  // Schedule edit handlers
  function startEditSchedule(s: any) {
    setEditSchedule(s)
    setEditForm({
      collegeId: s.college?.id || s.collegeId,
      scheduledAt: new Date(s.scheduledAt).toISOString().slice(0, 16),
      endsAt: new Date(s.endsAt).toISOString().slice(0, 16),
      instructions: s.instructions || '',
    })
  }

  async function handleUpdateSchedule(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/schedules/${editSchedule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      })
      if (!res.ok) throw new Error('Failed to update')
      toast.success('Schedule updated')
      setEditSchedule(null)
      loadSchedules()
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  async function handleDeleteSchedule(scheduleId: string) {
    if (!confirm('Delete this schedule?')) return
    const res = await fetch(`/api/admin/schedules/${scheduleId}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Schedule deleted'); loadSchedules() }
    else toast.error('Failed to delete')
  }

  if (!test) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-purple border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const config = (test.assessmentConfig as any[]) || []
  const mappedCollegeIds = new Set(mappedColleges.map((m: any) => m.collegeId))
  const unmappedColleges = colleges.filter((c: any) => !mappedCollegeIds.has(c.id))
  const enabledCount = students.filter(s => s.isEnabled).length

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <Link href="/admin/tests" className="text-sm text-gray-500 hover:text-brand-purple flex items-center gap-1 mb-4">
          <ArrowLeft size={15} /> Back to Tests
        </Link>
        <div className="speed-accent w-10 mb-3" />
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-800">{test.title}</h1>
              {test.isWalkIn && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Zap size={10} /> Walk-in
                </span>
              )}
            </div>
            {test.description && <p className="text-gray-500 text-sm mt-1">{test.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className={statusColor[test.status]}>{test.status}</span>
            <Link href={`/admin/tests/${id}/edit`} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1">
              <Pencil size={13} /> Edit
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Test Info */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
            <CheckSquare size={17} className="text-brand-purple" /> Test Details
          </h2>
          <div className="space-y-3">
            {[
              ['Duration', `${test.durationMinutes} minutes`],
              ['Total Marks', test.totalMarks],
              ['Passing Marks', test.passingMarks],
              ['Job Opening', test.jobOpening?.title || '\u2014'],
              ['Mode', test.isWalkIn ? 'Walk-in (Lab)' : 'Scheduled'],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                <span className="text-gray-500">{label}</span>
                <span className="font-medium text-gray-700">{value as any}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Assessment Areas */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4">Assessment Areas</h2>
          <div className="space-y-2">
            {config.map((c: any) => (
              <div key={c.area} className="p-2.5 bg-gray-50 rounded-lg text-sm space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="badge-purple">{AREA_LABELS[c.area] || c.area}</span>
                  <span className="text-gray-600">{c.count} questions</span>
                </div>
                {(c.easyPct != null || c.mediumPct != null || c.hardPct != null) && (
                  <div className="flex gap-2 pl-1">
                    <span className="text-xs text-green-600">Easy {c.easyPct ?? 0}%</span>
                    <span className="text-xs text-yellow-600">Medium {c.mediumPct ?? 0}%</span>
                    <span className="text-xs text-red-600">Hard {c.hardPct ?? 0}%</span>
                  </div>
                )}
                <div className="text-xs text-gray-400 pl-1">Weightage from question bank</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scheduled test: Schedules */}
      {!test.isWalkIn && (
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <Calendar size={17} className="text-brand-purple" /> Schedules
            </h2>
            <Link href={`/admin/tests/${id}/schedule`} className="btn-primary text-sm py-2">
              + Add Schedule
            </Link>
          </div>
          <div className="space-y-3">
            {schedules.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl">
                <div>
                  <p className="font-medium text-sm text-gray-800">{s.college?.name}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1"><Clock size={12} /> {new Date(s.scheduledAt).toLocaleString()}</span>
                    <span>{'\u2192'} {new Date(s.endsAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Users size={13} /> {s._count?.attempts || 0} attempts
                  </div>
                  <span className={s.isActive ? 'badge-green' : 'badge-red'}>{s.isActive ? 'Active' : 'Cancelled'}</span>
                  <button onClick={() => startEditSchedule(s)} className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Edit"><Pencil size={14} /></button>
                  <button onClick={() => handleDeleteSchedule(s.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {schedules.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No schedules created yet</p>}
          </div>
        </div>
      )}

      {/* Walk-in test: College Mapping + Student Eligibility */}
      {test.isWalkIn && (
        <>
          {/* Map Colleges */}
          <div className="card mb-6">
            <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Building2 size={17} className="text-orange-500" /> Mapped Colleges
            </h2>
            <p className="text-xs text-gray-500 mb-4">Only students from mapped colleges can take this walk-in test. Select a college to manage present students.</p>

            <div className="flex gap-2 mb-4">
              <select className="input flex-1" value={addCollegeId} onChange={e => setAddCollegeId(e.target.value)}>
                <option value="">Select college to add...</option>
                {unmappedColleges.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={addCollege} disabled={!addCollegeId || loading} className="btn-primary text-sm px-4">
                Add College
              </button>
            </div>

            <div className="space-y-2">
              {mappedColleges.map((m: any) => (
                <div key={m.id}
                  className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                    selectedCollege?.id === m.id ? 'border-orange-300 bg-orange-50' : 'border-gray-100 hover:border-orange-200'
                  }`}
                  onClick={() => selectCollege(m)}>
                  <div className="flex items-center gap-3">
                    <Building2 size={16} className="text-orange-500" />
                    <span className="text-sm font-medium text-gray-800">{m.college?.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Click to manage students</span>
                    <button onClick={e => { e.stopPropagation(); removeCollege(m.collegeId) }}
                      className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded" title="Remove">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
              {mappedColleges.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">No colleges mapped yet. Add a college above.</p>
              )}
            </div>
          </div>

          {/* Student Eligibility */}
          {selectedCollege && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-700 flex items-center gap-2">
                  <Users size={17} className="text-orange-500" />
                  Students - {selectedCollege.college?.name}
                  <span className="text-xs font-normal text-gray-500">({enabledCount}/{students.length} enabled)</span>
                </h2>
                <div className="flex gap-2">
                  <button onClick={enableAll} className="btn-teal text-xs py-1.5 px-3 flex items-center gap-1">
                    <CheckCheck size={13} /> Enable All
                  </button>
                  <button onClick={disableAll} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1">
                    <UserX size={13} /> Disable All
                  </button>
                </div>
              </div>

              {loadingStudents ? (
                <div className="text-center py-8 text-gray-400">Loading students...</div>
              ) : students.length === 0 ? (
                <div className="text-center py-8 text-gray-400">No students registered in this college</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="table-header text-left p-3">Student</th>
                        <th className="table-header text-left p-3">Email</th>
                        <th className="table-header text-center p-3">Present in Lab</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {students.map((s: any) => (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="p-3 text-sm font-medium text-gray-800">{s.fullName}</td>
                          <td className="p-3 text-sm text-gray-500">{s.email}</td>
                          <td className="p-3 text-center">
                            <button onClick={() => toggleStudent(s.id, s.isEnabled)}
                              className={`inline-flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-full font-medium transition-all ${
                                s.isEnabled
                                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                              }`}>
                              {s.isEnabled ? <><UserCheck size={13} /> Enabled</> : <><UserX size={13} /> Disabled</>}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Edit Schedule Modal */}
      {editSchedule && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">Edit Schedule</h2>
            <form onSubmit={handleUpdateSchedule} className="space-y-4">
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
                <button type="button" onClick={() => setEditSchedule(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
