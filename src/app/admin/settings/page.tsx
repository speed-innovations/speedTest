'use client'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { Save, KeyRound, Building2 } from 'lucide-react'

export default function AdminSettingsPage() {
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' })
  const [saving, setSaving] = useState(false)

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    if (passwords.newPass !== passwords.confirm) {
      toast.error('New passwords do not match')
      return
    }
    if (passwords.newPass.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.newPass })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      toast.success('Password changed successfully!')
      setPasswords({ current: '', newPass: '', confirm: '' })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <div className="speed-accent w-10 mb-3" />
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
        <p className="text-gray-500 text-sm">Manage your account and application settings</p>
      </div>

      {/* Change Password */}
      <div className="card mb-6">
        <h2 className="font-semibold text-gray-700 flex items-center gap-2 mb-4 border-b pb-2">
          <KeyRound size={18} className="text-brand-purple" /> Change Password
        </h2>
        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="label">Current Password</label>
            <input className="input" type="password" value={passwords.current}
              onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))}
              required placeholder="Enter current password" />
          </div>
          <div>
            <label className="label">New Password</label>
            <input className="input" type="password" value={passwords.newPass}
              onChange={e => setPasswords(p => ({ ...p, newPass: e.target.value }))}
              required placeholder="Min 6 characters" />
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <input className="input" type="password" value={passwords.confirm}
              onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))}
              required placeholder="Repeat new password" />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            <Save size={16} /> {saving ? 'Saving...' : 'Change Password'}
          </button>
        </form>
      </div>

      {/* App Info */}
      <div className="card">
        <h2 className="font-semibold text-gray-700 flex items-center gap-2 mb-4 border-b pb-2">
          <Building2 size={18} className="text-brand-purple" /> Application Info
        </h2>
        <div className="space-y-3 text-sm">
          {[
            ['Application', 'SpeedTest – Candidate Assessment Platform'],
            ['Version', '1.0.0'],
            ['Built by', 'Speed Innovation'],
            ['Framework', 'Next.js 14 + PostgreSQL + Prisma'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between border-b border-gray-50 pb-2">
              <span className="text-gray-500">{label}</span>
              <span className="text-gray-700 font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
