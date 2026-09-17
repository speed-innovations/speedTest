'use client'
import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { Upload, Download, CheckCircle, AlertCircle, FileSpreadsheet } from 'lucide-react'

export default function UploadCandidatesPage() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: string[]; total: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function downloadTemplate() {
    const res = await fetch('/api/coordinator/candidates/template')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'candidates_template.xlsx'; a.click()
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/coordinator/candidates/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResult(data)
      toast.success(`${data.imported} candidates imported!`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">Upload Candidates</h1>
        <p className="text-gray-500 text-sm">Import student list via Excel spreadsheet</p>
      </div>

      {/* Instructions */}
      <div className="card mb-6 bg-blue-50 border-blue-200">
        <h3 className="font-semibold text-blue-800 mb-2">📋 How to Upload</h3>
        <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
          <li>Download the template Excel file</li>
          <li>Fill in student details (Full Name, Email, education marks etc.)</li>
          <li>Upload the completed file</li>
          <li>Students will receive login credentials via email</li>
        </ol>
        <button onClick={downloadTemplate} className="mt-4 btn-secondary flex items-center gap-2 text-sm">
          <Download size={15} /> Download Template
        </button>
      </div>

      {/* Upload Zone */}
      <div className="card">
        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer
            ${file ? 'border-brand-purple bg-brand-purple/5' : 'border-gray-200 hover:border-brand-purple hover:bg-gray-50'}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]) }} />

          {file ? (
            <div className="flex items-center justify-center gap-3">
              <FileSpreadsheet size={32} className="text-brand-purple" />
              <div className="text-left">
                <p className="font-medium text-gray-800">{file.name}</p>
                <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            </div>
          ) : (
            <div>
              <Upload size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">Drop Excel file here or click to browse</p>
              <p className="text-xs text-gray-400 mt-1">Supports .xlsx, .xls, .csv</p>
            </div>
          )}
        </div>

        {file && (
          <div className="flex gap-3 mt-4">
            <button onClick={handleUpload} disabled={uploading} className="btn-primary flex-1 justify-center">
              <Upload size={16} /> {uploading ? 'Uploading...' : 'Upload Candidates'}
            </button>
            <button onClick={() => { setFile(null); setResult(null) }} className="btn-secondary">Clear</button>
          </div>
        )}
      </div>

      {/* Upload Results */}
      {result && (
        <div className="card mt-4">
          <h3 className="font-semibold text-gray-700 mb-3">Upload Results</h3>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-700">{result.total}</div>
              <div className="text-xs text-gray-500">Total Rows</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{result.imported}</div>
              <div className="text-xs text-green-600">Imported</div>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-600">{result.errors.length}</div>
              <div className="text-xs text-red-600">Errors</div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="bg-red-50 rounded-lg p-3 max-h-40 overflow-y-auto">
              <p className="text-sm font-medium text-red-700 mb-2 flex items-center gap-1">
                <AlertCircle size={14} /> Errors Found:
              </p>
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600">{e}</p>
              ))}
            </div>
          )}

          {result.imported > 0 && (
            <div className="flex items-center gap-2 text-green-600 mt-3">
              <CheckCircle size={16} />
              <span className="text-sm">{result.imported} students imported. Credentials sent via email.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
