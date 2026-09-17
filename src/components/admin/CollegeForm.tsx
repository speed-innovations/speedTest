'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Save, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface CollegeFormProps {
  college?: {
    id: string; name: string; address?: string | null; city?: string | null;
    state?: string | null; contactEmail?: string | null; contactPhone?: string | null;
    isActive: boolean;
  }
}

export default function CollegeForm({ college }: CollegeFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: college?.name || '',
    address: college?.address || '',
    city: college?.city || '',
    state: college?.state || '',
    contactEmail: college?.contactEmail || '',
    contactPhone: college?.contactPhone || '',
    isActive: college?.isActive ?? true,
  })

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const url = college ? `/api/admin/colleges/${college.id}` : '/api/admin/colleges'
      const method = college ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) throw new Error(await res.text())
      toast.success(college ? 'College updated!' : 'College created!')
      router.push('/admin/colleges')
      router.refresh()
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <Link href="/admin/colleges" className="text-sm text-gray-500 hover:text-brand-purple flex items-center gap-1 mb-4">
          <ArrowLeft size={15} /> Back to Colleges
        </Link>
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">{college ? 'Edit College' : 'Add College'}</h1>
      </div>

      <form onSubmit={handleSubmit} className="card space-y-5">
        <div>
          <label className="label">College Name *</label>
          <input className="input" value={form.name} onChange={set('name')} required placeholder="e.g. MIT College of Engineering" />
        </div>

        <div>
          <label className="label">Address</label>
          <input className="input" value={form.address} onChange={set('address')} placeholder="Street address" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">City</label>
            <input className="input" value={form.city} onChange={set('city')} placeholder="City" />
          </div>
          <div>
            <label className="label">State</label>
            <input className="input" value={form.state} onChange={set('state')} placeholder="State" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Contact Email</label>
            <input className="input" type="email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="principal@college.edu" />
          </div>
          <div>
            <label className="label">Contact Phone</label>
            <input className="input" value={form.contactPhone} onChange={set('contactPhone')} placeholder="+91 98765 43210" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input type="checkbox" id="isActive" className="rounded" checked={form.isActive}
            onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
          <label htmlFor="isActive" className="text-sm text-gray-700">Active</label>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="btn-primary">
            <Save size={16} /> {loading ? 'Saving...' : 'Save College'}
          </button>
          <Link href="/admin/colleges" className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
