'use client'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Plus, Briefcase, X, Save, Pencil, Search, LayoutGrid, List, MapPin, Users, Power, PowerOff, Trash2 } from 'lucide-react'

export default function JobOpeningsPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editJob, setEditJob] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: '', description: '', location: '', openings: 1,
    requiredSkills: [] as string[], niceToHaveSkills: [] as string[],
  })
  const [skillInput, setSkillInput] = useState('')
  const [niceInput, setNiceInput] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [activeTab, setActiveTab] = useState<'active' | 'inactive' | 'all'>('active')

  useEffect(() => { load() }, [])

  async function load() {
    const res = await fetch('/api/admin/job-openings')
    setJobs(await res.json())
  }

  function openForm(job?: any) {
    if (job) {
      setEditJob(job)
      setForm({
        title: job.title, description: job.description || '', location: job.location || '',
        openings: job.openings, requiredSkills: job.requiredSkills, niceToHaveSkills: job.niceToHaveSkills,
      })
    } else {
      setEditJob(null)
      setForm({ title: '', description: '', location: '', openings: 1, requiredSkills: [], niceToHaveSkills: [] })
    }
    setSkillInput(''); setNiceInput('')
    setShowForm(true)
  }

  function addSkill(type: 'required' | 'nice') {
    const val = type === 'required' ? skillInput.trim() : niceInput.trim()
    if (!val) return
    if (type === 'required') {
      setForm(f => ({ ...f, requiredSkills: [...f.requiredSkills, val] })); setSkillInput('')
    } else {
      setForm(f => ({ ...f, niceToHaveSkills: [...f.niceToHaveSkills, val] })); setNiceInput('')
    }
  }

  function removeSkill(type: 'required' | 'nice', idx: number) {
    if (type === 'required') setForm(f => ({ ...f, requiredSkills: f.requiredSkills.filter((_, i) => i !== idx) }))
    else setForm(f => ({ ...f, niceToHaveSkills: f.niceToHaveSkills.filter((_, i) => i !== idx) }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const url = editJob ? `/api/admin/job-openings/${editJob.id}` : '/api/admin/job-openings'
      const method = editJob ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) throw new Error(await res.text())
      toast.success(editJob ? 'Job updated!' : 'Job opening created!')
      setShowForm(false)
      load()
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  async function handleToggle(jobId: string, isActive: boolean) {
    await fetch(`/api/admin/job-openings/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive })
    })
    toast.success(isActive ? 'Job deactivated' : 'Job reactivated')
    load()
  }

  async function handleDelete(jobId: string, title: string) {
    if (!confirm(`Delete "${title}"?`)) return
    await fetch(`/api/admin/job-openings/${jobId}`, { method: 'DELETE' })
    toast.success('Job deleted')
    load()
  }

  const filtered = jobs.filter(j => {
    if (activeTab === 'active' && !j.isActive) return false
    if (activeTab === 'inactive' && j.isActive) return false
    if (!search) return true
    const q = search.toLowerCase()
    return j.title?.toLowerCase().includes(q)
      || j.location?.toLowerCase().includes(q)
      || j.description?.toLowerCase().includes(q)
      || j.requiredSkills?.some((s: string) => s.toLowerCase().includes(q))
  })

  const activeCount = jobs.filter(j => j.isActive).length
  const inactiveCount = jobs.filter(j => !j.isActive).length

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="speed-accent w-10 mb-3" />
          <h1 className="text-2xl font-bold text-gray-800">Job Openings</h1>
          <p className="text-gray-500 text-sm">{jobs.length} openings</p>
        </div>
        <button onClick={() => openForm()} className="btn-primary">
          <Plus size={16} /> Add Job Opening
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {([
          { key: 'active' as const, label: 'Active', count: activeCount, color: 'text-green-600 border-green-500' },
          { key: 'inactive' as const, label: 'Inactive', count: inactiveCount, color: 'text-red-600 border-red-500' },
          { key: 'all' as const, label: 'All', count: jobs.length, color: 'text-gray-600 border-gray-500' },
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

      {/* Search + View Toggle */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by title, location, skills..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setView('grid')}
            className={`p-2.5 transition-colors ${view === 'grid' ? 'bg-brand-purple text-white' : 'bg-white text-gray-400 hover:bg-gray-50'}`}>
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => setView('list')}
            className={`p-2.5 transition-colors ${view === 'list' ? 'bg-brand-purple text-white' : 'bg-white text-gray-400 hover:bg-gray-50'}`}>
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Grid View */}
      {view === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(job => (
            <div key={job.id} className={`card hover:shadow-md transition-all ${!job.isActive ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-brand-teal/10">
                    <Briefcase size={18} className="text-brand-teal-dark" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-800">{job.title}</h3>
                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                      {job.location && <><MapPin size={10} /> {job.location} &middot;</>} {job.openings} opening{job.openings > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className={job.isActive ? 'badge-green' : 'badge-red'}>{job.isActive ? 'Active' : 'Inactive'}</span>
                  <button onClick={() => openForm(job)} className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Edit">
                    <Pencil size={14} />
                  </button>
                  {job.isActive ? (
                    <button onClick={() => handleToggle(job.id, true)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Deactivate">
                      <PowerOff size={14} />
                    </button>
                  ) : (
                    <button onClick={() => handleToggle(job.id, false)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Reactivate">
                      <Power size={14} />
                    </button>
                  )}
                </div>
              </div>

              {job.description && <p className="text-sm text-gray-500 mt-3 line-clamp-2">{job.description}</p>}

              <div className="mt-4 space-y-2">
                {job.requiredSkills?.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Required Skills</div>
                    <div className="flex flex-wrap gap-1.5">
                      {job.requiredSkills.map((s: string) => <span key={s} className="badge-purple">{s}</span>)}
                    </div>
                  </div>
                )}
                {job.niceToHaveSkills?.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Nice to Have</div>
                    <div className="flex flex-wrap gap-1.5">
                      {job.niceToHaveSkills.map((s: string) => <span key={s} className="bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full">{s}</span>)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="card p-0 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="table-header text-left p-4">Title</th>
                <th className="table-header text-left p-4">Location</th>
                <th className="table-header text-center p-4">Openings</th>
                <th className="table-header text-left p-4">Required Skills</th>
                <th className="table-header text-left p-4">Status</th>
                <th className="table-header text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(job => (
                <tr key={job.id} className={`hover:bg-gray-50 ${!job.isActive ? 'opacity-60' : ''}`}>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Briefcase size={14} className="text-brand-teal-dark flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-800">{job.title}</span>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-gray-500">{job.location || '\u2014'}</td>
                  <td className="p-4 text-center text-sm font-bold text-gray-700">{job.openings}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      {job.requiredSkills?.slice(0, 3).map((s: string) => <span key={s} className="badge-purple text-xs">{s}</span>)}
                      {job.requiredSkills?.length > 3 && <span className="text-xs text-gray-400">+{job.requiredSkills.length - 3}</span>}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={job.isActive ? 'badge-green' : 'badge-red'}>{job.isActive ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openForm(job)} className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Edit">
                        <Pencil size={14} />
                      </button>
                      {job.isActive ? (
                        <button onClick={() => handleToggle(job.id, true)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Deactivate">
                          <PowerOff size={14} />
                        </button>
                      ) : (
                        <button onClick={() => handleToggle(job.id, false)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg" title="Reactivate">
                          <Power size={14} />
                        </button>
                      )}
                      <button onClick={() => handleDelete(job.id, job.title)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">
                  {search ? 'No job openings match your search' : activeTab === 'inactive' ? 'No inactive openings' : 'No job openings yet'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Grid/List empty state */}
      {view === 'grid' && filtered.length === 0 && (
        <div className="card text-center py-16">
          <Briefcase size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">
            {search ? 'No job openings match your search' : activeTab === 'inactive' ? 'No inactive openings' : 'No job openings yet'}
          </p>
          {!search && activeTab !== 'inactive' && (
            <button onClick={() => openForm()} className="btn-primary mt-4 inline-flex">
              <Plus size={16} /> Add First Job Opening
            </button>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-5">{editJob ? 'Edit Job Opening' : 'Add Job Opening'}</h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="label">Job Title *</label>
                <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="e.g. Software Engineer" />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input h-20 resize-none" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Role description..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Location</label>
                  <input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="e.g. Pune, Remote" />
                </div>
                <div>
                  <label className="label">Openings</label>
                  <input className="input" type="number" min={1} value={form.openings} onChange={e => setForm(f => ({ ...f, openings: +e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="label">Required Skills</label>
                <div className="flex gap-2 mb-2">
                  <input className="input flex-1" value={skillInput} onChange={e => setSkillInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill('required') } }}
                    placeholder="Type skill and press Enter" />
                  <button type="button" onClick={() => addSkill('required')} className="btn-primary py-2 px-3">Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.requiredSkills.map((s, i) => (
                    <span key={i} className="badge-purple flex items-center gap-1.5">
                      {s} <button type="button" onClick={() => removeSkill('required', i)}><X size={11} /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Nice to Have Skills</label>
                <div className="flex gap-2 mb-2">
                  <input className="input flex-1" value={niceInput} onChange={e => setNiceInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill('nice') } }}
                    placeholder="Type skill and press Enter" />
                  <button type="button" onClick={() => addSkill('nice')} className="btn-secondary py-2 px-3">Add</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.niceToHaveSkills.map((s, i) => (
                    <span key={i} className="bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5">
                      {s} <button type="button" onClick={() => removeSkill('nice', i)}><X size={11} /></button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
                  <Save size={16} /> {loading ? 'Saving...' : 'Save'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
