'use client'
import { useState, useEffect, useRef } from 'react'
import {
  X, Loader2, CheckCircle2, AlertCircle,
  ArrowUpRight, Database, Brain, Mail, Cpu,
  Building2, Download, Search, Bot, Sparkles,
  ChevronRight, Minus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { AGENT_EVENT } from './AgentIsland'

interface Step { type: string; message: string; timestamp: string }

interface RunState {
  phase: 'hidden' | 'running' | 'done' | 'error'
  runId: string | null
  found: number
  steps: Step[]
  currentStepType: string
}

const STEP_CONFIG: Record<string, { icon: JSX.Element; agent: string }> = {
  loading_companies:     { icon: <Building2    className="w-3.5 h-3.5 text-purple-500" />, agent: 'orchestrator'   },
  fetching_ledgers:      { icon: <Download     className="w-3.5 h-3.5 text-secondary"   />, agent: 'reconciliation' },
  comparing_records:     { icon: <Search       className="w-3.5 h-3.5 text-secondary"   />, agent: 'reconciliation' },
  analyzing_discrepancy: { icon: <Bot          className="w-3.5 h-3.5 text-amber-500"  />, agent: 'analysis'       },
  complete:              { icon: <CheckCircle2 className="w-3.5 h-3.5 text-white" />, agent: 'orchestrator'  },
  generating_embeddings: { icon: <Sparkles     className="w-3.5 h-3.5 text-purple-500" />, agent: 'orchestrator'   },
}

const AGENTS = [
  { id: 'orchestrator',   name: 'orchestrator',           desc: 'Coordinates the full pipeline',           icon: <Cpu      className="w-3 h-3" /> },
  { id: 'reconciliation', name: 'reconciliation_agent',   desc: 'Fetches & compares ledgers via MCP',      icon: <Database className="w-3 h-3" /> },
  { id: 'analysis',       name: 'analysis_agent',         desc: 'Root-cause analysis via Gemini 3 Flash',  icon: <Brain    className="w-3 h-3" /> },
  { id: 'communication',  name: 'communication_agent',    desc: 'Drafts professional resolution emails',   icon: <Mail     className="w-3 h-3" /> },
]

export function AgentExecutionPanel() {
  const [state, setState] = useState<RunState>({
    phase: 'hidden', runId: null, found: 0, steps: [], currentStepType: ''
  })
  const [visible, setVisible] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const panelRef    = useRef<HTMLDivElement>(null)
  const [collapsed,  setCollapsed]  = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragPosRef  = useRef({ x: 20, y: 80 })
  const [mounted,    setMounted]    = useState(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, a')) return
    e.preventDefault()
    setIsDragging(true)
    
    const startX = e.clientX - dragPosRef.current.x
    const startY = e.clientY - dragPosRef.current.y
    const widthOffset = collapsed ? 260 : 400

    const onMove = (me: MouseEvent) => {
      const nx = Math.max(0, Math.min(window.innerWidth - widthOffset, me.clientX - startX))
      const ny = Math.max(0, Math.min(window.innerHeight - 60, me.clientY - startY))
      dragPosRef.current = { x: nx, y: ny }
      if (panelRef.current) {
        panelRef.current.style.left = `${nx}px`
        panelRef.current.style.top  = `${ny}px`
      }
    }
    
    const onUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      try { localStorage.setItem('lumina_panel_pos', JSON.stringify(dragPosRef.current)) } catch { /* ignore */ }
    }
    
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setState({ phase: 'running', runId: e.detail.runId, found: 0, steps: [], currentStepType: 'loading_companies' })
      setVisible(true)
    }
    window.addEventListener(AGENT_EVENT, handler as EventListener)
    return () => window.removeEventListener(AGENT_EVENT, handler as EventListener)
  }, [])

  useEffect(() => {
    if (state.phase !== 'running' || !state.runId) return
    intervalRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/v1/reconciliation/status/${state.runId}`)
        const steps: Step[] = data.steps || []
        const currentStepType = steps.length > 0 ? steps[steps.length - 1].type : 'loading_companies'
        if (data.status === 'completed') {
          setState(s => ({ ...s, phase: 'done', found: data.discrepancies_found ?? 0, steps, currentStepType: 'complete' }))
          if (intervalRef.current) clearInterval(intervalRef.current)
          setTimeout(() => setVisible(false), 15_000)
        } else if (data.status === 'failed') {
          setState(s => ({ ...s, phase: 'error', steps, currentStepType: 'error' }))
          if (intervalRef.current) clearInterval(intervalRef.current)
        } else {
          setState(s => ({ ...s, steps, currentStepType }))
        }
      } catch { /* ignore */ }
    }, 1200)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [state.phase, state.runId])

  // Init position from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('lumina_panel_pos')
      if (saved) { dragPosRef.current = JSON.parse(saved) }
      else { dragPosRef.current = { x: window.innerWidth - 424, y: 80 } }
    } catch { 
      dragPosRef.current = { x: window.innerWidth - 424, y: 80 }
    }
    if (panelRef.current) {
      panelRef.current.style.left = `${dragPosRef.current.x}px`
      panelRef.current.style.top  = `${dragPosRef.current.y}px`
    }
    setMounted(true)
  }, [])

  const activeAgent = STEP_CONFIG[state.currentStepType]?.agent || 'orchestrator'
  const progress = Math.min(Math.round((state.steps.length / 7) * 100), state.phase === 'done' ? 100 : 95)

  const getAgentStatus = (id: string): 'active' | 'done' | 'waiting' => {
    if (state.phase === 'done') return 'done'
    if (id === activeAgent && state.phase === 'running') return 'active'
    const hadSteps = Object.entries(STEP_CONFIG)
      .filter(([, v]) => v.agent === id)
      .some(([k]) => state.steps.some(s => s.type === k))
    return hadSteps ? 'done' : 'waiting'
  }

  if (!visible) return null

  if (collapsed) return (
    <div
      ref={panelRef}
      className="fixed z-[150] bg-surface-elevated border border-border-subtle rounded-2xl shadow-xl animate-in fade-in duration-200"
      style={{ left: dragPosRef.current.x, top: dragPosRef.current.y, width: 260, maxWidth: 'calc(100vw - 32px)', visibility: mounted ? 'visible' : 'hidden' }}
    >
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'flex items-center justify-between px-3 py-2.5 rounded-2xl cursor-grab active:cursor-grabbing select-none',
          state.phase === 'running' && 'bg-white/5',
          state.phase === 'done'    && 'bg-white/5',
          state.phase === 'error'   && 'bg-error/10',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0',
            state.phase === 'running' && 'bg-white/10',
            state.phase === 'done'    && 'bg-white/10',
            state.phase === 'error'   && 'bg-error/15',
          )}>
            {state.phase === 'running' && <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />}
            {state.phase === 'done'    && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
            {state.phase === 'error'   && <AlertCircle className="w-3.5 h-3.5 text-error" />}
          </div>
          <p className={cn(
            'text-xs font-bold truncate',
            state.phase === 'running' && 'text-white',
            state.phase === 'done'    && 'text-white',
            state.phase === 'error'   && 'text-error',
          )}>
            {state.phase === 'running' && 'Agent Running…'}
            {state.phase === 'done'    && `Done — ${state.found} issue${state.found !== 1 ? 's' : ''}`}
            {state.phase === 'error'   && 'Agent Failed'}
          </p>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={() => setCollapsed(false)} onMouseDown={(e) => e.stopPropagation()} title="Expand"
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition-colors">
            <ChevronRight className="w-3.5 h-3.5 -rotate-90" />
          </button>
          <button onClick={() => setVisible(false)} onMouseDown={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div
      ref={panelRef}
      className="fixed z-[150] bg-surface-elevated border border-border-subtle rounded-2xl shadow-2xl flex flex-col animate-in fade-in duration-300"
      style={{ left: dragPosRef.current.x, top: dragPosRef.current.y, width: 400, maxWidth: 'calc(100vw - 32px)', willChange: isDragging ? 'left, top' : 'auto', visibility: mounted ? 'visible' : 'hidden' }}
    >
      {/* Header */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'flex items-center justify-between px-4 py-3.5 rounded-t-2xl border-b border-border-subtle',
          'cursor-grab active:cursor-grabbing select-none',
          state.phase === 'running' && 'bg-white/5',
          state.phase === 'done'    && 'bg-white/5',
          state.phase === 'error'   && 'bg-error/10',
        )}
      >
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
            state.phase === 'running' && 'bg-white/10',
            state.phase === 'done'    && 'bg-white/10',
            state.phase === 'error'   && 'bg-error/15',
          )}>
            {state.phase === 'running' && <Loader2 className="w-4 h-4 text-white animate-spin" />}
            {state.phase === 'done'    && <CheckCircle2 className="w-4 h-4 text-white" />}
            {state.phase === 'error'   && <AlertCircle className="w-4 h-4 text-error" />}
          </div>
          <div>
            <p className={cn(
              'text-xs font-bold',
              state.phase === 'running' && 'text-white',
              state.phase === 'done'    && 'text-white',
              state.phase === 'error'   && 'text-error',
            )}>
              {state.phase === 'running' && 'AI Agent Running'}
              {state.phase === 'done'    && `Complete — ${state.found} discrepanc${state.found === 1 ? 'y' : 'ies'} found`}
              {state.phase === 'error'   && 'Agent Run Failed'}
            </p>
            <p className="text-[10px] text-on-surface-variant font-mono mt-0.5">
              run_id: {state.runId?.slice(0, 16)}…
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={() => setCollapsed(true)} onMouseDown={(e) => e.stopPropagation()} title="Minimize"
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition-colors">
            <Minus className="w-4 h-4" />
          </button>
          <button onClick={() => setVisible(false)} onMouseDown={(e) => e.stopPropagation()} title="Close"
            className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-3 pb-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-on-surface-variant font-medium uppercase tracking-wider">Pipeline Progress</span>
          <span className="text-[10px] text-on-surface-variant font-mono font-medium">{progress}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              state.phase === 'done'  ? 'bg-surface-elevated' : 'bg-surface-elevated',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* ADK Agent Pipeline */}
      <div className="px-4 py-3 border-b border-border-subtle">
        <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-2.5 font-medium">
          ADK Multi-Agent Pipeline
        </p>
        <div className="space-y-1">
          {AGENTS.map((agent, idx) => {
            const status = getAgentStatus(agent.id)
            return (
              <div key={agent.id} className="flex items-center gap-2">
                {/* Timeline connector */}
                <div className="flex flex-col items-center w-5 flex-shrink-0">
                  {idx > 0 && <div className="w-px h-1.5 bg-slate-200" />}
                  <div className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300',
                    status === 'active'  && 'bg-white/10 ring-2 ring-white/40 ring-offset-1',
                    status === 'done'    && 'bg-white/10',
                    status === 'waiting' && 'bg-white/10',
                  )}>
                    {status === 'active'  && <Loader2 className="w-3 h-3 text-white animate-spin" />}
                    {status === 'done'    && <CheckCircle2 className="w-3 h-3 text-white" />}
                    {status === 'waiting' && <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />}
                  </div>
                </div>

                {/* Agent card */}
                <div className={cn(
                  'flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-xl transition-all duration-300',
                  status === 'active'  && 'bg-white/5 border border-white/15',
                  status === 'done'    && 'bg-white/5 border border-border-subtle',
                  status === 'waiting' && 'opacity-35',
                )}>
                  <span className={cn(
                    'flex-shrink-0 transition-colors',
                    status === 'active' ? 'text-white' : status === 'done' ? 'text-white' : 'text-on-surface-variant',
                  )}>
                    {agent.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn(
                      'text-[11px] font-semibold font-mono truncate',
                      status === 'active' ? 'text-white' : status === 'done' ? 'text-on-surface' : 'text-on-surface-variant',
                    )}>
                      {agent.name}
                    </p>
                    {status === 'active' && (
                      <p className="text-[10px] text-secondary truncate mt-0.5">{agent.desc}</p>
                    )}
                  </div>
                  {status === 'active' && (
                    <div className="flex gap-0.5 ml-auto flex-shrink-0">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="w-1 h-1 rounded-full bg-surface-elevated animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Execution Log */}
      <div className="px-4 py-3 max-h-[180px] overflow-y-auto">
        <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-2 font-medium">
          Execution Log
        </p>
        {state.steps.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-on-surface-variant py-1">
            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
            Initializing agent pipeline via MCP...
          </div>
        ) : (
          <div className="space-y-2">
            {state.steps.map((step, i) => {
              const config = STEP_CONFIG[step.type]
              const isLast = i === state.steps.length - 1
              return (
                <div key={i} className={cn(
                  'flex items-start gap-2 transition-all duration-200',
                  isLast && state.phase === 'running' ? 'opacity-100' : 'opacity-55',
                )}>
                  <span className="flex-shrink-0 mt-0.5">{config?.icon ?? <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant" />}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      'text-xs leading-snug',
                      isLast && state.phase === 'running' ? 'text-white font-medium' : 'text-on-surface-variant',
                    )}>
                      {step.message}
                    </p>
                    <p className="text-[10px] text-on-surface-variant/70 font-mono mt-0.5">
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                  {isLast && state.phase === 'running' && (
                    <Loader2 className="w-3 h-3 text-secondary animate-spin flex-shrink-0 mt-0.5" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {state.phase === 'done' && (
        <div className="px-4 pb-4 pt-2 border-t border-border-subtle">
          
            <a href="/reports" onMouseDown={(e) => e.stopPropagation()} className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-semibold text-white hover:bg-white/5 rounded-xl transition-colors border border-white/10">
            View Full Run in Reports <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </div>
  )
}