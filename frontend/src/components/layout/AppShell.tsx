'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useRef, useState, useEffect } from 'react'
import { ChevronDown, LogOut, Settings, User, Menu, X as XIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { GlobalSearch } from '@/components/ui/GlobalSearch'
import { GeminiPanel, openGeminiPanel } from '@/components/ui/GeminiPanel'
import { NotificationCenter } from '@/components/ui/NotificationCenter'

const ALL_NAV = [
  { label: 'Dashboard',           href: '/dashboard',        permission: 'dashboard.view' },
  { label: 'Counterparties',      href: '/counterparties',   permission: 'counterparties.view' },
  { label: 'Reconciliation',      href: '/reconciliations',  permission: 'reconciliations.view' },
  { label: 'Discrepancies',       href: '/discrepancies',    permission: 'discrepancies.view' },
  { label: 'Integrations',        href: '/integrations',     permission: 'erp_integration.view' },
  { label: 'Reports',             href: '/reports',          permission: 'dashboard.view' },
  { label: 'Settings',            href: '/settings',         permission: 'settings.view' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, hasPermission } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  const NAV = ALL_NAV

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  const canViewSettings = hasPermission('settings.view') || hasPermission('settings.edit')
  const userInitial = (user?.full_name || user?.username || 'U').charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-background text-on-surface flex flex-col overflow-x-hidden">
      <nav className="fixed top-0 w-full z-50 flex justify-between items-center px-4 md:px-16 h-16 bg-white/5 backdrop-blur-xl border-b border-white/10 shadow-sm">
        <div className="flex items-center gap-8 min-w-0">
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className="md:hidden p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Toggle navigation"
          >
            {mobileMenuOpen ? <XIcon className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Link href="/dashboard" className="font-display text-headline-md text-white tracking-tight shrink-0">
            LedgerIQ
          </Link>
          <div className="hidden md:flex items-center gap-1 lg:gap-4 overflow-x-auto scrollbar-none">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'font-body-md text-body-md whitespace-nowrap transition-colors px-2 py-2',
                    active
                      ? 'text-white font-bold border-b-2 border-white pb-1'
                      : 'text-white/60 hover:text-white hover:bg-white/5 rounded-md',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 shrink-0">
          <kbd className="hidden lg:flex items-center px-2 py-1 text-[10px] font-mono font-semibold text-white/40 bg-white/5 border border-white/10 rounded-lg">
            /
          </kbd>
          <GlobalSearch />
          <NotificationCenter />
          <button
            onClick={() => openGeminiPanel({ page: pathname })}
            className="hidden sm:inline-flex bg-primary text-on-primary px-4 py-2 rounded-full font-label-md text-label-md hover:bg-surface-tint transition-colors"
          >
            Talk to us
          </button>
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setSettingsOpen(o => !o)}
              className={cn(
                'flex items-center gap-2 rounded-full transition-colors',
                settingsOpen ? 'ring-2 ring-white/30' : 'hover:opacity-90',
              )}
              aria-label="Account menu"
            >
              <div className="w-8 h-8 rounded-full border border-white/10 bg-surface-container-high flex items-center justify-center">
                <span className="text-xs font-semibold text-white">{userInitial}</span>
              </div>
              <ChevronDown className={cn('w-3.5 h-3.5 text-white/50 hidden sm:block transition-transform', settingsOpen && 'rotate-180')} />
            </button>

            {settingsOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-surface-elevated border border-border-subtle rounded-xl shadow-glass py-1 z-50">
                {user && (
                  <div className="px-4 py-3 border-b border-border-subtle">
                    <p className="text-sm font-medium text-on-surface">{user.full_name || user.username}</p>
                    <p className="text-xs text-on-surface-variant">{user.email}</p>
                    <span className="inline-block mt-1 text-[10px] bg-white/10 text-white px-2 py-0.5 rounded-full font-medium">
                      {user.role}
                    </span>
                  </div>
                )}
                {(canViewSettings || hasPermission('users.view')) && (
                  <Link
                    href="/settings"
                    onClick={() => setSettingsOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-on-surface-variant hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Company Settings
                  </Link>
                )}
                <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-on-surface-variant hover:text-white hover:bg-white/5 transition-colors">
                  <User className="w-4 h-4" />
                  My Profile
                </button>
                <div className="border-t border-border-subtle mt-1">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-error hover:bg-error/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <nav className="absolute top-0 left-0 bottom-0 w-72 max-w-[85vw] bg-surface-elevated border-r border-border-subtle shadow-2xl flex flex-col pt-16 overflow-y-auto">
            {user && (
              <div className="px-5 py-4 border-b border-border-subtle">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-surface-container-high border border-white/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-white">{userInitial}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">{user.full_name || user.username}</p>
                    <p className="text-xs text-on-surface-variant truncate">{user.role}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="flex-1 py-2 overflow-y-auto">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/')
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-5 py-3.5 text-sm font-medium transition-colors border-l-2',
                      active
                        ? 'bg-white/5 text-white border-l-white'
                        : 'text-white/60 hover:text-white hover:bg-white/5 border-l-transparent',
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
            <div className="p-4 border-t border-border-subtle space-y-2">
              <button
                onClick={() => { setMobileMenuOpen(false); openGeminiPanel({ page: pathname }) }}
                className="w-full bg-primary text-on-primary font-label-md text-label-md py-3 rounded-full"
              >
                Talk to us
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-error hover:bg-error/10 transition-colors"
              >
                <LogOut className="w-4 h-4 flex-shrink-0" />
                Sign Out
              </button>
            </div>
          </nav>
        </div>
      )}

      <main className="flex-1 overflow-y-auto pt-16">
        <div className="max-w-container-max mx-auto px-4 md:px-16 py-8 sm:py-10">
          {children}
        </div>
      </main>
      <GeminiPanel />
    </div>
  )
}
