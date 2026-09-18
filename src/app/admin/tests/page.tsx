'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Plus, Clock, CheckSquare, Pencil, Trash2, Zap, Users, Search } from 'lucide-react'
import { AREA_LABELS } from '@/lib/areas'

const statusColor: Record<string, string> = {
  DRAFT: 'badge-yellow', SCHEDULED: 'badge-purple', ACTIVE: 'badge-teal',
  COMPLETED: 'badge-green', CANCELLED: 'badge-red',
}

const TABS = [
  { value: 'ACTIVE', label: 'Active', color: 'text-teal-600 border-teal-500' },
  { value: 'DRAFT', label: 'Draft', color: 'text-yellow-600 border-yellow-500' },
  { value: 'SCHEDULED', label: 'Scheduled', color: 'text-purple-600 border-purple-500' },
  { value: 'COMPLETED', label: 'Completed', color: 'text-green-600 border-green-500' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'text-red-600 border-red-500' },
  { value: 'ALL', label: 'All', color: 'text-gray-600 border-gray-500' },
]

export default function TestsPage() {
  const router = useRouter()
  const [tests, setTests] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('ACTIVE')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const res = await fetch('/api/admin/tests')
    setTests(await res.json())
    setLoading(false)
  }

  async function handleDelete(testId: string, title: string) {
    if (!confirm(`Delete test "${title}"? This will soft-delete it.`)) return
    const res = await fetch(`/api/admin/tests/${testId}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Test deleted')
      load()
    } else {
      toast.error('Failed to delete test')
    }
  }

  async function handleToggleWalkIn(testId: string, currentlyWalkIn: boolean) {
    const res = await fetch(`/api/admin/tests/${testId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isWalkIn: !currentlyWalkIn, status: !currentlyWalkIn ? 'ACTIVE' : 'DRAFT' })
    })
    if (res.ok) {
      toast.success(!currentlyWalkIn ? 'Walk-in mode enabled' : 'Walk-in mode disabled')
      load()
    } else {
      toast.error('Failed to update')
    }
  }

  const filteredTests = tests.filter(t => {
    if (activeTab !== 'ALL' && t.status !== activeTab) return false
    if (!search) return true
    const q = search.toLowerCase()
    return t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) || t.jobOpening?.title?.toLowerCase().includes(q)
  })
  const tabCounts = tests.reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="speed-accent w-10 mb-3" />
          <h1 className="text-2xl font-bold text-gray-800">Tests & Schedules</h1>
          <p className="text-gray-500 text-sm">Create and manage assessments</p>
        </div>
        <Link href="/admin/tests/new" className="btn-primary">
          <Plus size={16} /> Create Test
        </Link>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-brand-purple border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && <>
      {/* Status Tabs */}
      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {TABS.map(tab => {
          const count = tab.value === 'ALL' ? tests.length : (tabCounts[tab.value] || 0)
          const isActive = activeTab === tab.value
          return (
            <button key={tab.value} onClick={() => setActiveTab(tab.value)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
                isActive ? tab.color : 'text-gray-400 border-transparent hover:text-gray-600'
              }`}>
              {tab.label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-gray-100 text-gray-700' : 'bg-gray-50 text-gray-400'
              }`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" placeholder="Search by title, description, or job opening..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="space-y-4">
        {filteredTests.map((test: any) => {
          const config = (test.assessmentConfig as any[]) || []
          return (
            <div key={test.id} className="card hover:shadow-md transition-all">
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-brand-purple/10">
                  <CheckSquare size={20} className="text-brand-purple" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-800">{test.title}</h3>
                        {test.isWalkIn && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Zap size={10} /> Walk-in
                          </span>
                        )}
                      </div>
                      {test.jobOpening && (
                        <p className="text-xs text-gray-500 mt-0.5">For: {test.jobOpening.title}</p>
                      )}
                    </div>
                    <span className={statusColor[test.status]}>{test.status}</span>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {config.map((c: any) => (
                      <span key={c.area} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-md">
                        {AREA_LABELS[c.area] || c.area}: {c.count}Q
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-5 mt-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><Clock size={13} /> {test.durationMinutes} min</span>
                    <span>{test.totalMarks} marks</span>
                  </div>
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => handleToggleWalkIn(test.id, test.isWalkIn)}
                    className={`text-xs py-1.5 px-3 rounded-lg flex items-center gap-1 transition-colors ${
                      test.isWalkIn
                        ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`} title={test.isWalkIn ? 'Disable walk-in mode' : 'Enable walk-in mode (no schedule needed)'}>
                    <Zap size={13} /> {test.isWalkIn ? 'Walk-in On' : 'Walk-in'}
                  </button>
                  <Link href={`/admin/tests/${test.id}`} className="btn-secondary text-xs py-1.5 px-3">
                    View
                  </Link>
                  <Link href={`/admin/tests/${test.id}/edit`} className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Edit">
                    <Pencil size={15} />
                  </Link>
                  {test.isWalkIn ? (
                    <Link href={`/admin/tests/${test.id}`} className="btn-teal text-xs py-1.5 px-3 flex items-center gap-1">
                      <Users size={13} /> Manage Students
                    </Link>
                  ) : (
                    <Link href={`/admin/tests/${test.id}/schedule`} className="btn-primary text-xs py-1.5 px-3">
                      Schedule
                    </Link>
                  )}
                  <button onClick={() => handleDelete(test.id, test.title)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        {!loading && filteredTests.length === 0 && (
          <div className="card text-center py-16">
            <CheckSquare size={40} className="text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400">
              {activeTab === 'ALL' ? 'No tests created yet' : `No ${activeTab.toLowerCase()} tests`}
            </p>
            {activeTab === 'ALL' && (
              <Link href="/admin/tests/new" className="btn-primary mt-4 inline-flex">
                <Plus size={16} /> Create First Test
              </Link>
            )}
          </div>
        )}
      </div>
      </>}
    </div>
  )
}
