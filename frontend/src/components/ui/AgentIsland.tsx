'use client'
import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'

type Phase = 'hidden' | 'running' | 'done' | 'error'

interface Step { type: string; message: string; timestamp: string }
interface State { phase: Phase; runId: string | null; found: number; currentStep: string; steps: Step[] }

export const AGENT_EVENT = 'lumina:agent'

export function fireAgentIsland(runId: string) {
  window.dispatchEvent(new CustomEvent(AGENT_EVENT, { detail: { runId } }))
}

export function AgentIsland() {
  const [state, setState] = useState<State>({
    phase: 'hidden', runId: null, found: 0, currentStep: 'Initializing...', steps: []
  })

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setState({ phase: 'running', runId: e.detail.runId, found: 0, currentStep: 'Starting agent...', steps: [] })
    }
    window.addEventListener(AGENT_EVENT, handler as EventListener)
    return () => window.removeEventListener(AGENT_EVENT, handler as EventListener)
  }, [])

  useEffect(() => {
    if (state.phase !== 'running' || !state.runId) return
    const id = setInterval(async () => {
      try {
        const { data } = await api.get(`/api/v1/reconciliation/status/${state.runId}`)
        const steps: Step[] = data.steps || []
        const currentStep = steps.length > 0 ? steps[steps.length - 1].message : 'Processing...'
        if (data.status === 'completed') {
          setState(s => ({ ...s, phase: 'done', found: data.discrepancies_found ?? 0, currentStep: 'Complete', steps }))
          clearInterval(id)
          setTimeout(() => setState(s => ({ ...s, phase: 'hidden' })), 6000)
        } else if (data.status === 'failed') {
          setState(s => ({ ...s, phase: 'error', currentStep: 'Run failed', steps }))
          clearInterval(id)
          setTimeout(() => setState(s => ({ ...s, phase: 'hidden' })), 4000)
        } else {
          setState(s => ({ ...s, currentStep, steps }))
        }
      } catch { /* ignore */ }
    }, 1500)
    return () => clearInterval(id)
  }, [state.phase, state.runId])

  if (state.phase === 'hidden') return null

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 z-[200] flex items-center mb-8">
      <div className={cn(
        'bg-white/10 rounded-full px-6 py-3 border border-white/10 backdrop-blur-md',
        'shadow-[0_0_20px_rgba(255,255,255,0.05)] min-w-[280px] max-w-[500px]',
        state.phase === 'error' && 'border-error/40',
      )}>
        <div className="flex items-center gap-3">
          {state.phase === 'running' && (
            <span className="material-symbols-outlined icon-fill animate-pulse text-white text-[20px]">memory</span>
          )}
          {state.phase === 'done' && <CheckCircle2 className="w-5 h-5 text-white shrink-0" />}
          {state.phase === 'error' && <AlertCircle className="w-5 h-5 text-error shrink-0" />}
          {state.phase === 'running' && <Loader2 className="w-4 h-4 text-white/50 animate-spin hidden" />}

          <div className="flex-1 min-w-0">
            <div className="text-white flex items-center gap-2 font-label-md text-label-md">
              {state.phase === 'running' && 'AI Agent Running'}
              {state.phase === 'done' && `Done — ${state.found} discrepanc${state.found === 1 ? 'y' : 'ies'} found`}
              {state.phase === 'error' && 'Agent Error'}
            </div>
            <p className="text-[11px] text-white/50 truncate mt-0.5">{state.currentStep}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
