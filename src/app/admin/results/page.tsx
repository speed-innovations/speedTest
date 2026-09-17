'use client'
import { useState, useEffect } from 'react'
import { Download, Search, Eye, X, FileText, CheckCircle, XCircle, AlertTriangle, Flag } from 'lucide-react'
import toast from 'react-hot-toast'

const AREA_LABELS: Record<string, string> = {
  APTITUDE:'Aptitude', DOTNET:'.NET', COMMUNICATION:'Comm.',
  AI:'AI', PYTHON:'Python', JAVA:'Java', JAVASCRIPT:'JS', SQL:'SQL'
}
const DIFF_COLOR: Record<string, string> = { EASY: 'text-green-600', MEDIUM: 'text-yellow-600', HARD: 'text-red-600' }

export default function ResultsPage() {
  const [results, setResults] = useState<any[]>([])
  const [colleges, setColleges] = useState<any[]>([])
  const [tests, setTests] = useState<any[]>([])
  const [filter, setFilter] = useState({ collegeId: '', testId: '', search: '' })
  const [resumePreview, setResumePreview] = useState<{ studentId: string; name: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailReport, setDetailReport] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    fetch('/api/admin/colleges').then(r => r.json()).then(setColleges)
    fetch('/api/admin/tests').then(r => r.json()).then(setTests)
  }, [])

  useEffect(() => { loadResults() }, [filter])

  async function loadResults() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filter.collegeId) params.set('collegeId', filter.collegeId)
    if (filter.testId) params.set('testId', filter.testId)
    if (filter.search) params.set('search', filter.search)
    const res = await fetch(`/api/admin/results?${params}`)
    setResults(await res.json())
    setLoading(false)
  }

  async function exportResults() {
    const params = new URLSearchParams()
    if (filter.collegeId) params.set('collegeId', filter.collegeId)
    if (filter.testId) params.set('testId', filter.testId)
    const res = await fetch(`/api/admin/results/export?${params}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'results.xlsx'; a.click()
    toast.success('Results exported!')
  }

  async function openDetailReport(attemptId: string, type: string) {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/results/detail?attemptId=${attemptId}&type=${type}`)
      const data = await res.json()
      if (res.ok) setDetailReport(data)
      else toast.error(data.error || 'Failed to load report')
    } catch { toast.error('Failed to load report') }
    finally { setDetailLoading(false) }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="speed-accent w-10 mb-3" />
          <h1 className="text-2xl font-bold text-gray-800">Results & Reports</h1>
          <p className="text-gray-500 text-sm">{results.length} submitted results</p>
        </div>
        <button onClick={exportResults} className="btn-primary">
          <Download size={16} /> Export Excel
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-5 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by name..."
            value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} />
        </div>
        <select className="input w-52" value={filter.collegeId} onChange={e => setFilter(f => ({ ...f, collegeId: e.target.value }))}>
          <option value="">All Colleges</option>
          {colleges.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input w-52" value={filter.testId} onChange={e => setFilter(f => ({ ...f, testId: e.target.value }))}>
          <option value="">All Tests</option>
          {tests.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
      </div>

      {/* Results Table */}
      <div className="card p-0 overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[1000px]">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="table-header text-left p-4">Candidate</th>
              <th className="table-header text-left p-4">College</th>
              <th className="table-header text-left p-4">Test</th>
              <th className="table-header text-left p-4">Mode</th>
              <th className="table-header text-left p-4">Test Score</th>
              <th className="table-header text-left p-4">Status</th>
              <th className="table-header text-center p-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading...</td></tr>
            ) : results.map((r: any) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="p-4">
                  <div className="text-sm font-medium text-gray-800">{r.student?.fullName}</div>
                  <div className="text-xs text-gray-500">{r.student?.email}</div>
                </td>
                <td className="p-4 text-sm text-gray-500">{r.student?.college?.name}</td>
                <td className="p-4 text-sm text-gray-600">{r.schedule?.test?.title || '\u2014'}</td>
                <td className="p-4">
                  <span className={r.type === 'walkin' ? 'text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full' : 'text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full'}>
                    {r.type === 'walkin' ? 'Walk-in' : 'Scheduled'}
                  </span>
                </td>
                <td className="p-4">
                  {r.totalScore != null ? (
                    <div>
                      <div className="text-sm font-bold text-brand-purple">{r.totalScore}</div>
                      {r.areaScores && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(r.areaScores).map(([area, score]: any) => (
                            <span key={area} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              {AREA_LABELS[area] || area}: {score}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : <span className="text-gray-400 text-sm">Not attempted</span>}
                </td>
                <td className="p-4">
                  <span className={
                    r.student?.status === 'SHORTLISTED' ? 'badge-green' :
                    r.student?.status === 'REJECTED' ? 'badge-red' : 'badge-yellow'
                  }>{r.student?.status || 'REGISTERED'}</span>
                </td>
                <td className="p-4">
                  <div className="flex gap-1 justify-center">
                    <button onClick={() => openDetailReport(r.id, r.type)}
                      className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Detail Report">
                      <FileText size={15} />
                    </button>
                    {r.student?.resumeUrl && (
                      <button onClick={() => setResumePreview({ studentId: r.student.id, name: r.student.fullName })}
                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="View Resume">
                        <Eye size={15} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && results.length === 0 && (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">No results found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Report Modal */}
      {(detailReport || detailLoading) && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="font-bold text-gray-800 text-lg">Detail Report</h2>
                {detailReport && (
                  <p className="text-sm text-gray-500">
                    {detailReport.student?.fullName} &middot; {detailReport.test?.title}
                  </p>
                )}
              </div>
              <button onClick={() => setDetailReport(null)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-brand-purple border-t-transparent rounded-full animate-spin" />
              </div>
            ) : detailReport && (
              <div className="flex-1 overflow-y-auto">
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 bg-gray-50 border-b border-gray-200">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-brand-purple">{detailReport.totalScore ?? 0}</div>
                    <div className="text-xs text-gray-500">Total Score</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {detailReport.responses?.filter((r: any) => r.isCorrect).length || 0}
                    </div>
                    <div className="text-xs text-gray-500">Correct</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-500">
                      {detailReport.responses?.filter((r: any) => r.selectedAnswer && !r.isCorrect).length || 0}
                    </div>
                    <div className="text-xs text-gray-500">Wrong</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-400">
                      {detailReport.responses?.filter((r: any) => !r.selectedAnswer).length || 0}
                    </div>
                    <div className="text-xs text-gray-500">Unanswered</div>
                  </div>
                </div>

                {/* Area-wise scores */}
                {detailReport.areaScores && (
                  <div className="px-6 py-3 border-b border-gray-100 flex flex-wrap gap-3">
                    {Object.entries(detailReport.areaScores).map(([area, score]: any) => (
                      <div key={area} className="flex items-center gap-1.5 text-sm">
                        <span className="badge-purple">{AREA_LABELS[area] || area}</span>
                        <span className="font-bold text-gray-700">{score}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Violations */}
                {detailReport.violations?.length > 0 && (
                  <div className="px-6 py-2 bg-orange-50 border-b border-orange-200 flex items-center gap-2 text-sm text-orange-700">
                    <AlertTriangle size={14} />
                    {detailReport.violations.length} violation(s) detected
                  </div>
                )}

                {/* Question-by-question */}
                <div className="p-6 space-y-4">
                  {detailReport.responses?.map((r: any, idx: number) => {
                    const options = [
                      { key: 'A', text: r.optionA },
                      { key: 'B', text: r.optionB },
                      { key: 'C', text: r.optionC },
                      { key: 'D', text: r.optionD },
                    ]
                    return (
                      <div key={r.questionId} className={`rounded-xl border p-4 ${
                        r.isCorrect ? 'border-green-200 bg-green-50/30' :
                        r.selectedAnswer ? 'border-red-200 bg-red-50/30' :
                        'border-gray-200'
                      }`}>
                        {/* Question header */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-start gap-2">
                            <span className="bg-brand-purple text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                              {idx + 1}
                            </span>
                            <p className="text-sm text-gray-800 font-medium">{r.questionText}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {r.flagged && (
                              <span className="text-orange-500" title="Tab switch detected"><Flag size={13} /></span>
                            )}
                            <span className={`text-xs ${DIFF_COLOR[r.difficulty] || 'text-gray-500'}`}>{r.difficulty}</span>
                            <span className="badge-purple text-xs">{AREA_LABELS[r.area] || r.area}</span>
                            <span className="text-xs font-bold text-gray-500">{r.marksAwarded ?? 0}/{r.weightage}</span>
                          </div>
                        </div>

                        {/* Options */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 ml-8">
                          {options.map(opt => {
                            const isCorrect = opt.key === r.correctAnswer
                            const isSelected = opt.key === r.selectedAnswer
                            const isWrong = isSelected && !isCorrect
                            return (
                              <div key={opt.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${
                                isCorrect ? 'border-green-300 bg-green-50 text-green-800' :
                                isWrong ? 'border-red-300 bg-red-50 text-red-800' :
                                'border-gray-100 text-gray-600'
                              }`}>
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                                  isCorrect ? 'bg-green-500 text-white' :
                                  isWrong ? 'bg-red-500 text-white' :
                                  'bg-gray-100 text-gray-500'
                                }`}>
                                  {opt.key}
                                </span>
                                <span className="flex-1">{opt.text}</span>
                                {isCorrect && <CheckCircle size={14} className="text-green-600 flex-shrink-0" />}
                                {isWrong && <XCircle size={14} className="text-red-500 flex-shrink-0" />}
                              </div>
                            )
                          })}
                        </div>

                        {/* Not answered */}
                        {!r.selectedAnswer && (
                          <p className="text-xs text-gray-400 ml-8 mt-2 italic">Not answered</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Resume Preview Modal */}
      {resumePreview && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h2 className="font-semibold text-gray-800">Resume - {resumePreview.name}</h2>
              <div className="flex items-center gap-2">
                <a href={`/api/student/resume?studentId=${resumePreview.studentId}`} download
                  className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
                  <Download size={13} /> Download
                </a>
                <button onClick={() => setResumePreview(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe src={`/api/student/resume?studentId=${resumePreview.studentId}`}
                className="w-full h-full border-0" title="Resume Preview" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
