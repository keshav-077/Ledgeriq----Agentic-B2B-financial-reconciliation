'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, Send, Loader2, Sparkles, Database, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chatWithGemini } from '@/lib/api'
import ReactMarkdown from 'react-markdown'

export const GEMINI_EVENT = 'lumina:gemini'

export function openGeminiPanel(opts?: { contextMessage?: string; context?: Record<string, unknown>; page?: string }) {
  window.dispatchEvent(new CustomEvent(GEMINI_EVENT, { detail: opts ?? {} }))
}

type Msg = { role: 'user' | 'assistant'; content: string }

export function GeminiPanel() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('lumina:kb:open_gemini', handler)
    return () => window.removeEventListener('lumina:kb:open_gemini', handler)
  }, [])
  const [messages, setMessages]   = useState<Msg[]>([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]           = useState(false)
  const [context, setContext]           = useState<Record<string, unknown> | undefined>()
  const [page, setPage]                 = useState<string | undefined>()
  const [pendingContext, setPendingContext] = useState<{ label: string; message: string } | null>(null)
  const bottomRef                 = useRef<HTMLDivElement>(null)
  const inputRef                  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setOpen(true)
      if (e.detail.context)  setContext(e.detail.context)
      if (e.detail.page)     setPage(e.detail.page)
      if (e.detail.contextMessage) {
        setPendingContext({
          label:   e.detail.context?.company_name as string
                ?? e.detail.context?.ledger_ref as string
                ?? 'Context',
          message: e.detail.contextMessage,
        })
      }
      setTimeout(() => inputRef.current?.focus(), 100)
    }
    window.addEventListener(GEMINI_EVENT, handler as EventListener)
    return () => window.removeEventListener(GEMINI_EVENT, handler as EventListener)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const fullMessage = pendingContext
      ? `${pendingContext.message}\n\n${text}`
      : text
    const userMsg: Msg = { role: 'user', content: fullMessage }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setPendingContext(null)
    setLoading(true)

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const res = await chatWithGemini({ message: fullMessage, context, history, page })
      setMessages(prev => [...prev, { role: 'assistant', content: res.response }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages, context, page, pendingContext])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const panel = (
    <>
      {open && <div className="fixed inset-0 z-[400] bg-black/40" onClick={() => setOpen(false)} />}

      <div className={cn(
        'fixed top-0 right-0 h-full w-[420px] max-w-[100vw] bg-surface-elevated border-l border-border-subtle shadow-2xl z-[401]',
        'flex flex-col transition-transform duration-300 ease-out',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle bg-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[18px]">auto_awesome</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Ask LedgerIQ</p>
              <p className="text-[10px] text-on-surface-variant">Powered by Gemini · Live data access</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setContext(undefined) }}
                className="text-[10px] text-on-surface-variant hover:text-error transition-colors px-2 py-1 rounded-lg hover:bg-error/10"
              >
                Clear
              </button>
            )}
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-on-surface-variant hover:text-white hover:bg-white/5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {context && (
          <div className="px-4 py-2.5 bg-white/5 border-b border-border-subtle">
            <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <Database className="w-3 h-3" />
              <span className="font-medium text-white">Context loaded:</span>
              <span className="truncate opacity-70">{context.company_name as string || context.type as string || 'Current view'}</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-3">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <p className="text-sm font-medium text-white mb-1">LedgerIQ AI Assistant</p>
              <p className="text-xs text-on-surface-variant max-w-[260px]">
                Ask me anything about your reconciliations, discrepancies, or company balances. I have access to your live data.
              </p>
              <div className="mt-4 flex flex-col gap-2 w-full max-w-[280px]">
                {[
                  'How many discrepancies are pending approval?',
                  'What are the most common discrepancy types?',
                  'Summarize this company\'s reconciliation status',
                ].map(s => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="text-left text-xs bg-white/5 hover:bg-white/10 border border-border-subtle text-on-surface-variant hover:text-white px-3 py-2 rounded-xl transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">
                  <Sparkles className="w-3 h-3 text-white" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                  msg.role === 'user'
                    ? 'text-on-primary rounded-br-sm bg-primary'
                  : 'bg-white/5 border border-border-subtle text-on-surface rounded-bl-sm',
              )}>
                {msg.role === 'assistant'
                  ? <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-headings:my-1">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  : msg.content
                }
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">
                <Sparkles className="w-3 h-3 text-white" />
              </div>
              <div className="bg-white/5 border border-border-subtle rounded-2xl rounded-bl-sm px-4 py-3">
                <Loader2 className="w-4 h-4 text-white animate-spin" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="px-4 py-3 border-t border-border-subtle bg-surface-elevated">
          {pendingContext && (
            <div className="flex items-center gap-2 bg-white/5 border border-border-subtle rounded-xl px-3 py-2 mb-2">
              <div className="w-6 h-6 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center flex-shrink-0">
                <Database className="w-3 h-3 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white truncate">{pendingContext.label}</p>
                <p className="text-[10px] text-on-surface-variant">Context attached · will be sent with your message</p>
              </div>
              <button onClick={() => setPendingContext(null)} className="p-0.5 rounded text-on-surface-variant hover:text-white transition-colors flex-shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2 bg-surface-container border border-border-subtle rounded-2xl px-4 py-2.5 focus-within:border-primary transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about your data…"
              rows={1}
              className="flex-1 text-sm text-on-surface placeholder:text-on-surface-variant/50 bg-transparent outline-none resize-none max-h-32"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className="p-1.5 rounded-xl bg-primary text-on-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-on-surface-variant mt-1.5 text-center">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </>
  )

  return typeof window !== 'undefined' ? createPortal(panel, document.body) : null
}
