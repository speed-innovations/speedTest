'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Plus, Minus, Save, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const AREAS = [
  { value: 'APTITUDE', label: 'Aptitude' },
  { value: 'DOTNET', label: '.NET Programming' },
  { value: 'COMMUNICATION', label: 'Communication' },
  { value: 'AI', label: 'Artificial Intelligence' },
  { value: 'PYTHON', label: 'Python Programming' },
  { value: 'JAVA', label: 'Java Programming' },
  { value: 'JAVASCRIPT', label: 'JavaScript' },
  { value: 'SQL', label: 'SQL / Database' },
]

interface AreaConfig {
  area: string; count: number;
  easyPct: number; mediumPct: number; hardPct: number;
}

export default function CreateTestPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [jobOpenings, setJobOpenings] = useState<any[]>([])
  const [bankStats, setBankStats] = useState<Record<string, { count: number; avgWeightage: number; easy: number; medium: number; hard: number }>>({})
  const [form, setForm] = useState({
    title: '',
    description: '',
    durationMinutes: 60,
    passingMarks: 40,
    jobOpeningId: '',
    isWalkIn: false,
  })
  const [areas, setAreas] = useState<AreaConfig[]>([
    { area: 'APTITUDE', count: 20, easyPct: 30, mediumPct: 50, hardPct: 20 }
  ])

  useEffect(() => {
    fetch('/api/admin/job-openings').then(r => r.json()).then(setJobOpenings).catch(() => {})
    fetch('/api/admin/questions/stats').then(r => r.json()).then(setBankStats).catch(() => {})
  }, [])

  const addArea = () => setAreas(a => [...a, { area: 'PYTHON', count: 10, easyPct: 30, mediumPct: 50, hardPct: 20 }])
  const removeArea = (i: number) => setAreas(a => a.filter((_, idx) => idx !== i))
  const updateArea = (i: number, key: keyof AreaConfig, val: any) =>
    setAreas(a => a.map((x, idx) => idx === i ? { ...x, [key]: val } : x))

  const totalQuestions = areas.reduce((sum, a) => sum + a.count, 0)
  // Estimate total marks from bank average weightage per area
  const totalMarks = areas.reduce((sum, a) => {
    const avg = bankStats[a.area]?.avgWeightage || 1
    return sum + a.count * avg
  }, 0)

  function validateDifficultyMix(): boolean {
    for (const area of areas) {
      const total = area.easyPct + area.mediumPct + area.hardPct
      if (total !== 100) {
        toast.error(`${AREAS.find(a => a.value === area.area)?.label}: difficulty percentages must add up to 100% (currently ${total}%)`)
        return false
      }
    }
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (areas.length === 0) { toast.error('Add at least one assessment area'); return }
    if (!validateDifficultyMix()) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          totalMarks: Math.round(totalMarks),
          assessmentConfig: areas,
          jobOpeningId: form.jobOpeningId || null,
          isWalkIn: form.isWalkIn,
        })
      })
      if (!res.ok) throw new Error(await res.text())
      toast.success('Test created successfully!')
      router.push('/admin/tests')
      router.refresh()
    } catch (err: any) {
      toast.error(err.message || 'Failed to create test')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <Link href="/admin/tests" className="text-sm text-gray-500 hover:text-brand-purple flex items-center gap-1 mb-4">
          <ArrowLeft size={15} /> Back to Tests
        </Link>
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">Create New Test</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-700 border-b pb-2">Basic Information</h2>
          <div>
            <label className="label">Test Title *</label>
            <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required placeholder="e.g. Campus Hiring Drive - 2025" />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Brief description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Duration (minutes)</label>
              <input className="input" type="number" min={10} value={form.durationMinutes}
                onChange={e => setForm(f => ({ ...f, durationMinutes: +e.target.value }))} />
            </div>
            <div>
              <label className="label">Passing Marks</label>
              <input className="input" type="number" min={1} value={form.passingMarks}
                onChange={e => setForm(f => ({ ...f, passingMarks: +e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Job Opening (optional)</label>
            <select className="input" value={form.jobOpeningId} onChange={e => setForm(f => ({ ...f, jobOpeningId: e.target.value }))}>
              <option value="">Select job opening...</option>
              {jobOpenings.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg border border-orange-100">
            <input type="checkbox" id="isWalkIn" checked={form.isWalkIn}
              onChange={e => setForm(f => ({ ...f, isWalkIn: e.target.checked }))}
              className="w-4 h-4 text-brand-purple rounded" />
            <label htmlFor="isWalkIn" className="text-sm">
              <span className="font-medium text-orange-700">Walk-in Mode (Lab)</span>
              <span className="text-orange-600 block text-xs">Enable for candidates present in lab. No schedule needed — timer starts when candidate begins.</span>
            </label>
          </div>
        </div>

        {/* Assessment Areas */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-semibold text-gray-700">Assessment Areas</h2>
            <button type="button" onClick={addArea} className="btn-teal text-xs py-1.5 px-3">
              <Plus size={14} /> Add Area
            </button>
          </div>

          <p className="text-xs text-gray-500">Marks per question are picked from the question bank weightage. No additional config needed.</p>

          <div className="space-y-4">
            {areas.map((area, i) => {
              const diffTotal = area.easyPct + area.mediumPct + area.hardPct
              const diffValid = diffTotal === 100
              const stats = bankStats[area.area]
              return (
                <div key={i} className="p-4 bg-gray-50 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <select className="input flex-1" value={area.area}
                      onChange={e => updateArea(i, 'area', e.target.value)}>
                      {AREAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 whitespace-nowrap">Questions</label>
                      <input className="input w-20" type="number" min={1} value={area.count}
                        onChange={e => updateArea(i, 'count', +e.target.value)} />
                    </div>
                    <button type="button" onClick={() => removeArea(i)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg">
                      <Minus size={16} />
                    </button>
                  </div>
                  {stats && (
                    <div className="text-xs pl-1 space-y-0.5">
                      <div className={stats.count < area.count ? 'text-red-600 font-medium' : 'text-gray-500'}>
                        Bank: {stats.count} questions available, avg weightage {stats.avgWeightage.toFixed(1)} marks/q
                        {stats.count < area.count && ` — insufficient! Need ${area.count}`}
                      </div>
                      <div className="text-gray-400">
                        Breakdown: <span className="text-green-600">Easy {stats.easy}</span> &middot; <span className="text-yellow-600">Medium {stats.medium}</span> &middot; <span className="text-red-600">Hard {stats.hard}</span>
                      </div>
                    </div>
                  )}
                  {/* Difficulty mix */}
                  <div className={`flex items-center gap-3 p-2.5 rounded-lg border ${diffValid ? 'bg-white border-gray-200' : 'bg-red-50 border-red-200'}`}>
                    <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Difficulty Mix:</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-green-600 font-medium">Easy</span>
                      <input className="input w-16 text-center text-sm py-1" type="number" min={0} max={100}
                        value={area.easyPct} onChange={e => updateArea(i, 'easyPct', +e.target.value)} />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-yellow-600 font-medium">Medium</span>
                      <input className="input w-16 text-center text-sm py-1" type="number" min={0} max={100}
                        value={area.mediumPct} onChange={e => updateArea(i, 'mediumPct', +e.target.value)} />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-600 font-medium">Hard</span>
                      <input className="input w-16 text-center text-sm py-1" type="number" min={0} max={100}
                        value={area.hardPct} onChange={e => updateArea(i, 'hardPct', +e.target.value)} />
                      <span className="text-xs text-gray-400">%</span>
                    </div>
                    <span className={`text-xs font-bold ${diffValid ? 'text-green-600' : 'text-red-500'}`}>
                      = {diffTotal}%
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex gap-6 p-3 bg-brand-purple/5 rounded-lg text-sm">
            <div><span className="text-gray-500">Total Questions: </span><strong>{totalQuestions}</strong></div>
            <div><span className="text-gray-500">Est. Total Marks: </span><strong>~{Math.round(totalMarks)}</strong></div>
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="btn-primary">
            <Save size={16} /> {loading ? 'Creating...' : 'Create Test'}
          </button>
          <Link href="/admin/tests" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
