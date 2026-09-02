'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  X, Search, Plus, BarChart2, LayoutDashboard,
  Users, Zap, FileText, Keyboard,
} from 'lucide-react'

export const KB_NEW_COUNTERPARTY = 'lumina:kb:new_counterparty'
export const KB_OPEN_GEMINI      = 'lumina:kb:open_gemini'

function isTyping() {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return (
    ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) ||
    el.isContentEditable ||
    el.closest('[role="dialog"]') !== null
  )
}

export function KeyboardShortcutOverlay() {
  const router   = useRouter()
  const [open, setOpen] = useState(false)

  const handle = useCallback((e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    const inInput = isTyping()

    // / → toggle overlay (no shift, no input focus)
    if (e.key === '/' && !inInput && !meta) {
      e.preventDefault(); setOpen(o => !o); return
    }
    // Esc → close
    if (e.key === 'Escape') { setOpen(false); return }

    // Cmd+K → search (GlobalSearch already handles it)
    if (meta && e.key === 'k') { setOpen(false); return }

    // Cmd+N → new counterparty
    if (meta && e.key === 'n') {
      e.preventDefault()
      router.push('/counterparties')
      setTimeout(() => window.dispatchEvent(new CustomEvent(KB_NEW_COUNTERPARTY)), 150)
      setOpen(false); return
    }

    // Single key shortcuts (not in input, not holding Ctrl/Cmd/Alt/Shift)
    if (!inInput && !meta && !e.shiftKey && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'd': e.preventDefault(); router.push('/dashboard');       setOpen(false); break
        case 'c': e.preventDefault(); router.push('/counterparties');  setOpen(false); break
        case 'r': e.preventDefault(); router.push('/reports');         setOpen(false); break
        case 'i': e.preventDefault(); router.push('/integrations');    setOpen(false); break
        case 'l':
          e.preventDefault()
          window.dispatchEvent(new CustomEvent(KB_OPEN_GEMINI))
          setOpen(false); break
      }
    }
  }, [router])

  useEffect(() => {
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [handle])

  if (!open) return null

  const sections = [
    {
      title: 'Navigate',
      items: [
        { keys: ['D'],     label: 'Dashboard',         icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
        { keys: ['C'],     label: 'Counterparties',    icon: <Users           className="w-3.5 h-3.5" /> },
        { keys: ['R'],     label: 'Reports',           icon: <BarChart2       className="w-3.5 h-3.5" /> },
        { keys: ['I'],     label: 'Integrations',      icon: <Zap             className="w-3.5 h-3.5" /> },
      ],
    },
    {
      title: 'Actions',
      items: [
        { keys: ['⌘', 'K'], label: 'Global Search',      icon: <Search  className="w-3.5 h-3.5" /> },
        { keys: ['⌘', 'N'], label: 'New Counterparty',   icon: <Plus    className="w-3.5 h-3.5" /> },
        { keys: ['L'],       label: 'Ask LedgerIQ',      icon: <Zap     className="w-3.5 h-3.5 text-white" /> },
      ],
    },
    {
      title: 'General',
      items: [
        { keys: ['/'],   label: 'Toggle Shortcuts',  icon: <Keyboard  className="w-3.5 h-3.5" /> },
        { keys: ['Esc'], label: 'Close / Cancel',    icon: <X         className="w-3.5 h-3.5" /> },
      ],
    },
  ]

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-surface-elevated border border-border-subtle rounded-2xl w-full max-w-[420px] shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-white" />
            <div>
              <h2 className="text-sm font-bold text-white">Keyboard Shortcuts</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Press{' '}
                <kbd className="px-1.5 py-0.5 bg-white/10 border border-border-subtle rounded text-[10px] font-mono font-semibold">
                  /
                </kbd>{' '}
                to toggle
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Shortcut list */}
        <div className="px-5 py-4 space-y-5">
          {sections.map(section => (
            <div key={section.title}>
              <p className="text-[10px] text-on-surface-variant font-semibold uppercase tracking-widest mb-2">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-2 text-sm text-on-surface">
                      <span className="text-on-surface-variant flex-shrink-0">{item.icon}</span>
                      {item.label}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {item.keys.map((k, ki) => (
                        <span key={ki} className="flex items-center gap-1">
                          <kbd className="px-2 py-1 bg-white/10 border border-border-subtle rounded-lg text-[11px] font-mono font-bold text-on-surface-variant shadow-sm min-w-[28px] text-center">
                            {k}
                          </kbd>
                          {ki < item.keys.length - 1 && (
                            <span className="text-on-surface-variant/70 text-[10px]">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 pb-4 pt-1 border-t border-border-subtle">
          <p className="text-[10px] text-on-surface-variant text-center">
            Shortcuts disabled while typing in input fields
          </p>
        </div>
      </div>
    </div>
  )
}