'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Building2, Users, Search, LayoutGrid, List, MapPin, Pencil, Eye } from 'lucide-react'

export default function CollegesPage() {
  const [colleges, setColleges] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  useEffect(() => {
    fetch('/api/admin/colleges').then(r => r.json()).then(data => {
      setColleges(data)
      setLoading(false)
    })
  }, [])

  const filtered = colleges.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return c.name?.toLowerCase().includes(q)
      || c.city?.toLowerCase().includes(q)
      || c.state?.toLowerCase().includes(q)
      || c.contactEmail?.toLowerCase().includes(q)
  })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="speed-accent w-10 mb-3" />
          <h1 className="text-2xl font-bold text-gray-800">Colleges</h1>
          <p className="text-gray-500 text-sm">{colleges.length} colleges</p>
        </div>
        <Link href="/admin/colleges/new" className="btn-primary">
          <Plus size={16} /> Add College
        </Link>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-brand-purple border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && <>
      {/* Search + View Toggle */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9" placeholder="Search by name, city, state..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex border border-gray-200 rounded-lg overflow-hidden">
          <button onClick={() => setView('grid')}
            className={`p-2.5 transition-colors ${view === 'grid' ? 'bg-brand-purple text-white' : 'bg-white text-gray-400 hover:bg-gray-50'}`}
            title="Grid view">
            <LayoutGrid size={16} />
          </button>
          <button onClick={() => setView('list')}
            className={`p-2.5 transition-colors ${view === 'list' ? 'bg-brand-purple text-white' : 'bg-white text-gray-400 hover:bg-gray-50'}`}
            title="List view">
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Grid View */}
      {view === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(college => (
            <div key={college.id} className="card hover:shadow-md transition-all">
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-brand-purple/10">
                  <Building2 size={20} className="text-brand-purple" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-800 truncate">{college.name}</h3>
                  {(college.city || college.state) && (
                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                      <MapPin size={10} /> {[college.city, college.state].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-brand-purple">{college._count?.coordinators ?? 0}</div>
                  <div className="text-xs text-gray-500">Coordinators</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-brand-teal-dark">{college._count?.students ?? 0}</div>
                  <div className="text-xs text-gray-500">Students</div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
                <Link href={`/admin/colleges/${college.id}`}
                  className="flex-1 text-center text-xs text-brand-purple hover:underline font-medium py-1">
                  View Details
                </Link>
                <Link href={`/admin/colleges/${college.id}/edit`}
                  className="flex-1 text-center text-xs text-gray-500 hover:underline font-medium py-1">
                  Edit
                </Link>
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
                <th className="table-header text-left p-4">College</th>
                <th className="table-header text-left p-4">Location</th>
                <th className="table-header text-left p-4">Contact</th>
                <th className="table-header text-center p-4">Coordinators</th>
                <th className="table-header text-center p-4">Students</th>
                <th className="table-header text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(college => (
                <tr key={college.id} className="hover:bg-gray-50">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-brand-purple/10 flex items-center justify-center flex-shrink-0">
                        <Building2 size={14} className="text-brand-purple" />
                      </div>
                      <span className="text-sm font-medium text-gray-800">{college.name}</span>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-gray-500">
                    {[college.city, college.state].filter(Boolean).join(', ') || '\u2014'}
                  </td>
                  <td className="p-4 text-sm text-gray-500">{college.contactEmail || '\u2014'}</td>
                  <td className="p-4 text-center">
                    <span className="text-sm font-bold text-brand-purple">{college._count?.coordinators ?? 0}</span>
                  </td>
                  <td className="p-4 text-center">
                    <span className="text-sm font-bold text-brand-teal-dark">{college._count?.students ?? 0}</span>
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1 justify-end">
                      <Link href={`/admin/colleges/${college.id}`}
                        className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="View Details">
                        <Eye size={15} />
                      </Link>
                      <Link href={`/admin/colleges/${college.id}/edit`}
                        className="p-1.5 text-gray-400 hover:text-brand-purple hover:bg-brand-purple/10 rounded-lg" title="Edit">
                        <Pencil size={15} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-gray-400">
                  {search ? 'No colleges match your search' : 'No colleges added yet'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Grid empty state */}
      {view === 'grid' && filtered.length === 0 && (
        <div className="card text-center py-16">
          <Building2 size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">{search ? 'No colleges match your search' : 'No colleges added yet'}</p>
          {!search && (
            <Link href="/admin/colleges/new" className="btn-primary mt-4 inline-flex">
              <Plus size={16} /> Add First College
            </Link>
          )}
        </div>
      )}
      </>}
    </div>
  )
}
