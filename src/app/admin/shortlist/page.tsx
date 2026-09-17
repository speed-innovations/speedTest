'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Plus, Filter, Save, CheckCircle, XCircle, Pencil, Trash2, ExternalLink, Users } from 'lucide-react'

const AREAS = ['APTITUDE','DOTNET','COMMUNICATION','AI','PYTHON','JAVA','JAVASCRIPT','SQL']
const AREA_LABELS: Record<string,string> = {
  APTITUDE:'Aptitude', DOTNET:'.NET', COMMUNICATION:'Communication',
  AI:'AI', PYTHON:'Python', JAVA:'Java', JAVASCRIPT:'JavaScript', SQL:'SQL'
}

const emptyForm = {
  name: '', testId: '',
  minTotalScore: '', minTenthMarks: '', minTwelfthMarks: '', minGradMarks: '',
  minAreaScores: {} as Record<string,string>,
}

export default function ShortlistPage() {
  const router = useRouter()
  const [tests, setTests] = useState<any[]>([])
  const [criteriaList, setCriteriaList] = useState<any[]>([])
  const [candidates, setCandidates] = useState<any[]>([])
  const [appliedCriteria, setAppliedCriteria] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ ...emptyForm })
  const [editId, setEditId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/tests').then(r=>r.json()).then(setTests)
    loadCriteria()
  }, [])

  async function loadCriteria() {
    const res = await fetch('/api/admin/shortlist')
    setCriteriaList(await res.json())
  }

  function startEdit(c: any) {
    setEditId(c.id)
    const areaScores: Record<string,string> = {}
    if (c.minAreaScores) {
      Object.entries(c.minAreaScores).forEach(([k,v]) => { areaScores[k] = String(v) })
    }
    setForm({
      name: c.name,
      testId: c.testId || '',
      minTotalScore: c.minTotalScore != null ? String(c.minTotalScore) : '',
      minTenthMarks: c.minTenthMarks != null ? String(c.minTenthMarks) : '',
      minTwelfthMarks: c.minTwelfthMarks != null ? String(c.minTwelfthMarks) : '',
      minGradMarks: c.minGradMarks != null ? String(c.minGradMarks) : '',
      minAreaScores: areaScores,
    })
  }

  function cancelEdit() {
    setEditId(null)
    setForm({ ...emptyForm })
  }

  async function saveCriteria(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const minAreaScores: Record<string,number> = {}
      Object.entries(form.minAreaScores).forEach(([k,v]) => { if (v) minAreaScores[k] = +v })

      const payload = {
        name: form.name,
        testId: form.testId || null,
        minTotalScore: form.minTotalScore ? +form.minTotalScore : null,
        minTenthMarks: form.minTenthMarks ? +form.minTenthMarks : null,
        minTwelfthMarks: form.minTwelfthMarks ? +form.minTwelfthMarks : null,
        minGradMarks: form.minGradMarks ? +form.minGradMarks : null,
        minAreaScores: Object.keys(minAreaScores).length ? minAreaScores : null,
      }

      const url = editId ? `/api/admin/shortlist/${editId}` : '/api/admin/shortlist'
      const method = editId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success(editId ? 'Criteria updated!' : 'Criteria saved!')
      cancelEdit()
      loadCriteria()
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  async function deleteCriteria(criteriaId: string) {
    if (!confirm('Delete this criteria?')) return
    const res = await fetch(`/api/admin/shortlist/${criteriaId}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Criteria deleted'); loadCriteria() }
    else toast.error('Failed to delete')
  }

  async function applyCriteria(criteria: any) {
    setLoading(true)
    setAppliedCriteria(criteria)
    const res = await fetch(`/api/admin/shortlist/${criteria.id}/apply`, { method: 'POST' })
    const data = await res.json()
    setCandidates(data.results || [])
    toast.success(`${data.shortlisted} of ${data.total} candidates shortlisted!`)
    setLoading(false)

    // Scroll to results
    setTimeout(() => {
      document.getElementById('shortlist-results')?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
  }

  function getTestName(testId: string | null) {
    if (!testId) return 'All Tests'
    return tests.find(t => t.id === testId)?.title || testId
  }

  const shortlisted = candidates.filter(c => c.passes)
  const notQualified = candidates.filter(c => !c.passes)

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">Shortlist Criteria</h1>
        <p className="text-gray-500 text-sm">Define criteria to filter and shortlist candidates</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create/Edit Criteria */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 mb-4 flex items-center gap-2">
            {editId ? <Pencil size={18} className="text-brand-purple" /> : <Plus size={18} className="text-brand-purple" />}
            {editId ? 'Edit Criteria' : 'Create Criteria'}
          </h2>
          <form onSubmit={saveCriteria} className="space-y-4">
            <div>
              <label className="label">Criteria Name *</label>
              <input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required placeholder="e.g. Shortlist Round 1" />
            </div>
            <div>
              <label className="label">Apply for Test</label>
              <select className="input" value={form.testId} onChange={e=>setForm(f=>({...f,testId:e.target.value}))}>
                <option value="">All Tests</option>
                {tests.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Min Total Score</label>
                <input className="input" type="number" placeholder="e.g. 60" value={form.minTotalScore} onChange={e=>setForm(f=>({...f,minTotalScore:e.target.value}))} />
              </div>
              <div>
                <label className="label">Min 10th Marks %</label>
                <input className="input" type="number" placeholder="e.g. 60" value={form.minTenthMarks} onChange={e=>setForm(f=>({...f,minTenthMarks:e.target.value}))} />
              </div>
              <div>
                <label className="label">Min 12th Marks %</label>
                <input className="input" type="number" placeholder="e.g. 60" value={form.minTwelfthMarks} onChange={e=>setForm(f=>({...f,minTwelfthMarks:e.target.value}))} />
              </div>
              <div>
                <label className="label">Min Grad Marks %</label>
                <input className="input" type="number" placeholder="e.g. 60" value={form.minGradMarks} onChange={e=>setForm(f=>({...f,minGradMarks:e.target.value}))} />
              </div>
            </div>

            <div>
              <label className="label">Min Score by Assessment Area</label>
              <div className="grid grid-cols-2 gap-2">
                {AREAS.map(area => (
                  <div key={area} className="flex items-center gap-2">
                    <label className="text-xs text-gray-600 w-24 flex-shrink-0">{AREA_LABELS[area]}</label>
                    <input className="input text-sm py-1.5" type="number" placeholder="Min"
                      value={form.minAreaScores[area] || ''}
                      onChange={e=>setForm(f=>({...f,minAreaScores:{...f.minAreaScores,[area]:e.target.value}}))} />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
                <Save size={16}/> {loading ? 'Saving...' : editId ? 'Update Criteria' : 'Save Criteria'}
              </button>
              {editId && (
                <button type="button" onClick={cancelEdit} className="btn-secondary">Cancel</button>
              )}
            </div>
          </form>
        </div>

        {/* Saved Criteria List */}
        <div className="space-y-4">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2">
            <Filter size={18} className="text-brand-purple" /> Saved Criteria
          </h2>
          {criteriaList.map((c:any) => (
            <div key={c.id} className={`card transition-all ${appliedCriteria?.id === c.id ? 'border-2 border-brand-purple' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800">{c.name}</h3>
                  {c.testId && (
                    <p className="text-xs text-gray-500 mt-0.5">Test: {getTestName(c.testId)}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                    {c.minTotalScore != null && <span className="bg-gray-100 px-2 py-0.5 rounded">Score &ge; {c.minTotalScore}</span>}
                    {c.minTenthMarks != null && <span className="bg-gray-100 px-2 py-0.5 rounded">10th &ge; {c.minTenthMarks}%</span>}
                    {c.minTwelfthMarks != null && <span className="bg-gray-100 px-2 py-0.5 rounded">12th &ge; {c.minTwelfthMarks}%</span>}
                    {c.minGradMarks != null && <span className="bg-gray-100 px-2 py-0.5 rounded">Grad &ge; {c.minGradMarks}%</span>}
                    {c.minAreaScores && Object.entries(c.minAreaScores).map(([area, score]: any) => (
                      <span key={area} className="bg-purple-50 text-purple-600 px-2 py-0.5 rounded">{AREA_LABELS[area] || area} &ge; {score}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => applyCriteria(c)} disabled={loading}
                    className="btn-teal text-xs py-1.5 px-3 flex items-center gap-1">
                    <Users size={12} /> Apply & View
                  </button>
                  <button onClick={() => startEdit(c)}
                    className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Edit">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => deleteCriteria(c.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {criteriaList.length === 0 && (
            <div className="card text-center py-8 text-gray-400">No criteria saved yet</div>
          )}
        </div>
      </div>

      {/* Results after applying */}
      {candidates.length > 0 && appliedCriteria && (
        <div id="shortlist-results" className="mt-6 space-y-4">
          {/* Summary bar */}
          <div className="card bg-brand-purple/5 border-brand-purple/20">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                  <Filter size={17} className="text-brand-purple" />
                  Results: {appliedCriteria.name}
                </h2>
                <div className="flex gap-4 mt-1 text-sm">
                  <span className="text-green-600 font-medium">{shortlisted.length} shortlisted</span>
                  <span className="text-red-500">{notQualified.length} not qualified</span>
                  <span className="text-gray-500">{candidates.length} total evaluated</span>
                </div>
              </div>
              <button onClick={() => router.push(`/admin/results`)}
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
                <ExternalLink size={13} /> Full Results Page
              </button>
            </div>
          </div>

          {/* Shortlisted candidates */}
          {shortlisted.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-green-700 mb-3 flex items-center gap-2">
                <CheckCircle size={16} /> Shortlisted ({shortlisted.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-green-50 border-b border-green-100">
                    <tr>
                      <th className="table-header text-left p-3">#</th>
                      <th className="table-header text-left p-3">Name</th>
                      <th className="table-header text-left p-3">College</th>
                      <th className="table-header text-left p-3">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {shortlisted.map((c:any, i: number) => (
                      <tr key={c.studentId} className="hover:bg-green-50/50">
                        <td className="p-3 text-sm text-gray-400">{i + 1}</td>
                        <td className="p-3 text-sm font-medium text-gray-800">{c.fullName}</td>
                        <td className="p-3 text-sm text-gray-500">{c.college}</td>
                        <td className="p-3 text-sm font-bold text-brand-purple">{c.totalScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Not qualified */}
          {notQualified.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-red-600 mb-3 flex items-center gap-2">
                <XCircle size={16} /> Not Qualified ({notQualified.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-red-50 border-b border-red-100">
                    <tr>
                      <th className="table-header text-left p-3">#</th>
                      <th className="table-header text-left p-3">Name</th>
                      <th className="table-header text-left p-3">College</th>
                      <th className="table-header text-left p-3">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {notQualified.map((c:any, i: number) => (
                      <tr key={c.studentId} className="hover:bg-red-50/50">
                        <td className="p-3 text-sm text-gray-400">{i + 1}</td>
                        <td className="p-3 text-sm font-medium text-gray-800">{c.fullName}</td>
                        <td className="p-3 text-sm text-gray-500">{c.college}</td>
                        <td className="p-3 text-sm text-gray-600">{c.totalScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
