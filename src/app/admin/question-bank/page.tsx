'use client'
import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { Plus, Upload, Download, Search, Pencil, Trash2, Eye } from 'lucide-react'

const AREAS = ['APTITUDE','DOTNET','COMMUNICATION','AI','PYTHON','JAVA','JAVASCRIPT','SQL']
const AREA_LABELS: Record<string, string> = {
  APTITUDE:'Aptitude', DOTNET:'.NET', COMMUNICATION:'Communication',
  AI:'AI', PYTHON:'Python', JAVA:'Java', JAVASCRIPT:'JavaScript', SQL:'SQL'
}

interface Question {
  id: string; area: string; questionText: string;
  optionA: string; optionB: string; optionC: string; optionD: string;
  correctAnswer: string; weightage: number; difficulty: string;
}

const emptyQ = (): Omit<Question,'id'> => ({
  area:'APTITUDE', questionText:'', optionA:'', optionB:'', optionC:'', optionD:'',
  correctAnswer:'A', weightage:1, difficulty:'MEDIUM'
})

export default function QuestionBankPage() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [filter, setFilter] = useState({ area: '', search: '', difficulty: '' })
  const [showForm, setShowForm] = useState(false)
  const [editQ, setEditQ] = useState<Question | null>(null)
  const [form, setForm] = useState(emptyQ())
  const [preview, setPreview] = useState<Question | null>(null)
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadQuestions() }, [filter])

  async function loadQuestions() {
    const params = new URLSearchParams()
    if (filter.area) params.set('area', filter.area)
    if (filter.search) params.set('search', filter.search)
    if (filter.difficulty) params.set('difficulty', filter.difficulty)
    const res = await fetch(`/api/admin/questions?${params}`)
    const data = await res.json()
    setQuestions(data)
  }

  async function handleSave() {
    setLoading(true)
    try {
      const url = editQ ? `/api/admin/questions/${editQ.id}` : '/api/admin/questions'
      const method = editQ ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) throw new Error(await res.text())
      toast.success(editQ ? 'Question updated!' : 'Question added!')
      setShowForm(false); setEditQ(null); setForm(emptyQ())
      loadQuestions()
    } catch (err: any) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this question?')) return
    await fetch(`/api/admin/questions/${id}`, { method: 'DELETE' })
    toast.success('Deleted'); loadQuestions()
  }

  async function handleExport() {
    const res = await fetch('/api/admin/questions/export')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'questions.xlsx'; a.click()
  }

  const [importing, setImporting] = useState(false)

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setImporting(true)
    try {
      const formData = new FormData(); formData.append('file', file)
      const res = await fetch('/api/admin/questions/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        toast.success(`${data.imported} questions imported!${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`)
        loadQuestions()
      } else {
        toast.error(data.error || 'Import failed')
      }
    } catch {
      toast.error('Import failed')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const diffColor: Record<string,string> = { EASY:'badge-green', MEDIUM:'badge-yellow', HARD:'badge-red' }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="speed-accent w-10 mb-3" />
          <h1 className="text-2xl font-bold text-gray-800">Question Bank</h1>
          <p className="text-gray-500 text-sm">{questions.length} questions</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary gap-2 flex items-center text-sm py-2">
            <Download size={15} /> Export
          </button>
          <button onClick={() => !importing && fileRef.current?.click()} className={`gap-2 flex items-center text-sm py-2 ${importing ? 'btn-primary' : 'btn-secondary'}`}>
            {importing ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Importing...
              </>
            ) : (
              <><Upload size={15} /> Import</>
            )}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleImport} />
          <button onClick={() => { setEditQ(null); setForm(emptyQ()); setShowForm(true) }} className="btn-primary">
            <Plus size={15} /> Add Question
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-5 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search questions..."
            value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} />
        </div>
        <select className="input w-48" value={filter.area} onChange={e => setFilter(f => ({ ...f, area: e.target.value }))}>
          <option value="">All Areas</option>
          {AREAS.map(a => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
        </select>
        <select className="input w-36" value={filter.difficulty} onChange={e => setFilter(f => ({ ...f, difficulty: e.target.value }))}>
          <option value="">All Levels</option>
          <option value="EASY">Easy</option>
          <option value="MEDIUM">Medium</option>
          <option value="HARD">Hard</option>
        </select>
      </div>

      {/* Questions Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="table-header text-left p-4">Question</th>
              <th className="table-header text-left p-4">Area</th>
              <th className="table-header text-left p-4">Difficulty</th>
              <th className="table-header text-left p-4">Marks</th>
              <th className="table-header text-right p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {questions.map(q => (
              <tr key={q.id} className="hover:bg-gray-50 group">
                <td className="p-4 text-sm text-gray-700 max-w-md">
                  <p className="line-clamp-2">{q.questionText}</p>
                </td>
                <td className="p-4"><span className="badge-purple">{AREA_LABELS[q.area]}</span></td>
                <td className="p-4"><span className={diffColor[q.difficulty]}>{q.difficulty}</span></td>
                <td className="p-4 text-sm font-medium text-gray-700">{q.weightage}</td>
                <td className="p-4">
                  <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setPreview(q)} className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg">
                      <Eye size={15} />
                    </button>
                    <button onClick={() => { setEditQ(q); setForm({ area: q.area, questionText: q.questionText, optionA: q.optionA, optionB: q.optionB, optionC: q.optionC, optionD: q.optionD, correctAnswer: q.correctAnswer, weightage: q.weightage, difficulty: q.difficulty }); setShowForm(true) }}
                      className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => handleDelete(q.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {questions.length === 0 && (
              <tr><td colSpan={5} className="text-center py-12 text-gray-400">No questions found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-5">{editQ ? 'Edit Question' : 'Add Question'}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Area</label>
                  <select className="input" value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))}>
                    {AREAS.map(a => <option key={a} value={a}>{AREA_LABELS[a]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Difficulty</label>
                  <select className="input" value={form.difficulty} onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))}>
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HARD">Hard</option>
                  </select>
                </div>
                <div>
                  <label className="label">Marks</label>
                  <input className="input" type="number" min={0.5} step={0.5} value={form.weightage}
                    onChange={e => setForm(f => ({ ...f, weightage: +e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">Question *</label>
                <textarea className="input h-24 resize-none" value={form.questionText}
                  onChange={e => setForm(f => ({ ...f, questionText: e.target.value }))}
                  placeholder="Enter the question..." required />
              </div>
              {['A','B','C','D'].map(opt => (
                <div key={opt}>
                  <label className="label flex items-center gap-2">
                    Option {opt}
                    {form.correctAnswer === opt && <span className="badge-green text-xs">Correct</span>}
                  </label>
                  <input className={`input ${form.correctAnswer === opt ? 'border-green-400 bg-green-50' : ''}`}
                    value={(form as any)[`option${opt}`]}
                    onChange={e => setForm(f => ({ ...f, [`option${opt}`]: e.target.value }))}
                    placeholder={`Option ${opt}`} />
                </div>
              ))}
              <div>
                <label className="label">Correct Answer</label>
                <div className="flex gap-2">
                  {['A','B','C','D'].map(opt => (
                    <button key={opt} type="button"
                      onClick={() => setForm(f => ({ ...f, correctAnswer: opt }))}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${form.correctAnswer === opt ? 'bg-green-500 text-white border-green-500' : 'border-gray-200 text-gray-600 hover:border-green-300'}`}>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleSave} disabled={loading} className="btn-primary flex-1 justify-center">
                {loading ? 'Saving...' : 'Save Question'}
              </button>
              <button onClick={() => { setShowForm(false); setEditQ(null) }} className="btn-secondary flex-1 justify-center">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex gap-2">
                <span className="badge-purple">{AREA_LABELS[preview.area]}</span>
                <span className={diffColor[preview.difficulty]}>{preview.difficulty}</span>
              </div>
              <span className="text-sm text-gray-500">{preview.weightage} mark(s)</span>
            </div>
            <p className="text-gray-800 font-medium mb-5">{preview.questionText}</p>
            <div className="space-y-2">
              {['A','B','C','D'].map(opt => (
                <div key={opt} className={`flex items-center gap-3 p-3 rounded-lg border ${preview.correctAnswer === opt ? 'bg-green-50 border-green-300' : 'border-gray-100'}`}>
                  <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 ${preview.correctAnswer === opt ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{opt}</span>
                  <span className="text-sm text-gray-700">{(preview as any)[`option${opt}`]}</span>
                </div>
              ))}
            </div>
            <button onClick={() => setPreview(null)} className="btn-secondary w-full justify-center mt-4">Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
