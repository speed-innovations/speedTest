'use client'
import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { Save, Upload, Download, User, GraduationCap, Award, Plus, X, Eye } from 'lucide-react'

interface Certification { name: string; marks: string; year: string }

export default function StudentProfilePage() {
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [certifications, setCertifications] = useState<Certification[]>([])
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<any>({})
  const [showResume, setShowResume] = useState(false)

  useEffect(() => {
    fetch('/api/student/profile')
      .then(r => r.json())
      .then(data => {
        setProfile(data)
        setForm(data)
        setCertifications(data.certifications || [])
        setLoading(false)
      })
  }, [])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f: any) => ({ ...f, [key]: e.target.value }))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append('data', JSON.stringify({ ...form, certifications }))
      if (resumeFile) formData.append('resume', resumeFile)

      const res = await fetch('/api/student/profile', { method: 'PUT', body: formData })
      if (!res.ok) throw new Error(await res.text())
      toast.success('Profile updated!')
      const updated = await res.json()
      setProfile(updated)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  function addCert() {
    setCertifications(c => [...c, { name: '', marks: '', year: '' }])
  }

  function updateCert(i: number, key: keyof Certification, val: string) {
    setCertifications(c => c.map((cert, idx) => idx === i ? { ...cert, [key]: val } : cert))
  }

  function removeCert(i: number) {
    setCertifications(c => c.filter((_, idx) => idx !== i))
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="w-8 h-8 border-3 border-brand-purple border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">My Profile</h1>
        <p className="text-gray-500 text-sm">Review and update your information</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Personal Info */}
        <div className="card space-y-4">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2 border-b pb-2">
            <User size={18} className="text-brand-purple" /> Personal Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name</label>
              <input className="input" value={form.fullName || ''} onChange={set('fullName')} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input bg-gray-50" value={form.email || ''} disabled />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone || ''} onChange={set('phone')} placeholder="+91 9876543210" />
            </div>
            <div>
              <label className="label">Gender</label>
              <select className="input" value={form.gender || ''} onChange={set('gender')}>
                <option value="">Select...</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </div>
          </div>
        </div>

        {/* Education */}
        <div className="card space-y-5">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2 border-b pb-2">
            <GraduationCap size={18} className="text-brand-purple" /> Education Details
          </h2>

          {/* 10th */}
          <div>
            <div className="text-sm font-semibold text-gray-600 mb-2">10th Standard</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className="label">Marks / CGPA (%)</label>
                <input className="input" type="number" step="0.01" value={form.tenthMarks || ''} onChange={set('tenthMarks')} placeholder="85.0" /></div>
              <div><label className="label">Board</label>
                <input className="input" value={form.tenthBoard || ''} onChange={set('tenthBoard')} placeholder="CBSE" /></div>
              <div><label className="label">Year</label>
                <input className="input" type="number" value={form.tenthYear || ''} onChange={set('tenthYear')} placeholder="2018" /></div>
            </div>
          </div>

          {/* 12th */}
          <div>
            <div className="text-sm font-semibold text-gray-600 mb-2">12th Standard</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div><label className="label">Marks (%)</label>
                <input className="input" type="number" step="0.01" value={form.twelfthMarks || ''} onChange={set('twelfthMarks')} placeholder="78.0" /></div>
              <div><label className="label">Board</label>
                <input className="input" value={form.twelfthBoard || ''} onChange={set('twelfthBoard')} placeholder="CBSE" /></div>
              <div><label className="label">Year</label>
                <input className="input" type="number" value={form.twelfthYear || ''} onChange={set('twelfthYear')} placeholder="2020" /></div>
            </div>
          </div>

          {/* Graduation */}
          <div>
            <div className="text-sm font-semibold text-gray-600 mb-2">Graduation</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Degree</label>
                <input className="input" value={form.graduationDegree || ''} onChange={set('graduationDegree')} placeholder="B.Tech Computer Science" /></div>
              <div><label className="label">Marks / CGPA (%)</label>
                <input className="input" type="number" step="0.01" value={form.graduationMarks || ''} onChange={set('graduationMarks')} placeholder="72.0" /></div>
              <div><label className="label">University / College</label>
                <input className="input" value={form.graduationBoard || ''} onChange={set('graduationBoard')} placeholder="University name" /></div>
              <div><label className="label">Year</label>
                <input className="input" type="number" value={form.graduationYear || ''} onChange={set('graduationYear')} placeholder="2024" /></div>
            </div>
          </div>

          {/* Post Graduation */}
          <div>
            <div className="text-sm font-semibold text-gray-600 mb-2">Post Graduation <span className="text-gray-400 font-normal">(if applicable)</span></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Degree</label>
                <input className="input" value={form.pgDegree || ''} onChange={set('pgDegree')} placeholder="M.Tech / MBA..." /></div>
              <div><label className="label">Marks / CGPA (%)</label>
                <input className="input" type="number" step="0.01" value={form.pgMarks || ''} onChange={set('pgMarks')} placeholder="80.0" /></div>
              <div><label className="label">University</label>
                <input className="input" value={form.pgBoard || ''} onChange={set('pgBoard')} placeholder="University name" /></div>
              <div><label className="label">Year</label>
                <input className="input" type="number" value={form.pgYear || ''} onChange={set('pgYear')} placeholder="2026" /></div>
            </div>
          </div>
        </div>

        {/* Certifications */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <Award size={18} className="text-brand-purple" /> Certifications
            </h2>
            <button type="button" onClick={addCert} className="btn-teal text-xs py-1.5 px-3">
              <Plus size={13} /> Add
            </button>
          </div>
          {certifications.map((cert, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="label">Certification Name</label>
                  <input className="input" value={cert.name} onChange={e => updateCert(i, 'name', e.target.value)} placeholder="AWS Cloud Practitioner" /></div>
                <div><label className="label">Score / Grade</label>
                  <input className="input" value={cert.marks} onChange={e => updateCert(i, 'marks', e.target.value)} placeholder="890/1000" /></div>
                <div><label className="label">Year</label>
                  <input className="input" value={cert.year} onChange={e => updateCert(i, 'year', e.target.value)} placeholder="2024" /></div>
              </div>
              <button type="button" onClick={() => removeCert(i)} className="mt-7 p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
                <X size={15} />
              </button>
            </div>
          ))}
          {certifications.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No certifications added</p>
          )}
        </div>

        {/* Resume Upload */}
        <div className="card">
          <h2 className="font-semibold text-gray-700 flex items-center gap-2 mb-4">
            <Upload size={18} className="text-brand-purple" /> Resume / Profile
          </h2>
          {profile?.resumeUrl && (
            <div className="flex items-center gap-3 mb-3 p-3 bg-green-50 rounded-lg">
              <Eye size={16} className="text-green-600" />
              <button onClick={() => setShowResume(true)}
                className="text-sm text-green-600 hover:underline flex-1 text-left">
                Current Resume (click to preview)
              </button>
              <a href="/api/student/resume" download
                className="text-xs text-brand-purple hover:underline flex items-center gap-1">
                <Download size={13} /> Download
              </a>
            </div>
          )}
          <div
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
              ${resumeFile ? 'border-brand-purple bg-brand-purple/5' : 'border-gray-200 hover:border-brand-purple'}`}
            onClick={() => fileRef.current?.click()}>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
              onChange={e => { if (e.target.files?.[0]) setResumeFile(e.target.files[0]) }} />
            {resumeFile ? (
              <p className="text-sm text-brand-purple font-medium">{resumeFile.name}</p>
            ) : (
              <>
                <Upload size={24} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Upload updated resume (PDF or Word)</p>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </form>

      {/* Resume Preview Modal */}
      {showResume && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h2 className="font-semibold text-gray-800">Resume Preview</h2>
              <div className="flex items-center gap-2">
                <a href="/api/student/resume" download
                  className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1">
                  <Download size={13} /> Download
                </a>
                <button onClick={() => setShowResume(false)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden">
              <iframe src="/api/student/resume" className="w-full h-full border-0" title="Resume Preview" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
