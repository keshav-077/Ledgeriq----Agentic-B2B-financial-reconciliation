'use client'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Mail, X, ExternalLink, Copy, CheckCircle2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Event ──────────────────────────────────────────────────────────────────────
export const MAGIC_LINK_EVENT = 'lumina:magic_link_island'

export interface MagicLinkItem {
  company_name: string
  portal_url:   string
  email?:       string
}

export interface MagicLinkPayload {
  type:          'single' | 'bulk'
  company_name?: string
  portal_url?:   string
  items?:        MagicLinkItem[]
}

export function fireMagicLinkIsland(payload: MagicLinkPayload) {
  window.dispatchEvent(new CustomEvent(MAGIC_LINK_EVENT, { detail: payload }))
}

// ── Component ──────────────────────────────────────────────────────────────────
export function MagicLinkIsland() {
  const [payload,    setPayload]    = useState<MagicLinkPayload | null>(null)
  const [visible,    setVisible]    = useState(false)
  const [modalOpen,  setModalOpen]  = useState(false)
  const [copied,     setCopied]     = useState<string | null>(null)
  const [mounted,    setMounted]    = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<MagicLinkPayload>).detail
      setPayload(detail)
      setVisible(true)
      setModalOpen(false)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setVisible(false), 9000)
    }
    window.addEventListener(MAGIC_LINK_EVENT, handler)
    return () => { window.removeEventListener(MAGIC_LINK_EVENT, handler); clearTimeout(timerRef.current) }
  }, [])

  function dismiss() {
    clearTimeout(timerRef.current)
    setVisible(false)
    setModalOpen(false)
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).catch(() => {})
    setCopied(url)
    setTimeout(() => setCopied(null), 2000)
  }

  if (!mounted || !visible || !payload) return null

  const isSingle = payload.type === 'single'
  const count    = payload.items?.length ?? 0

  return createPortal(
    <>
      {/* ── Island pill ── */}
      <div className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-[300]',
        'bg-surface-elevated border shadow-2xl rounded-[28px] px-5 py-3.5',
        'animate-in slide-in-from-bottom-4 duration-300',
        'flex items-center gap-3 min-w-[320px] max-w-[520px]',
        'border-white/15',
      )}>
        {/* Icon */}
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <Mail className="w-4 h-4 text-white" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-white truncate">
            {isSingle
              ? `Invitation sent to ${payload.company_name}`
              : `${count} Invitation${count !== 1 ? 's' : ''} Sent`}
          </p>
          {isSingle && payload.portal_url ? (
            <a href={payload.portal_url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-white hover:underline font-mono truncate block mt-0.5 max-w-[260px]">
              {payload.portal_url.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            <p className="text-[10px] text-on-surface-variant mt-0.5">
              Click "View All" to see all portal links
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {isSingle && payload.portal_url && (
            <>
              <a href={payload.portal_url} target="_blank" rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-white hover:bg-white/10 transition-colors"
                title="Open portal">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button onClick={() => copyLink(payload.portal_url!)}
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-white hover:bg-white/10 transition-colors"
                title="Copy link">
                {copied === payload.portal_url
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                  : <Copy className="w-3.5 h-3.5" />}
              </button>
            </>
          )}
          {!isSingle && (
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-white hover:bg-white/10 border border-white/15 transition-colors">
              View All
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button onClick={dismiss}
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Bulk modal ── */}
      {modalOpen && !isSingle && payload.items && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setModalOpen(false)}>
          <div className="bg-surface-elevated rounded-2xl shadow-2xl w-full max-w-[580px] border border-border-subtle overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)' }}>
                  <Mail className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">{count} Invitations Sent</h2>
                  <p className="text-[10px] text-on-surface-variant">Click any link to open the reconciliation portal</p>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Column headers */}
            <div className="grid text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider px-6 py-2.5 bg-white/5 border-b border-border-subtle"
              style={{ gridTemplateColumns: '1fr 165px 72px' }}>
              <span>Company</span>
              <span>Email</span>
              <span className="text-right">Actions</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-border-subtle max-h-[380px] overflow-y-auto">
              {payload.items.map((item, i) => (
                <div key={i} className="grid items-center px-6 py-3 hover:bg-white/5 transition-colors"
                  style={{ gridTemplateColumns: '1fr 165px 72px' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{item.company_name}</p>
                    <p className="text-[10px] text-on-surface-variant font-mono mt-0.5 truncate">
                      …{item.portal_url.split('token=')[1]?.slice(-16) ?? ''}
                    </p>
                  </div>
                  <span className="text-xs text-on-surface-variant truncate px-2">{item.email || '—'}</span>
                  <div className="flex items-center justify-end gap-1">
                    <a href={item.portal_url} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 rounded-lg text-white hover:bg-white/10 transition-colors"
                      title="Open portal">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button onClick={() => copyLink(item.portal_url)}
                      className="p-1.5 rounded-lg text-on-surface-variant hover:text-white hover:bg-white/10 transition-colors"
                      title="Copy link">
                      {copied === item.portal_url
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                        : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-border-subtle bg-white/5/50 flex items-center justify-between">
              <p className="text-[11px] text-on-surface-variant">Links expire in 7 days · Single-use only</p>
              <button onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-on-surface-variant border border-border-subtle rounded-xl hover:bg-white/10 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}