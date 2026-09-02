'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, X, Building2, AlertTriangle, FileSpreadsheet,
  Loader2, Sparkles, ChevronRight, ArrowUpRight,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { globalSearch } from '@/lib/api'

type ResultItem = {
  id: string
  type: 'company' | 'discrepancy' | 'balance'
  title: string
  subtitle: string
  meta: string
  snippet?: string
  score?: number
  is_own?: boolean
}

type SearchResults = {
  companies: ResultItem[]
  discrepancies: ResultItem[]
  balances: ResultItem[]
  vector_used: boolean
}

const SECTION_META: Record<string, { label: string; icon: React.ReactNode; href: string; color: string }> = {
  company:     { label: 'Counterparties',      icon: <Building2 className="w-3.5 h-3.5" />,     href: '/counterparties',  color: 'text-white' },
  discrepancy: { label: 'Discrepancies',        icon: <AlertTriangle className="w-3.5 h-3.5" />, href: '/discrepancies',   color: 'text-error' },
  balance:     { label: 'Reconciliation List',  icon: <FileSpreadsheet className="w-3.5 h-3.5" />, href: '/reconciliations', color: 'text-secondary' },
}

export function GlobalSearch() {
  const [open, setOpen]         = useState(false)
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<SearchResults | null>(null)
  const [loading, setLoading]   = useState(false)
  const [focused, setFocused]     = useState(-1)
  const [recentSearches, setRecentSearches] = useState<string[]>([])

  useEffect(() => {
    const stored = localStorage.getItem('lumina_recent_searches')
    if (stored) setRecentSearches(JSON.parse(stored))
  }, [open])
  const inputRef                = useRef<HTMLInputElement>(null)
  const timerRef                = useRef<ReturnType<typeof setTimeout>>()
  const router                  = useRouter()

  const allItems: ResultItem[] = results
    ? [...results.companies, ...results.discrepancies, ...results.balances]
    : []
  const hasResults = allItems.length > 0

  // Open / close
  const openSearch  = useCallback(() => { setOpen(true); setQuery(''); setResults(null) }, [])
  const closeSearch = useCallback(() => { setOpen(false); setQuery(''); setResults(null); setFocused(-1) }, [])

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); open ? closeSearch() : openSearch() }
      if (e.key === 'Escape') closeSearch()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, openSearch, closeSearch])

  // Blur page content when open
  useEffect(() => {
    const header = document.querySelector('header')
    const main   = document.querySelector('main')
    if (open) {
      if (header) (header as HTMLElement).style.filter = 'blur(4px)'
      if (main)   (main   as HTMLElement).style.filter = 'blur(4px)'
      document.body.style.overflow = 'hidden'
    } else {
      if (header) (header as HTMLElement).style.filter = ''
      if (main)   (main   as HTMLElement).style.filter = ''
      document.body.style.overflow = ''
    }
    return () => {
      if (header) (header as HTMLElement).style.filter = ''
      if (main)   (main   as HTMLElement).style.filter = ''
      document.body.style.overflow = ''
    }
  }, [open])

  // Focus input when opened
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])

  // Debounced search
  useEffect(() => {
    clearTimeout(timerRef.current)
    if (!query.trim()) { setResults(null); setLoading(false); return }
    setLoading(true)
    timerRef.current = setTimeout(async () => {
      try {
        const data = await globalSearch(query)
        setResults(data)
      } catch { setResults(null) }
      finally { setLoading(false) }
    }, 350)
    return () => clearTimeout(timerRef.current)
  }, [query])

  // Keyboard nav
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f + 1, allItems.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f - 1, -1)) }
    if (e.key === 'Enter' && focused >= 0) navigate(allItems[focused])
  }

  function saveSearch(q: string) {
    if (!q.trim()) return
    const updated = [q, ...recentSearches.filter(s => s !== q)].slice(0, 5)
    setRecentSearches(updated)
    localStorage.setItem('lumina_recent_searches', JSON.stringify(updated))
  }

  function navigate(item: ResultItem) {
    saveSearch(query)
    const meta = SECTION_META[item.type]
    router.push(meta.href)
    closeSearch()
  }

  const overlay = open ? (
    <div className="fixed inset-0 z-[500]" onClick={closeSearch}>
      {/* Backdrop */}
      <div className="absolute inset-0 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="absolute inset-0 flex flex-col items-center pointer-events-none"
        style={{ paddingTop: hasResults ? '80px' : '40vh' }}
      >
      <div
        className="w-full max-w-2xl px-4 pointer-events-auto transition-all duration-300 ease-out"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className={cn(
          'flex items-center gap-3 px-4 py-3.5 bg-surface-elevated rounded-2xl shadow-glass border border-border-subtle',
          'transition-all duration-300',
          hasResults && 'rounded-b-none border-b-border-subtle',
        )}>
          {loading
            ? <Loader2 className="w-5 h-5 text-on-surface-variant animate-spin flex-shrink-0" />
            : <Search className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setFocused(-1) }}
            onKeyDown={handleKeyDown}
            placeholder="Search companies, discrepancies, balances…"
            className="flex-1 text-sm text-on-surface placeholder:text-on-surface-variant/50 outline-none bg-transparent"
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            {results?.vector_used && (
              <span className="flex items-center gap-1 text-[10px] bg-white/10 text-white border border-white/15 px-2 py-0.5 rounded-full font-medium">
                <Sparkles className="w-2.5 h-2.5" /> Semantic
              </span>
            )}
            <kbd className="hidden sm:block text-[10px] bg-white/5 text-on-surface-variant px-1.5 py-0.5 rounded border border-border-subtle font-mono">ESC</kbd>
            <button onClick={closeSearch} className="p-1 rounded-lg text-on-surface-variant hover:text-white hover:bg-white/5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Recent Searches */}
        {!query && !results && recentSearches.length > 0 && (
          <div className="bg-surface-elevated rounded-b-2xl border border-t-0 border-border-subtle shadow-glass overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-border-subtle">
              <span className="text-xs font-semibold text-on-surface-variant">Recent Searches</span>
              <button
                onClick={() => {
                  setRecentSearches([])
                  localStorage.removeItem('lumina_recent_searches')
                }}
                className="text-[10px] text-on-surface-variant hover:text-error transition-colors"
              >
                Clear
              </button>
            </div>
            {recentSearches.map((s, i) => (
              <button
                key={i}
                onClick={() => setQuery(s)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors border-b border-border-subtle last:border-0"
              >
                <Search className="w-3.5 h-3.5 text-on-surface-variant flex-shrink-0" />
                <span className="text-sm text-on-surface">{s}</span>
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="bg-surface-elevated rounded-b-2xl border border-t-0 border-border-subtle shadow-glass overflow-hidden max-h-[60vh] overflow-y-auto">
            {!hasResults && !loading && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-8">
                <Search className="w-8 h-8 text-on-surface-variant mb-3" />
                <p className="text-sm font-medium text-on-surface">No results for "{query}"</p>
                <p className="text-xs text-on-surface-variant mt-1">Try different keywords or a shorter phrase</p>
              </div>
            )}

            {(['companies', 'discrepancies', 'balances'] as const).map(key => {
              const items = results[key] as ResultItem[]
              if (!items.length) return null
              const sectionType = key === 'companies' ? 'company' : key === 'discrepancies' ? 'discrepancy' : 'balance'
              const meta = SECTION_META[sectionType]
              return (
                <div key={key}>
                  {/* Section header */}
                  <div className="flex items-center gap-2 px-4 py-2 bg-white/5 border-b border-border-subtle">
                    <span className={cn('flex items-center gap-1.5 text-xs font-semibold', meta.color)}>
                      {meta.icon}
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-slate-400">({items.length})</span>
                  </div>

                  {/* Items */}
                  {items.map((item, idx) => {
                    const globalIdx = allItems.indexOf(item)
                    const isFocused = globalIdx === focused
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item)}
                        className={cn(
                          'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors border-b border-border-subtle last:border-0',
                          isFocused ? 'bg-white/10' : 'hover:bg-white/5',
                        )}
                      >
                        {/* Icon */}
                        <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 border',
                          sectionType === 'company'     && 'bg-white/10 border-white/10 text-white',
                          sectionType === 'discrepancy' && 'bg-error/10 border-error/20 text-error',
                          sectionType === 'balance'     && 'bg-white/5 border-white/10 text-secondary',
                        )}>
                          {meta.icon}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Breadcrumb */}
                          <div className={cn('flex items-center gap-1 text-[10px] font-medium mb-0.5', meta.color)}>
                            {meta.label}
                            <ChevronRight className="w-2.5 h-2.5" />
                            <span className="text-on-surface-variant font-mono">{item.title}</span>
                          </div>
                          {/* Title */}
                          <p className="text-sm font-semibold text-on-surface truncate">{item.title}</p>
                          {/* Subtitle + meta */}
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-on-surface-variant truncate">{item.subtitle}</span>
                            {item.meta && (
                              <span className="text-[10px] bg-white/10 text-on-surface-variant px-1.5 py-0.5 rounded-full">{item.meta}</span>
                            )}
                            {item.score && (
                              <span className="text-[10px] bg-white/10 text-white px-1.5 py-0.5 rounded-full font-mono">
                                {(item.score * 100).toFixed(0)}% match
                              </span>
                            )}
                          </div>
                          {/* AI snippet */}
                          {item.snippet && (
                            <p className="text-xs text-on-surface-variant mt-1 line-clamp-1 italic">"{item.snippet}"</p>
                          )}
                        </div>

                        <ArrowUpRight className="w-4 h-4 text-on-surface-variant flex-shrink-0 mt-1" />
                      </button>
                    )
                  })}
                </div>
              )
            })}

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-t border-border-subtle">
              <span className="text-[10px] text-on-surface-variant">↑↓ navigate · Enter select · Esc close</span>
              {results.vector_used && (
                <span className="text-[10px] text-white/70 flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" /> Powered by semantic vector search
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  ) : null

  return (
    <>
      <button
        onClick={openSearch}
        className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        title="Search (⌘K)"
      >
        <span className="material-symbols-outlined">search</span>
      </button>
      {typeof window !== 'undefined' && overlay
        ? createPortal(overlay, document.body)
        : null}
    </>
  )
}