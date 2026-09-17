'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import SpeedLogo from '@/components/ui/SpeedLogo'
import { Eye, EyeOff, LogIn } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const res = await signIn('credentials', {
      email, password, redirect: false,
    })
    setLoading(false)
    if (res?.ok) {
      toast.success('Welcome back!')
      // Redirect based on role - middleware will handle this
      router.push('/dashboard')
    } else {
      toast.error('Invalid credentials')
    }
  }

  return (
    <div className="min-h-screen flex" style={{
      background: 'linear-gradient(135deg, #3B1F8C 0%, #2A1566 40%, #007DA6 100%)'
    }}>
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center p-12 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="absolute rounded-full opacity-10"
              style={{
                width: 200 + i * 80,
                height: 200 + i * 80,
                border: '1px solid rgba(0,201,167,0.5)',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
              }} />
          ))}
          <div className="absolute top-20 right-10 opacity-20">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="mb-2 rounded-full"
                style={{
                  height: 3,
                  width: 30 + i * 15,
                  background: 'linear-gradient(90deg, #00C9A7, #007DA6)',
                  marginLeft: 'auto',
                }} />
            ))}
          </div>
        </div>

        <div className="relative z-10 text-center">
          <SpeedLogo size="lg" light showTagline={false} />
          <div className="mt-4 text-white/60 text-sm tracking-widest uppercase">innovation</div>
          <div className="mt-8 w-16 mx-auto" style={{ height: 2, background: 'linear-gradient(90deg, #00C9A7, #007DA6)' }} />
          <h2 className="mt-8 text-white text-2xl font-light">Candidate Assessment Platform</h2>
          <p className="mt-4 text-white/60 text-sm leading-relaxed max-w-sm">
            Streamline your campus hiring with intelligent assessments, real-time monitoring, and comprehensive analytics.
          </p>
          
          <div className="mt-10 grid grid-cols-3 gap-6 text-center">
            {[
              { n: '500+', label: 'Colleges' },
              { n: '50K+', label: 'Candidates' },
              { n: '98%', label: 'Accuracy' },
            ].map(stat => (
              <div key={stat.label}>
                <div className="text-2xl font-bold text-white">{stat.n}</div>
                <div className="text-xs text-white/50 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right login form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            <div className="flex justify-center mb-6 lg:hidden">
              <SpeedLogo size="md" />
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Sign In</h1>
            <p className="text-sm text-gray-500 mt-1 mb-8">Access your SpeedTest portal</p>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="label">Email Address</label>
                <input
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="input pr-10"
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="btn-primary w-full justify-center py-3 text-base"
                style={{ background: 'linear-gradient(135deg, #3B1F8C, #5A3DB5)' }}>
                <LogIn size={18} />
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs text-center text-gray-400">
                Contact your administrator if you need access
              </p>
            </div>
          </div>

          <p className="text-center text-white/40 text-xs mt-6">
            © {new Date().getFullYear()} Speed Innovation. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  )
}
