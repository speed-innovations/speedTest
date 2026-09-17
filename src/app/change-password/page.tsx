'use client'
import { useState, Suspense } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { KeyRound, AlertTriangle, Save } from 'lucide-react'
import SpeedLogo from '@/components/ui/SpeedLogo'

const MIN_LENGTH = 8

function ChangePasswordForm() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  // Set when middleware redirected here because the account must rotate its
  // password before it can reach the rest of the app.
  const forced = searchParams.get('required') === '1'

  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.next !== form.confirm) {
      toast.error('New passwords do not match')
      return
    }
    if (form.next.length < MIN_LENGTH) {
      toast.error(`Password must be at least ${MIN_LENGTH} characters`)
      return
    }
    if (form.next === form.current) {
      toast.error('New password must be different from the current password')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not change password')

      toast.success('Password changed. Please sign in again.')
      // Sign out so the session picks up the cleared mustResetPassword claim
      // and the old session stops working.
      setTimeout(() => signOut({ callbackUrl: '/login' }), 1200)
    } catch (err: any) {
      toast.error(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="card max-w-md w-full">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <SpeedLogo />
          </div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center justify-center gap-2">
            <KeyRound size={20} className="text-brand-purple" /> Change Password
          </h1>
          {session?.user?.email && (
            <p className="text-gray-500 text-sm mt-1">{session.user.email}</p>
          )}
        </div>

        {forced && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5">
            <p className="text-sm font-semibold text-amber-700 flex items-center gap-2 mb-1">
              <AlertTriangle size={16} /> Password change required
            </p>
            <p className="text-sm text-amber-700">
              Your account is using a password that was issued to you. Choose a new
              one to continue.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Current Password</label>
            <input
              className="input" type="password" autoComplete="current-password"
              value={form.current} required
              onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
              placeholder="The password you signed in with"
            />
          </div>
          <div>
            <label className="label">New Password</label>
            <input
              className="input" type="password" autoComplete="new-password"
              value={form.next} required minLength={MIN_LENGTH}
              onChange={e => setForm(f => ({ ...f, next: e.target.value }))}
              placeholder={`At least ${MIN_LENGTH} characters`}
            />
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <input
              className="input" type="password" autoComplete="new-password"
              value={form.confirm} required minLength={MIN_LENGTH}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              placeholder="Repeat the new password"
            />
          </div>

          <button type="submit" disabled={saving} className="btn-primary w-full justify-center">
            <Save size={16} /> {saving ? 'Saving...' : 'Change Password'}
          </button>
        </form>

        {!forced && (
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-center text-sm text-gray-500 hover:text-gray-700 mt-4"
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}

// useSearchParams requires a Suspense boundary during prerender.
export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-50" />}>
      <ChangePasswordForm />
    </Suspense>
  )
}
