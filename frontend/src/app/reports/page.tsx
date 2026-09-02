'use client'
import { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import {
  BarChart2, FileSpreadsheet, FileText, CheckCircle2, AlertTriangle, XCircle,
  Clock, Zap, ChevronRight, Loader2, RefreshCw, TrendingUp, Activity, Users, Square,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { getAgentRuns, getCompanies, cancelAgentRun } from '@/lib/api'
import { api } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'

// ── Heatmap cell color ────────────────────────────────────────────────────────
function cellColor(count: number, max: number): string {
  if (count <= 0) return '#f1f5f9'           // empty / future
  const ratio = count / Math.max(max, 1)
  if (ratio < 0.15) return '#bbf7d0'         // very light green
  if (ratio < 0.35) return '#4ade80'         // light green
  if (ratio < 0.60) return '#16a34a'         // medium green
  if (ratio < 0.85) return '#15803d'         // dark green
  return '#14532d'                           // darkest
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
// Row indices 0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat — show Mon/Wed/Fri like GitHub
const ROW_LABELS  = ['', 'Mon', '', 'Wed', '', 'Fri', '']

interface HeatmapDay {
  key: string
  date: Date
  count: number
  month: number
}

function HeatmapSection({
  data,
}: {
  data: { weeks: HeatmapDay[][]; maxCount: number; dayMap: Record<string, number> }
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { weeks, maxCount } = data

  const CELL = 11
  const GAP  = 2
  const UNIT = CELL + GAP

  // Month labels: place at the column whose week contains the 1st of that month
  const monthLabels: { label: string; col: number }[] = []
  weeks.forEach((week, wi) => {
    for (const day of week) {
      if (!day.key || day.count === -1) continue
      if (day.date.getDate() === 1) {
        // Start of a new month — put label here
        monthLabels.push({ label: MONTH_SHORT[day.date.getMonth()], col: wi })
      }
      break // only check the first valid day per week for month-start
    }
  })
  // If no month label at column 0, add the month of the first visible day
  if (!monthLabels.find(m => m.col === 0)) {
    const firstDay = weeks[0]?.find(d => d.key && d.count !== -1)
    if (firstDay) {
      monthLabels.unshift({ label: MONTH_SHORT[firstDay.date.getMonth()], col: 0 })
    }
  }

  const totalDiscrepancies = Object.values(data.dayMap).reduce((s, v) => s + v, 0)
  const activeDays = Object.keys(data.dayMap).length

  return (
    <div className="bg-surface-elevated rounded-2xl border border-border-subtle p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">Discrepancy Heatmap</h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {totalDiscrepancies} discrepanc{totalDiscrepancies !== 1 ? 'ies' : 'y'} across {activeDays} active day{activeDays !== 1 ? 's' : ''} · last 12 months
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant font-medium">
          <span>Less</span>
          {['#f1f5f9','#bbf7d0','#4ade80','#16a34a','#15803d','#14532d'].map(c => (
            <div key={c} className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: c, border: '1px solid rgba(0,0,0,0.07)' }} />
          ))}
          <span>More</span>
        </div>
      </div>

      <div className="overflow-x-auto relative" ref={containerRef}>
        <div className="flex" style={{ userSelect: 'none' }}>

          {/* Day-of-week labels */}
          <div className="flex-shrink-0 mr-1.5" style={{ paddingTop: 18 }}>
            {ROW_LABELS.map((lbl, i) => (
              <div key={i} className="text-[9px] text-on-surface-variant font-medium text-right pr-1 flex items-center justify-end"
                style={{ height: UNIT, minWidth: 26 }}>
                {lbl}
              </div>
            ))}
          </div>

          {/* Grid data */}
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col relative" style={{ width: UNIT, marginRight: GAP }}>
              {/* Month label */}
              {monthLabels.find(m => m.col === wi) && (
                <span className="absolute -top-[18px] text-[10px] text-on-surface-variant font-medium whitespace-nowrap">
                  {monthLabels.find(m => m.col === wi)?.label}
                </span>
              )}
              {week.map((day, di) => (
                <div
                  key={di}
                  className="rounded-[2px] transition-all hover:ring-1 hover:ring-slate-400 cursor-pointer"
                  style={{
                    width: CELL,
                    height: CELL,
                    marginBottom: GAP,
                    background: day.count === -1 ? 'transparent' : cellColor(day.count, maxCount),
                    visibility: day.count === -1 ? 'hidden' : 'visible'
                  }}
                  onMouseEnter={(e) => {
                    if (day.count === -1) return;
                    const rect = (e.target as HTMLElement).getBoundingClientRect()
                    const container = (e.target as HTMLElement).closest('.relative')?.getBoundingClientRect()
                    setTip({
                      x: rect.left - (container?.left ?? 0) + 6,
                      y: rect.top  - (container?.top  ?? 0) - 32,
                      text: `${day.key}: ${day.count} discrepanc${day.count !== 1 ? 'ies' : 'y'}`,
                    })
                  }}
                  onMouseLeave={() => setTip(null)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {tip && (
        <div
          className="absolute z-20 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[10px] font-medium shadow-xl pointer-events-none whitespace-nowrap"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step { type: string; message: string; timestamp: string }

interface AgentRun {
  id: string
  company_a_id: string
  company_b_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  discrepancies_found: number
  started_at: string
  completed_at: string | null
  steps?: Step[]
}

const STATUS_COLORS = {
  completed: 'bg-white/10 text-white border-white/15',
  running:   'bg-blue-100 text-blue-700 border-blue-200',
  failed:    'bg-red-100 text-red-700 border-error/20',
  cancelled: 'bg-white/10 text-on-surface-variant border-border-subtle',
}

const TYPE_HEX: Record<string, string> = {
  amount_mismatch: '#f59e0b',
  missing_record:  '#ef4444',
  date_mismatch:   '#3b82f6',
  duplicate:       '#8b5cf6',
}

const STEP_ICONS: Record<string, string> = {
  loading_companies:      '🏢',
  fetching_ledgers:       '📥',
  comparing_records:      '🔍',
  analyzing_discrepancy:  '🤖',
  discrepancy_saved:      '💾',
  generating_embeddings:  '🧠',
  complete:               '✅',
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  const { data: runs = [], isLoading: runsLoading, refetch } = useQuery<AgentRun[]>({
    queryKey: ['agent-runs'],
    queryFn: () => getAgentRuns(50),
    refetchInterval: 15_000,
  })

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['discrepancy-analytics'],
    queryFn: () => api.get('/api/v1/discrepancies/analytics?days=90').then(r => r.data),
  })

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies'],
    queryFn: () => getCompanies() as Promise<{ id: string; name: string }[]>,
  })

  const { data: portalSummary } = useQuery<{
    total: number; agreed: number; disagreed: number; ai_requested: number; pending: number
  }>({
    queryKey: ['portal-summary'],
    queryFn: () => api.get('/api/v1/portal/sessions/summary').then(r => r.data),
    staleTime: 15_000,
    refetchInterval: 20_000,
  })

  const qc = useQueryClient()

  const cancelMutation = useMutation({
    mutationFn: (runId: string) => cancelAgentRun(runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-runs'] })
    },
  })

  const { data: allDiscrepancies = [] } = useQuery<{
    id: string; company_b_id: string; discrepancy_type: string;
    status: string; difference: number; detected_at: string;
  }[]>({
    queryKey: ['discrepancies'],
    queryFn: () => api.get('/api/v1/discrepancies/').then(r => r.data),
  })

  const companyMap = Object.fromEntries(companies.map(c => [c.id, c.name]))

  // ── Summary Stats ─────────────────────────────────────────────────────────

  const completedRuns: AgentRun[] = runs.filter((r: AgentRun) => r.status === 'completed')
  const totalDiscrepancies: number = runs.reduce((s: number, r: AgentRun) => s + (r.discrepancies_found || 0), 0)
  const avgDuration: number = completedRuns.length
    ? Math.round(completedRuns.reduce((s: number, r: AgentRun) => {
        if (!r.completed_at) return s
        return s + (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000
      }, 0) / completedRuns.length)
    : 0

  // ── Chart Data ────────────────────────────────────────────────────────────

  const trendData = (analytics?.monthly_trend || []).map((d: Record<string, unknown>) => ({
    ...d,
    month: String(d.month || '').slice(0, 7),
  }))

  const typeData = Object.entries(analytics?.type_breakdown || {}).map(([key, val]) => ({
    name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    value: val as number,
    fill: TYPE_HEX[key] || '#94a3b8',
  }))

  // Discrepancy stats
  const totalExposure = allDiscrepancies.reduce((s, d) => s + (d.difference || 0), 0)
  const resolvedCount = allDiscrepancies.filter(d => ['resolved', 'email_sent'].includes(d.status)).length
  const resolutionRate = allDiscrepancies.length ? Math.round(resolvedCount / allDiscrepancies.length * 100) : 0

  const statusBreakdown = allDiscrepancies.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] || 0) + 1
    return acc
  }, {})
  const statusChartData = Object.entries(statusBreakdown).map(([name, value]) => ({
    name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    value,
    fill: name === 'resolved' ? '#ffffff' : name === 'email_sent' ? '#3b82f6' : name === 'awaiting_approval' ? '#f59e0b' : '#94a3b8',
  }))

  const topCounterparties = Object.entries(
    allDiscrepancies.reduce<Record<string, { count: number; exposure: number }>>((acc, d) => {
      const key = d.company_b_id
      if (!acc[key]) acc[key] = { count: 0, exposure: 0 }
      acc[key].count++
      acc[key].exposure += d.difference || 0
      return acc
    }, {})
  )
    .map(([id, stats]) => ({ id, name: companyMap[id] || id.slice(-8), ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // ── Heatmap data — discrepancies per day for last 365 days ───────────────
  const heatmapData = useMemo(() => {
    const dayMap: Record<string, number> = {}
    allDiscrepancies.forEach(d => {
      if (d.detected_at) {
        const day = d.detected_at.slice(0, 10)
        dayMap[day] = (dayMap[day] || 0) + 1
      }
    })

    const today = new Date()
    // Align to start of week (Sunday)
    const startDay = new Date(today)
    startDay.setDate(startDay.getDate() - 364)
    // Go back to Sunday
    startDay.setDate(startDay.getDate() - startDay.getDay())

    const weeks: { key: string; date: Date; count: number; month: number }[][] = []
    let week: typeof weeks[0] = []
    const cursor = new Date(startDay)

    while (cursor <= today || week.length > 0) {
      const key = cursor.toISOString().slice(0, 10)
      week.push({
        key,
        date: new Date(cursor),
        count: dayMap[key] || 0,
        month: cursor.getMonth(),
      })
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
      cursor.setDate(cursor.getDate() + 1)
      if (cursor > today && week.length > 0) {
        // Pad remaining days
        while (week.length < 7) {
          week.push({ key: '', date: new Date(cursor), count: -1, month: cursor.getMonth() })
          cursor.setDate(cursor.getDate() + 1)
        }
        weeks.push(week)
        break
      }
    }

    const maxCount = Math.max(...Object.values(dayMap), 1)
    return { weeks, maxCount, dayMap }
  }, [allDiscrepancies])

  const runsByDay = (runs as AgentRun[]).reduce<Record<string, number>>((acc: Record<string, number>, r: AgentRun) => {
    const day = r.started_at?.slice(0, 10) || ''
    if (day) acc[day] = (acc[day] || 0) + 1
    return acc
  }, {})
  const activityData = Object.entries(runsByDay).slice(-14).map(([date, count]) => ({
    date: date.slice(5),
    runs: count,
  }))

  // ── Exports ───────────────────────────────────────────────────────────────

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()

    const runsSheet = runs.map(r => ({
      'Run ID':              r.id,
      'Company A':           companyMap[r.company_a_id] || r.company_a_id,
      'Company B':           companyMap[r.company_b_id] || r.company_b_id,
      'Status':              r.status,
      'Discrepancies Found': r.discrepancies_found,
      'Started At':          r.started_at ? new Date(r.started_at).toLocaleString() : '',
      'Completed At':        r.completed_at ? new Date(r.completed_at).toLocaleString() : '',
      'Duration (s)':        r.completed_at
        ? Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000)
        : '',
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(runsSheet), 'Agent Runs')

    if (trendData.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trendData), 'Monthly Trend')
    }

    if (typeData.length) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        typeData.map(d => ({ 'Type': d.name, 'Count': d.value }))
      ), 'Discrepancy Types')
    }

    XLSX.writeFile(wb, `lumina-report-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  function exportPDF() { window.print() }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4 print:hidden">
          <div>
            <h1 className="font-display text-headline-lg-mobile md:text-headline-lg text-white">
              Reports & Analytics
            </h1>
            <p className="font-body-md text-on-surface-variant mt-1">
              Agent run history, discrepancy trends, and performance insights.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => refetch()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-on-surface-variant hover:text-white border border-border-subtle hover:border-white/20 rounded-xl transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <button onClick={exportExcel}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-white/5 border border-white/15 hover:bg-white/10 rounded-xl transition-colors">
              <FileSpreadsheet className="w-3.5 h-3.5" /><span className="hidden sm:inline">Export</span> Excel
            </button>
            <button onClick={exportPDF}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-white/5 border border-blue-200 hover:bg-blue-100 rounded-xl transition-colors">
              <FileText className="w-3.5 h-3.5" /><span className="hidden sm:inline">Export</span> PDF
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Total Agent Runs',      value: (runs as AgentRun[]).length,  icon: <Zap className="w-5 h-5 text-white" />,    bg: 'bg-white/5 border-white/10' },
            { label: 'Discrepancies Found',   value: allDiscrepancies.length,      icon: <AlertTriangle className="w-5 h-5 text-secondary" />, bg: 'bg-white/5 border-amber-100' },
            { label: 'Resolution Rate',       value: allDiscrepancies.length ? `${resolutionRate}%` : '—', icon: <CheckCircle2 className="w-5 h-5 text-white" />, bg: 'bg-white/5 border-white/10' },
            { label: 'Total $ Exposure',      value: totalExposure ? `$${totalExposure.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0', icon: <TrendingUp className="w-5 h-5 text-error" />, bg: 'bg-error/10 border-red-100' },
            { label: 'Completion Rate',       value: (runs as AgentRun[]).length ? `${Math.round(completedRuns.length / (runs as AgentRun[]).length * 100)}%` : '—', icon: <Activity className="w-5 h-5 text-secondary" />, bg: 'bg-white/5 border-blue-100' },
            { label: 'Avg Run Time',          value: avgDuration ? `${avgDuration}s` : '—', icon: <Clock className="w-5 h-5 text-purple-500" />, bg: 'bg-purple-50 border-purple-100' },
          ].map(card => (
            <div key={card.label} className={cn('rounded-2xl border p-4', card.bg)}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-on-surface-variant font-medium">{card.label}</span>
                {card.icon}
              </div>
              <p className="text-2xl font-bold text-white">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Discrepancy Trend */}
          <div className="lg:col-span-2 bg-surface-elevated rounded-2xl border border-border-subtle p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Discrepancy Trend</h2>
                <p className="text-xs text-on-surface-variant">Last 90 days by month</p>
              </div>
              <TrendingUp className="w-4 h-4 text-on-surface-variant" />
            </div>
            {analyticsLoading ? (
              <div className="h-52 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-on-surface-variant" />
              </div>
            ) : trendData.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trendData} barSize={16} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '11px' }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Bar dataKey="amount_mismatch" name="Amount Mismatch" fill="#f59e0b" radius={[4,4,0,0]} stackId="a" />
                  <Bar dataKey="missing_record"  name="Missing Record"  fill="#ef4444" radius={[4,4,0,0]} stackId="a" />
                  <Bar dataKey="date_mismatch"   name="Date Mismatch"   fill="#3b82f6" radius={[4,4,0,0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-52 flex flex-col items-center justify-center gap-3 select-none">
                <div className="flex items-end gap-1.5 h-10">
                  {[3,5,2,7,4,6,3,8,5].map((h,i) => (
                    <div key={i} className="w-3 rounded-t animate-pulse"
                      style={{ height:`${h*10}%`, background:`rgba(255,255,255,${0.1+i*0.06})`, animationDelay:`${i*0.12}s`, animationDuration:'2s' }} />
                  ))}
                </div>
                <p className="text-xs text-on-surface-variant font-medium">Run a reconciliation to generate trend data</p>
              </div>
            )}
          </div>

          {/* Type Breakdown */}
          <div className="bg-surface-elevated rounded-2xl border border-border-subtle p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Type Breakdown</h2>
                <p className="text-xs text-on-surface-variant">All time</p>
              </div>
              <BarChart2 className="w-4 h-4 text-on-surface-variant" />
            </div>
            {typeData.length ? (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={typeData} cx="50%" cy="50%" innerRadius={45} outerRadius={68}
                      paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {typeData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 mt-1">
                  {typeData.map(d => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.fill }} />
                        <span className="text-on-surface-variant">{d.name}</span>
                      </div>
                      <span className="font-bold text-white">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-52 flex flex-col items-center justify-center gap-3 select-none">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-4 border-border-subtle animate-pulse" />
                  <div className="absolute inset-2 rounded-full border-4 border-dashed border-border-subtle animate-spin" style={{ animationDuration:'8s' }} />
                </div>
                <p className="text-xs text-on-surface-variant font-medium">No discrepancy data yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Status Breakdown + Top Counterparties */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Discrepancy Status Breakdown */}
          <div className="bg-surface-elevated rounded-2xl border border-border-subtle p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Resolution Status</h2>
                <p className="text-xs text-on-surface-variant">Current discrepancy pipeline</p>
              </div>
              <CheckCircle2 className="w-4 h-4 text-on-surface-variant" />
            </div>
            {statusChartData.length ? (
              <>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={40} outerRadius={62}
                      paddingAngle={3} dataKey="value" strokeWidth={0}>
                      {statusChartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 mt-1">
                  {statusChartData.map(d => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                        <span className="text-on-surface-variant">{d.name}</span>
                      </div>
                      <span className="font-bold text-white">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-on-surface-variant">No discrepancies yet</div>
            )}
          </div>

          {/* Top Counterparties */}
          <div className="bg-surface-elevated rounded-2xl border border-border-subtle p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Top Counterparties by Issues</h2>
                <p className="text-xs text-on-surface-variant">Most discrepancies all time</p>
              </div>
              <Users className="w-4 h-4 text-on-surface-variant" />
            </div>
            {topCounterparties.length ? (
              <div className="space-y-3">
                {topCounterparties.map((cp, i) => (
                  <div key={cp.id} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-on-surface-variant">#{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-white truncate">{cp.name}</span>
                        <span className="text-xs font-bold text-amber-600 flex-shrink-0 ml-2">{cp.count} issue{cp.count !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="mt-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-400 rounded-full"
                          style={{ width: `${Math.min((cp.count / topCounterparties[0].count) * 100, 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-on-surface-variant mt-0.5">
                        ${cp.exposure.toLocaleString(undefined, { maximumFractionDigits: 0 })} exposure
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-on-surface-variant">No data yet</div>
            )}
          </div>
        </div>

        {/* ── Portal Responses ── */}
        {portalSummary && portalSummary.total > 0 && (
          <div className="bg-surface-elevated rounded-2xl border border-border-subtle p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="text-sm font-semibold text-white">Counterparty Portal Responses</h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  How counterparties responded to reconciliation link invitations
                </p>
              </div>
              <span className="text-xs bg-white/10 text-on-surface-variant px-2.5 py-1 rounded-full font-medium">
                {portalSummary.total} links sent
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {([
                { label: 'Agreed',        value: portalSummary.agreed,       color: '#16a34a', bg: 'rgba(22,163,74,0.07)',    border: 'rgba(22,163,74,0.15)',   icon: <CheckCircle2 className="w-5 h-5" /> },
                { label: 'Disagreed',     value: portalSummary.disagreed,    color: '#ef4444', bg: 'rgba(239,68,68,0.07)',     border: 'rgba(239,68,68,0.15)',   icon: <XCircle className="w-5 h-5" /> },
                { label: 'AI Requested',  value: portalSummary.ai_requested, color: '#bec8d2', bg: 'rgba(37,151,248,0.07)',    border: 'rgba(37,151,248,0.15)',  icon: <Zap className="w-5 h-5" /> },
                { label: 'Pending',       value: portalSummary.pending,      color: '#94a3b8', bg: 'rgba(148,163,184,0.07)',   border: 'rgba(148,163,184,0.15)', icon: <Clock className="w-5 h-5" /> },
              ] as const).map(card => (
                <div key={card.label} className="rounded-xl p-4 flex items-center gap-3 border"
                  style={{ background: card.bg, borderColor: card.border }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold flex-shrink-0"
                    style={{ color: card.color, background: card.bg }}>
                    {card.icon}
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: card.color }}>{card.value}</p>
                    <p className="text-[10px] text-on-surface-variant font-medium">{card.label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Response rate bar */}
            <div className="flex items-center gap-3 pt-3 border-t border-border-subtle">
              <span className="text-xs text-on-surface-variant flex-shrink-0">Response rate</span>
              <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(((portalSummary.agreed + portalSummary.disagreed + portalSummary.ai_requested) / Math.max(portalSummary.total, 1)) * 100)}%`,
                    background: 'linear-gradient(90deg, #ffffff, #bec8d2)',
                  }}
                />
              </div>
              <span className="text-xs font-bold text-on-surface flex-shrink-0">
                {Math.round(((portalSummary.agreed + portalSummary.disagreed + portalSummary.ai_requested) / Math.max(portalSummary.total, 1)) * 100)}%
              </span>
            </div>
          </div>
        )}

        {/* ── Discrepancy Heatmap ── */}
        <div className="relative">
          <HeatmapSection data={heatmapData} />
        </div>

        {/* Activity Chart */}
        {activityData.length > 0 && (
          <div className="bg-surface-elevated rounded-2xl border border-border-subtle p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Agent Activity</h2>
                <p className="text-xs text-on-surface-variant">Reconciliation runs per day (last 14 days)</p>
              </div>
              <Activity className="w-4 h-4 text-on-surface-variant" />
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={activityData} barSize={20} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '11px' }} />
                <Bar dataKey="runs" name="Agent Runs" fill="#ffffff" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Agent Run Timeline */}
        <div className="bg-surface-elevated rounded-2xl border border-border-subtle">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
            <div>
              <h2 className="text-sm font-semibold text-white">Agent Run Timeline</h2>
              <p className="text-xs text-on-surface-variant">
                Complete history of all reconciliation runs with step-by-step breakdown
              </p>
            </div>
            <span className="text-xs bg-white/10 text-on-surface-variant px-2.5 py-1 rounded-full font-medium">
              {runs.length} runs
            </span>
          </div>

          {runsLoading ? (
            <div className="p-10 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-on-surface-variant" />
            </div>
          ) : runs.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center px-8 select-none">
              {/* Animated bar chart */}
              <div className="flex items-end gap-2 h-12 mb-6">
                {[40, 65, 30, 80, 50, 70, 45].map((h, i) => (
                  <div key={i}
                    className="w-4 rounded-t-md animate-pulse"
                    style={{
                      height: `${h}%`,
                      background: `rgba(255,255,255,${0.15 + i * 0.08})`,
                      animationDelay: `${i * 0.15}s`,
                      animationDuration: '1.8s',
                    }}
                  />
                ))}
              </div>
              <h3 className="text-base font-bold text-white mb-2">No runs yet</h3>
              <p className="text-sm text-on-surface-variant max-w-xs leading-relaxed mb-5">
                Trigger your first reconciliation to start seeing agent run history, step timelines, and analytics.
              </p>
              <a href="/reconciliations"
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-xl transition-all hover:-translate-y-0.5"
                style={{ background: 'linear-gradient(135deg,#ffffff,#c6c6c7)', boxShadow: '0 4px 16px rgba(255,255,255,0.25)' }}>
                <Zap className="w-4 h-4" />
                Go to Reconciliation List
              </a>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {(runs as AgentRun[]).map((run: AgentRun) => {
                const isExpanded = expandedRun === run.id
                const duration = run.completed_at
                  ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
                  : null
                const compA = companyMap[run.company_a_id] || 'Company A'
                const compB = companyMap[run.company_b_id] || 'Company B'

                return (
                  <div key={run.id}>
                    {/* Run row */}
                    <button
                      onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-surface-container transition-colors text-left"
                    >
                      {/* Status indicator */}
                      <div className={cn(
                        'w-2.5 h-2.5 rounded-full flex-shrink-0',
                        run.status === 'completed' && 'bg-white/50',
                        run.status === 'running'   && 'bg-white/50 animate-pulse',
                        run.status === 'failed'    && 'bg-error/100',
                        run.status === 'cancelled' && 'bg-slate-400',
                      )} />

                      {/* Companies + meta */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
                          <span className="truncate max-w-[150px]">{compA}</span>
                          <span className="text-on-surface-variant font-normal">↔</span>
                          <span className="truncate max-w-[150px]">{compB}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-on-surface-variant flex-wrap">
                          <span>{formatDate(run.started_at)}</span>
                          {duration !== null && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />{duration}s
                            </span>
                          )}
                          {run.steps && (
                            <span className="flex items-center gap-1">
                              <Activity className="w-3 h-3" />{run.steps.length} steps
                            </span>
                          )}
                          {run.discrepancies_found > 0 && (
                            <span className="text-amber-600 font-semibold">
                              {run.discrepancies_found} discrepanc{run.discrepancies_found === 1 ? 'y' : 'ies'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status badge */}
                      <span className={cn(
                        'text-[11px] font-semibold px-2 py-0.5 rounded-full border',
                        STATUS_COLORS[run.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.cancelled,
                      )}>
                        {run.status}
                      </span>
                      {run.status === 'running' && (
                        <button
                          onClick={e => { e.stopPropagation(); cancelMutation.mutate(run.id) }}
                          disabled={cancelMutation.isPending}
                          title="Cancel this run"
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors bg-error/10 text-error border-error/20 hover:bg-red-100 disabled:opacity-50"
                        >
                          <Square className="w-2.5 h-2.5 fill-red-500" />
                          {cancelMutation.isPending ? 'Stopping…' : 'Stop'}
                        </button>
                      )}

                      <ChevronRight className={cn(
                        'w-4 h-4 text-on-surface-variant flex-shrink-0 transition-transform duration-200',
                        isExpanded && 'rotate-90'
                      )} />
                    </button>

                    {/* Steps detail */}
                    {isExpanded && (
                      <div className="px-5 pb-5 bg-surface-container/60">
                        {run.steps && run.steps.length > 0 ? (
                          <div className="ml-5 mt-2 border-l-2 border-border-subtle pl-5 space-y-3">
                            {run.steps.map((step: Step, i: number) => (
                              <div key={i} className="relative">
                                {/* Timeline dot */}
                                <div className={cn(
                                  'absolute -left-[25px] top-1 w-2 h-2 rounded-full border-2 border-white',
                                  i === run.steps!.length - 1 ? 'bg-primary' : 'bg-white/20'
                                )} />
                                <div className="flex items-start gap-2">
                                  <span className="text-sm mt-0.5 flex-shrink-0">
                                    {STEP_ICONS[step.type] || '▶'}
                                  </span>
                                  <div>
                                    <p className="text-xs font-medium text-white">{step.message}</p>
                                    <p className="text-[10px] text-on-surface-variant font-mono mt-0.5">
                                      {new Date(step.timestamp).toLocaleTimeString()}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-on-surface-variant ml-5 mt-3 py-2">
                            No step details available — run was created before step logging was enabled.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          .print\\:hidden { display: none !important; }
          header, nav { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </AppShell>
  )
}