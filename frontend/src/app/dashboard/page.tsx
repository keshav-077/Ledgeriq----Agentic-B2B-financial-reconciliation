'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, AlertTriangle, Mail, Zap, ChevronRight,
  Play, Loader2, CheckCircle2, Activity, RefreshCw, Clock, Square,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { TypeBadge, StatusBadge } from '@/components/ui/Badge'

const DiscrepancyModal = dynamic(
  () => import('@/components/dashboard/DiscrepancyModal').then(m => ({ default: m.DiscrepancyModal })),
  { ssr: false }
)
import {
  getCompanies, getDiscrepancies, approveDiscrepancy,
  getDiscrepancyAnalytics, getMasterBalances, triggerReconciliation, getAgentRuns, cancelAgentRun, getCompanySettings
} from '@/lib/api'
import { fireAgentIsland } from '@/components/ui/AgentIsland'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell, PieChart, Pie } from 'recharts'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { Company, Discrepancy } from '@/types'

const FILTER_TABS: { label: string; value: string }[] = [
  { label: 'All',               value: 'all' },
  { label: 'Awaiting Approval', value: 'awaiting_approval' },
  { label: 'Email Sent',        value: 'email_sent' },
  { label: 'Resolved',          value: 'resolved' },
]

// ── Count-up animation hook ───────────────────────────────────────────────────
function useCountUp(target: number, duration = 900): number {
  const [count, setCount] = useState(0)
  const frameRef = useRef(0)
  useEffect(() => {
    if (target === 0) { setCount(0); return }
    let startTs: number | null = null
    const step = (ts: number) => {
      if (!startTs) startTs = ts
      const ease = Math.min((ts - startTs) / duration, 1)
      const eased = 1 - Math.pow(1 - ease, 3) // cubic ease-out
      setCount(Math.round(eased * target))
      if (ease < 1) frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [target, duration])
  return count
}

export default function DashboardPage() {
  const [selected, setSelected]         = useState<Discrepancy | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [approveError, setApproveError] = useState<string | null>(null)
  const qc = useQueryClient()

  const {
    data: companies = [],
    isLoading: loadingCompanies,
  } = useQuery<Company[]>({ queryKey: ['companies'], queryFn: getCompanies })

  const {
    data: allDiscs = [],
    isLoading: loadingDiscs,
    refetch,
    isFetching,
  } = useQuery<Discrepancy[]>({
    queryKey: ['discrepancies'],
    queryFn: () => getDiscrepancies(),
    refetchInterval: 30_000,
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveDiscrepancy(id),
    onSuccess: (updated: Discrepancy) => {
      qc.invalidateQueries({ queryKey: ['discrepancies'] })
      setSelected(updated)
      setApproveError(null)
    },
    onError: () => {
      setApproveError('Approval failed — check SMTP config or backend logs.')
    },
  })

  const { data: analytics } = useQuery({
    queryKey: ['discrepancy-analytics'],
    queryFn: () => getDiscrepancyAnalytics(90),
    staleTime: 60_000,
  })

  const { data: masterBalances = [] } = useQuery({
    queryKey: ['master-balances'],
    queryFn: getMasterBalances,
    staleTime: 30_000,
  })

  const { data: agentRuns = [], refetch: refetchRuns } = useQuery({
    queryKey: ['agent-runs'],
    queryFn: () => getAgentRuns(10),
    refetchInterval: 10_000,
  })

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: getCompanySettings,
    staleTime: 300_000,
  })

  const ownCompany = useMemo(() => {
    const taxId = (companySettings as any)?.identity?.identifier_value as string | undefined
    const name  = (companySettings as any)?.identity?.company_name  as string | undefined
    if (taxId || name) {
      const match = companies.find((c: Company) =>
        (taxId && (c as any).tax_id === taxId) ||
        (name  && c.name?.toLowerCase() === name.toLowerCase())
      )
      if (match) return match
    }
    return companies.find((c: Company) => c.is_own_company) ?? null
  }, [companies, companySettings])

  const readyRecords = (masterBalances as { reconciliation_status: string; counterparty_id: string | null }[])
    .filter(r => r.reconciliation_status === 'ready_for_external' && r.counterparty_id)

  const [runAllState, setRunAllState] = useState({
    running: false, done: 0, total: 0,
  })

  const handleRunAll = useCallback(async () => {
    if (!ownCompany?.id || readyRecords.length === 0 || runAllState.running) return
    setRunAllState({ running: true, done: 0, total: readyRecords.length })
    for (const record of readyRecords as { counterparty_id: string }[]) {
      try {
        const res = await triggerReconciliation(ownCompany?.id ?? null, record.counterparty_id)
        if (res?.run_id) fireAgentIsland(res.run_id)
      } catch { /* continue */ }
      setRunAllState(s => ({ ...s, done: s.done + 1 }))
    }
    setRunAllState(s => ({ ...s, running: false }))
    qc.invalidateQueries({ queryKey: ['discrepancies'] })
    qc.invalidateQueries({ queryKey: ['master-balances'] })
    refetchRuns()
  }, [ownCompany, readyRecords, runAllState.running, qc, refetchRuns])

  const companyMap = companies.reduce<Record<string, Company>>((acc, c) => {
    acc[c.id] = c
    return acc
  }, {})

  // FORCE TENANT OVERRIDE: Company A (Sol Taraf) her zaman Tenant'ın kendisidir.
  // Veritabanındaki referans ID eski olsa bile UI'da ayarları (TEST COMPANY) basıyoruz.
  const tenantName = (companySettings as any)?.identity?.company_name;
  const tenantEmail = (companySettings as any)?.contact?.email;

  if (tenantName) {
    allDiscs.forEach(disc => {
      companyMap[disc.company_a_id] = {
        ...(companyMap[disc.company_a_id] || {}),
        id: disc.company_a_id,
        name: tenantName,
        reconciliation_email: tenantEmail || companyMap[disc.company_a_id]?.reconciliation_email,
        is_own_company: true,
      } as Company
    })
  }

  const qcDash = useQueryClient()
  const cancelRunMutation = useMutation({
    mutationFn: (runId: string) => cancelAgentRun(runId),
    onSuccess: () => {
      qcDash.invalidateQueries({ queryKey: ['agent-runs'] })
    },
  })

  const awaitingCount  = allDiscs.filter(d => d.status === 'awaiting_approval').length
  const activeCount    = allDiscs.filter(d => !['resolved', 'email_sent'].includes(d.status)).length
  const isLoading      = loadingCompanies || loadingDiscs

  const animCompanies = useCountUp(isLoading ? 0 : companies.length)
  const animActive    = useCountUp(isLoading ? 0 : activeCount)
  const animAwaiting  = useCountUp(isLoading ? 0 : awaitingCount)

  const filteredDiscs =
    statusFilter === 'all'
      ? allDiscs
      : allDiscs.filter(d => d.status === statusFilter)

  return (
    <AppShell>
      {/* Page header with Run All */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-headline-lg-mobile md:text-headline-lg text-white">Platform Overview</h1>
          <p className="font-body-lg text-body-lg text-white/60 mt-1">Real-time reconciliation analytics and active anomalies.</p>
        </div>
        <div className="flex items-center gap-3">
          {runAllState.running && (
            <div className="flex items-center gap-2 min-w-[160px]">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${(runAllState.done / runAllState.total) * 100}%` }}
                />
              </div>
              <span className="text-xs text-on-surface-variant font-mono flex-shrink-0">
                {runAllState.done}/{runAllState.total}
              </span>
            </div>
          )}
          {readyRecords.length > 0 && (
            <button
              onClick={handleRunAll}
              disabled={runAllState.running}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all',
                runAllState.running
                  ? 'bg-white/10 text-on-surface-variant cursor-not-allowed'
                  : 'bg-primary hover:bg-white/90 text-on-primary shadow-lg shadow-white/10',
              )}
            >
              {runAllState.running
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
                : <><Play className="w-4 h-4" /> Reconcile All ({readyRecords.length})</>}
            </button>
          )}
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Companies Monitored"
          value={isLoading ? '—' : animCompanies}
          icon={<Building2 className="w-5 h-5" />}
          color="blue"
          sub={
            isLoading
              ? 'Loading…'
              : companies.length === 0
              ? 'Seed mock data to populate'
              : companies.map(c => c.name).join(' · ')
          }
        />
        <StatCard
          label="Active Discrepancies"
          value={isLoading ? '—' : animActive}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="amber"
          sub={activeCount > 0 ? 'Requires reconciliation' : 'All clear'}
        />
        <StatCard
          label="Awaiting Approval"
          value={isLoading ? '—' : animAwaiting}
          icon={<Mail className="w-5 h-5" />}
          color="green"
          sub={
            awaitingCount > 0
              ? `${awaitingCount} email draft${awaitingCount > 1 ? 's' : ''} ready for review`
              : 'No pending approvals'
          }
          highlight={awaitingCount > 0}
        />
      </div>

      {/* ── Analytics ── */}
      {analytics && <DiscrepancyAnalytics analytics={analytics} companyMap={companyMap} />}

      {/* ── Bottom Row: Feed + Activity ── */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0">
        {/* ── Discrepancy Feed ── */}
        <div className="bg-surface-secondary border border-surface-border rounded-2xl overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent-green" />
            <h2 className="text-sm font-semibold text-white">Discrepancy Feed</h2>
            {!isLoading && (
              <span className="text-xs text-text-muted">({filteredDiscs.length})</span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {FILTER_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-medium transition-all',
                  statusFilter === tab.value
                ? 'bg-accent-green/10 text-accent-green border border-accent-green/15'
                : 'text-text-secondary hover:text-white hover:bg-surface-secondary',
                )}
              >
                {tab.label}
                {tab.value === 'awaiting_approval' && awaitingCount > 0 && (
                  <span className="ml-1.5 bg-accent-green text-white text-[9px] px-1.5 py-px rounded-full font-semibold">
                    {awaitingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Rows */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-surface-border border-t-accent-green rounded-full animate-spin" />
          </div>
        ) : filteredDiscs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-8">
            <div className="w-12 h-12 rounded-2xl bg-surface-primary border border-surface-border flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-text-muted" />
            </div>
            <p className="text-white font-medium mb-1">No discrepancies found</p>
            <p className="text-text-muted text-sm">
              {statusFilter !== 'all'
                ? 'Try the "All" filter, or run the reconciliation agent.'
                : 'Run the reconciliation agent or seed mock data to get started.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {filteredDiscs.map(disc => {
              const cA = companyMap[disc.company_a_id]
              const cB = companyMap[disc.company_b_id]
              return (
                <div
                  key={disc.id}
                  onClick={() => { setSelected(disc); setApproveError(null) }}
                  className="flex items-center justify-between px-6 py-4 hover:bg-surface-primary/40 transition-colors cursor-pointer group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-mono font-semibold text-white">
                        {disc.ledger_ref}
                      </span>
                      <TypeBadge type={disc.discrepancy_type} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-text-secondary flex-wrap">
                      <span className="truncate max-w-[160px]">{cA?.name ?? disc.company_a_id.slice(-8)}</span>
                      <span className="text-text-muted">↔</span>
                      <span className="truncate max-w-[160px]">{cB?.name ?? disc.company_b_id.slice(-8)}</span>
                      {disc.difference != null && (
                        <>
                          <span className="text-text-muted">·</span>
                          <span className="text-error font-medium">
                            {formatCurrency(disc.difference, (disc as Discrepancy & { currency?: string }).currency ?? undefined)} diff
                          </span>
                        </>
                      )}
                      <span className="text-text-muted">· {formatDate(disc.detected_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <StatusBadge status={disc.status} />
                    <div className="flex items-center gap-1 text-xs font-medium text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                      Review <ChevronRight className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      </div>{/* end flex-1 */}

        {/* ── Activity Feed ── */}
        <div className="w-full lg:w-[280px] lg:flex-shrink-0 bg-surface-elevated border border-border-subtle rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-white" />
              <h3 className="text-sm font-semibold text-white">Agent Activity</h3>
            </div>
            <button onClick={() => refetchRuns()} className="p-1 rounded text-on-surface-variant hover:text-white transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-border-subtle max-h-[480px] overflow-y-auto">
            {(agentRuns as {
              id: string; company_a_id: string; company_b_id: string;
              status: string; discrepancies_found: number; started_at: string
            }[]).length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Activity className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs text-on-surface-variant">No agent runs yet</p>
              </div>
            ) : (agentRuns as {
              id: string; company_a_id: string; company_b_id: string;
              status: string; discrepancies_found: number; started_at: string
            }[]).map(run => (
              <div key={run.id} className="px-4 py-3 hover:bg-surface-container transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <div className={cn(
                    'w-2 h-2 rounded-full flex-shrink-0',
                    run.status === 'completed' && 'bg-white/50',
                    run.status === 'running'   && 'bg-white/50 animate-pulse',
                    run.status === 'failed'    && 'bg-error/100',
                    run.status === 'cancelled' && 'bg-white/20',
                  )} />
                  <span className={cn(
                    'text-[10px] font-semibold uppercase tracking-wide',
                    run.status === 'completed' && 'text-white',
                    run.status === 'running'   && 'text-secondary',
                    run.status === 'failed'    && 'text-error',
                    run.status === 'cancelled' && 'text-on-surface-variant',
                  )}>{run.status}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    {run.discrepancies_found > 0 && (
                      <span className="text-[10px] bg-amber-100 text-white px-1.5 py-0.5 rounded-full font-bold">
                        +{run.discrepancies_found}
                      </span>
                    )}
                    {run.status === 'running' && (
                      <button
                        onClick={e => { e.stopPropagation(); cancelRunMutation.mutate(run.id) }}
                        disabled={cancelRunMutation.isPending}
                        title="Stop this run"
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-error/10 text-error border border-error/20 hover:bg-red-100 transition-colors disabled:opacity-50"
                      >
                        <Square className="w-2 h-2 fill-red-500" />
                        Stop
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-on-surface font-medium truncate">
                  {companyMap[run.company_a_id]?.name?.split(' ')[0] ?? '—'}
                  {' ↔ '}
                  {companyMap[run.company_b_id]?.name?.split(' ')[0] ?? '—'}
                </p>
                <div className="flex items-center gap-1 mt-1 text-[10px] text-on-surface-variant">
                  <Clock className="w-2.5 h-2.5" />
                  {formatDate(run.started_at)}
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2.5 border-t border-border-subtle">
            <a href="/reports" className="text-[11px] text-white hover:underline font-medium">
              View all in Reports →
            </a>
          </div>
        </div>
      </div>{/* end bottom row */}

      {/* ── Modal ── */}
      {selected && (
        <DiscrepancyModal
          discrepancy={selected}
          companyMap={companyMap}
          onClose={() => { setSelected(null); setApproveError(null) }}
          onApprove={() => approveMutation.mutate(selected.id)}
          isApproving={approveMutation.isPending}
          approveError={approveError}
        />
      )}
    </AppShell>
  )
}

/* ── Analytics Section ─────────────────────────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  amount_mismatch: '#f59e0b',
  missing_record:  '#ef4444',
  date_mismatch:   '#3b82f6',
  duplicate:       '#8b5cf6',
}

const TYPE_LABELS: Record<string, string> = {
  amount_mismatch: 'Amount Mismatch',
  missing_record:  'Missing Record',
  date_mismatch:   'Date Mismatch',
  duplicate:       'Duplicate',
}

function DiscrepancyAnalytics({
  analytics,
  companyMap,
}: {
  analytics: { trend: { month: string; type: string; count: number }[]; top_counterparties: { company_id: string; count: number; total_diff: number }[] }
  companyMap: Record<string, Company>
}) {
  // Build recharts-friendly monthly data
  const monthMap: Record<string, Record<string, number>> = {}
  for (const row of analytics.trend) {
    if (!monthMap[row.month]) monthMap[row.month] = {}
    monthMap[row.month][row.type] = (monthMap[row.month][row.type] || 0) + row.count
  }
  const chartData = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, types]) => ({
      month: month.slice(5), // "2026-04" → "04"
      ...types,
    }))

  // Type breakdown for pie
  const typeBreakdown = Object.entries(
    analytics.trend.reduce<Record<string, number>>((acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + r.count
      return acc
    }, {})
  ).map(([type, value]) => ({ name: TYPE_LABELS[type] || type, value, color: TYPE_COLORS[type] || '#64748b' }))

  const totalDiscs = typeBreakdown.reduce((s, r) => s + r.value, 0)

  if (chartData.length === 0) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
      {/* Monthly trend */}
      <div className="lg:col-span-2 bg-surface-secondary border border-surface-border rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Discrepancy Trend</h3>
            <p className="text-xs text-text-muted mt-0.5">Last 90 days by type</p>
          </div>
          <span className="text-xs bg-surface-primary border border-surface-border px-2 py-1 rounded-lg text-text-secondary">
            {totalDiscs} total
          </span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} barSize={28}>
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={24} />
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={(v: string) => TYPE_LABELS[v] || v} />
            <Bar dataKey="amount_mismatch" stackId="a" fill={TYPE_COLORS.amount_mismatch} radius={[0,0,0,0]} />
            <Bar dataKey="missing_record"  stackId="a" fill={TYPE_COLORS.missing_record} radius={[0,0,0,0]} />
            <Bar dataKey="date_mismatch"   stackId="a" fill={TYPE_COLORS.date_mismatch} radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdown + top counterparties */}
      <div className="flex flex-col gap-4">
        {/* Pie */}
        <div className="bg-surface-secondary border border-surface-border rounded-2xl p-5 flex-1">
          <h3 className="text-sm font-semibold text-white mb-3">Type Breakdown</h3>
          <div className="flex items-center gap-3">
            <PieChart width={80} height={80}>
              <Pie data={typeBreakdown} dataKey="value" cx={36} cy={36} innerRadius={22} outerRadius={38} paddingAngle={2}>
                {typeBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
            </PieChart>
            <div className="flex flex-col gap-1.5">
              {typeBreakdown.map(t => (
                <div key={t.name} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color }} />
                  <span className="text-text-secondary truncate">{t.name}</span>
                  <span className="font-semibold text-white ml-auto pl-2">{t.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top counterparties */}
        {analytics.top_counterparties.length > 0 && (
          <div className="bg-surface-secondary border border-surface-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Top Issues</h3>
            <div className="flex flex-col gap-2">
              {analytics.top_counterparties.slice(0, 3).map(cp => (
                <div key={cp.company_id} className="flex items-center justify-between text-xs">
                  <span className="text-text-secondary truncate max-w-[120px]">
                    {companyMap[cp.company_id]?.name ?? `…${cp.company_id.slice(-6)}`}
                  </span>
                  <span className="font-semibold text-secondary">{cp.count} issues</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Stat Card ─────────────────────────────────────────────────────────────── */

type Color = 'blue' | 'amber' | 'green'

const COLOR_MAP: Record<Color, { icon: string; value: string }> = {
  blue:  { icon: 'bg-white/10 text-white border-white/15',       value: 'text-white' },
  amber: { icon: 'bg-error/10 text-error border-error/20',       value: 'text-error' },
  green: { icon: 'bg-white/10 text-white border-white/15',       value: 'text-white' },
}

function StatCard({
  label, value, icon, color, sub, highlight,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: Color
  sub?: string
  highlight?: boolean
}) {
  const c = COLOR_MAP[color]
  return (
    <div
      className={cn(
        'card-glass p-6 transition-all',
        highlight
          ? 'border-error/30'
          : '',
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-secondary">{label}</p>
        <div className={cn('w-9 h-9 rounded-xl border flex items-center justify-center', c.icon)}>
          {icon}
        </div>
      </div>
      <p className={cn('text-3xl sm:text-4xl font-bold mb-1.5 tabular-nums', c.value)}>{value}</p>
      {sub && <p className="text-xs text-text-muted leading-snug line-clamp-2">{sub}</p>}
    </div>
  )
}
