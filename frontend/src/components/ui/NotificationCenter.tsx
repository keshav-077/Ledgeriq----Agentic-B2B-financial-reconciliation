'use client'
import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bell, AlertTriangle, CheckCircle2, X,
  ExternalLink, Zap, Clock,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { getCompanies } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Disc {
  id: string
  company_a_id: string
  company_b_id: string
  ledger_ref: string
  discrepancy_type: string
  difference: number
  status: string
  detected_at: string
}

const TYPE_LABEL: Record<string, string> = {
  amount_mismatch: 'Amount Mismatch',
  missing_record:  'Missing Record',
  date_mismatch:   'Date Mismatch',
  duplicate:       'Duplicate Entry',
}

const STATUS_PILL: Record<string, string> = {
  awaiting_approval: 'bg-white/10 text-white border-white/20',
  email_sent:        'bg-white/5 text-secondary border-white/10',
  resolved:          'bg-white/5 text-on-surface-variant border-white/10',
}

const STORAGE_KEY = 'lumina_notif_read'

function loadRead(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')) }
  catch { return new Set() }
}
function saveRead(s: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...s])) } catch {}
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotificationCenter() {
  const ref  = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [read, setRead]  = useState<Set<string>>(new Set())

  useEffect(() => { setRead(loadRead()) }, [])

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const { data: discs = [] } = useQuery<Disc[]>({
    queryKey: ['discrepancies-notif'],
    queryFn: () => api.get('/api/v1/discrepancies/').then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies'],
    queryFn: () => getCompanies() as Promise<{ id: string; name: string }[]>,
    staleTime: 60_000,
  })

  const cMap = Object.fromEntries(companies.map(c => [c.id, c.name]))

  // Only active (non-resolved) discrepancies as notifications
  const notifs = discs
    .filter(d => d.status !== 'resolved')
    .slice(0, 25)
    .map(d => ({
      id:     d.id,
      title:  TYPE_LABEL[d.discrepancy_type] ?? 'Discrepancy',
      company: cMap[d.company_b_id] || `ID …${d.company_b_id?.slice(-6)}`,
      amount: d.difference
        ? `$${d.difference.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        : '',
      ref:    d.ledger_ref,
      status: d.status,
      time:   d.detected_at,
      read:   read.has(d.id),
    }))

  const unread = notifs.filter(n => !n.read).length

  function markOne(id: string) {
    const next = new Set(read); next.add(id); setRead(next); saveRead(next)
  }
  function markAll() {
    const next = new Set(notifs.map(n => n.id)); setRead(next); saveRead(next)
  }

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'relative p-2 rounded-xl transition-colors',
          open
            ? 'bg-white/10 text-white'
            : 'text-white/60 hover:text-white hover:bg-white/5',
        )}
        title="Notifications"
      >
        <Bell className={cn('w-5 h-5', unread > 0 && 'text-white')} />
        {unread > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-error rounded-full ring-2 ring-background flex items-center justify-center animate-in zoom-in duration-200">
            <span className="text-[9px] font-bold text-white leading-none">
              {unread > 9 ? '9+' : unread}
            </span>
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] bg-surface-elevated border border-border-subtle rounded-2xl shadow-glass z-[1000] overflow-hidden animate-in zoom-in-95 fade-in duration-150 origin-top-right">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-white" />
              <h3 className="text-sm font-bold text-white">Notifications</h3>
              {unread > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-error/15 text-error">
                  {unread} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="text-[11px] text-white/70 hover:text-white font-semibold px-2 transition-colors"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-on-surface-variant hover:text-white hover:bg-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[420px] overflow-y-auto overscroll-contain">
            {notifs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <div className="relative mb-4">
                  <span className="absolute inset-0 rounded-full animate-ping bg-white/10" />
                  <div className="relative w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7 text-white" />
                  </div>
                </div>
                <p className="text-sm font-bold text-white mb-1">All clear!</p>
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  No active discrepancies.<br />All accounts are reconciled.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {notifs.map(n => (
                  <Link
                    key={n.id}
                    href="/discrepancies"
                    onClick={() => { markOne(n.id); setOpen(false) }}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3.5 hover:bg-white/5 transition-colors group',
                      !n.read && 'bg-white/[0.04]',
                    )}
                  >
                    {/* Status icon */}
                    <div className={cn(
                      'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5',
                      n.status === 'awaiting_approval' ? 'bg-white/10' : 'bg-white/5',
                    )}>
                      <AlertTriangle className={cn(
                        'w-4 h-4',
                        n.status === 'awaiting_approval' ? 'text-white' : 'text-on-surface-variant',
                      )} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className={cn(
                            'text-xs font-bold leading-snug',
                            !n.read ? 'text-white' : 'text-on-surface-variant',
                          )}>
                            {n.title}
                          </p>
                          <p className="text-xs text-on-surface-variant truncate mt-0.5 font-medium">
                            {n.company}
                            {n.amount && (
                              <span className="text-error font-bold"> · {n.amount}</span>
                            )}
                          </p>
                          {n.ref && (
                            <p className="text-[10px] text-on-surface-variant/70 font-mono mt-0.5 truncate">
                              ref: {n.ref}
                            </p>
                          )}
                        </div>
                        {/* Unread dot */}
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-surface-elevated flex-shrink-0 mt-1.5" />
                        )}
                      </div>

                      {/* Meta */}
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={cn(
                          'text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide',
                          STATUS_PILL[n.status] ?? 'bg-white/5 text-on-surface-variant border-white/10',
                        )}>
                          {n.status.replace(/_/g, ' ')}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                          <Clock className="w-2.5 h-2.5" />
                          {timeAgo(n.time)}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-border-subtle bg-white/[0.03] flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
              <Zap className="w-3 h-3 text-white" />
              <span>Auto-refreshes every 30s</span>
            </div>
            <Link
              href="/discrepancies"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-xs font-bold text-white hover:text-white/70 transition-colors"
            >
              View all
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}