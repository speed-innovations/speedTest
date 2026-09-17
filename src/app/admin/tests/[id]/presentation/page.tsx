'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { ArrowLeft, Upload, Link as LinkIcon, Save, FileText } from 'lucide-react'
import Link from 'next/link'

export default function TestPresentationPage() {
  const { id } = useParams()
  const router = useRouter()
  const [test, setTest] = useState<any>(null)
  const [pptUrl, setPptUrl] = useState('')
  const [pptFile, setPptFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch(`/api/admin/tests/${id}`)
      .then(r => r.json())
      .then(data => { setTest(data); setPptUrl(data.companyPptUrl || '') })
  }, [id])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      let finalUrl = pptUrl

      if (pptFile) {
        // In production: upload to Vercel Blob
        // const { url } = await put(`presentations/${id}/${pptFile.name}`, pptFile, { access: 'public' })
        // finalUrl = url
        finalUrl = `/uploads/presentations/${pptFile.name}` // dev placeholder
        toast('Note: File upload requires Vercel Blob in production', { icon: 'ℹ️' })
      }

      const res = await fetch(`/api/admin/tests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...test, companyPptUrl: finalUrl })
      })
      if (!res.ok) throw new Error('Save failed')
      toast.success('Presentation link saved!')
      router.push(`/admin/tests/${id}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-xl">
      <div className="mb-6">
        <Link href={`/admin/tests/${id}`} className="text-sm text-gray-500 hover:text-brand-purple flex items-center gap-1 mb-4">
          <ArrowLeft size={15} /> Back to Test
        </Link>
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">Company Presentation</h1>
        <p className="text-gray-500 text-sm">For: {test?.title}</p>
      </div>

      <form onSubmit={handleSave} className="card space-y-5">
        <p className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
          📎 Students will be able to download this presentation from their test dashboard.
        </p>

        {/* URL option */}
        <div>
          <label className="label flex items-center gap-2">
            <LinkIcon size={14} /> Presentation URL (Google Slides, OneDrive, etc.)
          </label>
          <input className="input" type="url" value={pptUrl}
            onChange={e => setPptUrl(e.target.value)}
            placeholder="https://docs.google.com/presentation/d/..." />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400">OR</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* File upload */}
        <div>
          <label className="label flex items-center gap-2">
            <Upload size={14} /> Upload File (PDF, PPT, PPTX)
          </label>
          <div
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
              ${pptFile ? 'border-brand-purple bg-brand-purple/5' : 'border-gray-200 hover:border-brand-purple'}`}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".pdf,.ppt,.pptx" className="hidden"
              onChange={e => { if (e.target.files?.[0]) setPptFile(e.target.files[0]) }} />
            {pptFile ? (
              <div className="flex items-center justify-center gap-2 text-brand-purple">
                <FileText size={20} />
                <span className="text-sm font-medium">{pptFile.name}</span>
              </div>
            ) : (
              <>
                <Upload size={24} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Click to upload presentation</p>
                <p className="text-xs text-gray-400 mt-1">.pdf, .ppt, .pptx</p>
              </>
            )}
          </div>
        </div>

        {test?.companyPptUrl && (
          <div className="text-sm text-green-600 bg-green-50 p-3 rounded-lg flex items-center gap-2">
            <FileText size={15} /> Current:
            <a href={test.companyPptUrl} target="_blank" rel="noopener noreferrer"
              className="hover:underline truncate">{test.companyPptUrl}</a>
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Save Presentation'}
          </button>
          <Link href={`/admin/tests/${id}`} className="btn-secondary">Cancel</Link>
        </div>
      </form>
    </div>
  )
}
