'use client'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (res.ok) {
        router.push('/dashboard')
        router.refresh()
      } else {
        setError('Invalid username or password.')
        setLoading(false)
      }
    } catch {
      setError('Network error — is the server running?')
      setLoading(false)
    }
  }

  return (
    <div className="bg-background text-on-background min-h-screen flex items-center justify-center font-body-md overflow-hidden">
      <div className="w-full h-screen grid lg:grid-cols-2 relative">
        <div className="flex flex-col justify-center items-center px-4 lg:px-16 bg-background z-10">
          <div className="w-full max-w-[400px]">
            <div className="mb-12">
              <Link href="/" className="font-display text-display-lg text-primary mb-2 block">LedgerIQ</Link>
              <p className="font-body-lg text-body-lg text-on-surface-variant">Log in to your account</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-2 uppercase tracking-wider" htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="username"
                  required
                  className="input-underline"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block font-label-md text-label-md text-on-surface-variant uppercase tracking-wider" htmlFor="password">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="input-underline pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-white transition-colors p-0.5"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-error text-sm bg-error/10 border border-error/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary text-on-primary font-label-md text-label-md rounded-full py-4 uppercase tracking-wider hover:bg-surface-tint transition-colors flex items-center justify-center gap-2 group disabled:opacity-50"
                >
                  {loading ? 'Signing in…' : 'Continue'}
                  {!loading && (
                    <span className="material-symbols-outlined text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
                  )}
                </button>
              </div>
            </form>

            <div className="mt-8 text-center">
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Don&apos;t have an account?{' '}
                <span className="text-primary border-b border-primary pb-0.5">Contact sales</span>
              </p>
            </div>
          </div>
        </div>

        <div className="hidden lg:block relative bg-background border-l border-border-subtle overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at 40% 40%, rgba(190,200,210,0.22), transparent 55%), linear-gradient(160deg, #0A1016, #141D26 60%, #090f15)',
            }}
          />
          <div className="absolute inset-0 bg-glass-fill backdrop-blur-[2px]" />
          <div className="absolute inset-0 flex items-center justify-center p-16">
            <div className="max-w-md text-center">
              <h2 className="font-display text-display-lg text-primary mb-4 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]">
                Reconciliation<br />Reinvented.
              </h2>
              <p className="font-body-lg text-body-lg text-on-surface-variant max-w-sm mx-auto">
                AI-powered financial precision meets world-class elegance.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
