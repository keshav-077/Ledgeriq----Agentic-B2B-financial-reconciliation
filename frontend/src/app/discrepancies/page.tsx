'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, Filter, ChevronRight, CheckCircle2, Zap } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { TypeBadge, StatusBadge } from '@/components/ui/Badge'

const DiscrepancyModal = dynamic(
  () => import('@/components/dashboard/DiscrepancyModal').then(m => ({ default: m.DiscrepancyModal })),
  { ssr: false }
)
import { getCompanies, getDiscrepancies, approveDiscrepancy, getCompanySettings } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Company, Discrepancy, DiscrepancyType } from '@/types'

const TYPE_FILTERS: { label: string; value: string }[] = [
  { label: 'All Types',       value: 'all' },
  { label: 'Amount Mismatch', value: 'amount_mismatch' },
  { label: 'Missing Record',  value: 'missing_record' },
  { label: 'Date Mismatch',   value: 'date_mismatch' },
  { label: 'Duplicate',       value: 'duplicate' },
]

const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: 'All Statuses',     value: 'all' },
  { label: 'Awaiting Approval', value: 'awaiting_approval' },
  { label: 'Detected',         value: 'detected' },
  { label: 'Email Sent',       value: 'email_sent' },
  { label: 'Resolved',         value: 'resolved' },
]

export default function DiscrepanciesPage() {
  const [selected, setSelected]       = useState<Discrepancy | null>(null)
  const [typeFilter, setTypeFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [approveError, setApproveError] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies'],
    queryFn: getCompanies,
  })

  const {
    data: allDiscs = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery<Discrepancy[]>({
    queryKey: ['discrepancies'],
    queryFn: () => getDiscrepancies(),
    refetchInterval: 30_000,
  })

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: getCompanySettings,
    staleTime: 300_000,
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

  const companyMap = companies.reduce<Record<string, Company>>((acc, c) => {
    acc[c.id] = c
    return acc
  }, {})

  // FORCE TENANT OVERRIDE: Discrepancy sayfasında da Company A (Sol Taraf) her zaman Tenant'ın kendisidir.
  const tenantName = (companySettings as any)?.identity?.company_name;
  const tenantEmail = (companySettings as any)?.contact?.email || (companySettings as any)?.contact?.contact_email;

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

  const filtered = allDiscs
    .filter(d => typeFilter   === 'all' || d.discrepancy_type === typeFilter)
    .filter(d => statusFilter === 'all' || d.status === statusFilter)

  const awaitingCount = allDiscs.filter(d => d.status === 'awaiting_approval').length

  return (
    <AppShell>
      {/* Page header */}
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-headline-lg-mobile md:text-headline-lg text-white">Discrepancies</h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            AI-detected financial mismatches and Human-in-the-Loop approval workflow
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-white border border-border-subtle hover:border-white/20 rounded-xl transition-colors disabled:opacity-50 flex-shrink-0"
        >
          <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Summary pills */}
      {!isLoading && awaitingCount > 0 && (
        <div className="flex items-center gap-2 mb-5 px-4 py-3 bg-accent-green/10 border border-accent-green/20 rounded-xl">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-green" />
          </span>
          <p className="text-sm text-accent-green font-medium">
            {awaitingCount} email draft{awaitingCount > 1 ? 's' : ''} awaiting your approval
          </p>
          <button
            onClick={() => setStatusFilter('awaiting_approval')}
            className="ml-auto text-xs text-accent-green/70 hover:text-accent-green flex items-center gap-0.5 transition-colors"
          >
            Filter <ChevronRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-6 mb-5 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-2 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Type
          </p>
          <div className="flex items-center gap-1 flex-wrap">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-medium transition-all',
                  typeFilter === f.value
                    ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/20'
                    : 'text-on-surface-variant hover:text-white border border-transparent',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-2 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Status
          </p>
          <div className="flex items-center gap-1 flex-wrap">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  'px-3 py-1 rounded-lg text-xs font-medium transition-all',
                  statusFilter === f.value
                    ? 'bg-[#bec8d2]/10 text-[#bec8d2] border border-[#bec8d2]/20'
                    : 'text-on-surface-variant hover:text-white hover:bg-white/10 border border-transparent',
                )}
              >
                {f.label}
                {f.value === 'awaiting_approval' && awaitingCount > 0 && (
                  <span className="ml-1.5 bg-accent-green text-white text-[9px] px-1.5 py-px rounded-full font-semibold">
                    {awaitingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-elevated border border-border-subtle rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
          <p className="text-sm font-semibold text-white">
            All Discrepancies
            {!isLoading && (
              <span className="ml-2 text-on-surface-variant font-normal text-xs">
                {filtered.length} of {allDiscs.length}
              </span>
            )}
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-border-subtle border-t-[#ffffff] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          allDiscs.length === 0 ? (
          // ── All clear — zero discrepancies in system ──────────────────────
          <div className="flex flex-col items-center justify-center py-20 text-center px-8 select-none">
            <div className="relative mb-6">
              {/* Triple ping rings */}
              <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'rgba(255,255,255,0.15)', animationDuration: '2s' }} />
              <span className="absolute inset-[-8px] rounded-full animate-ping" style={{ background: 'rgba(255,255,255,0.08)', animationDuration: '2s', animationDelay: '0.4s' }} />
              <div className="relative w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.35)' }}>
                <CheckCircle2 className="w-9 h-9 text-white" />
              </div>
            </div>
            <h3 className="text-white text-xl font-bold mb-2">All clear!</h3>
            <p className="text-on-surface-variant text-sm leading-relaxed max-w-xs mb-5">
              No discrepancies detected. All counterparty ledgers are perfectly reconciled.
            </p>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-white"
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
              <Zap className="w-3.5 h-3.5 animate-pulse" />
              LedgerIQ AI is monitoring your accounts in real-time
            </div>
          </div>
          ) : (
          // ── No match — filters returned nothing ───────────────────────────
          <div className="flex flex-col items-center justify-center py-16 text-center px-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.15)' }}>
              <AlertTriangle className="w-6 h-6 text-on-surface-variant animate-pulse" style={{ animationDuration: '2s' }} />
            </div>
            <p className="text-white font-semibold mb-1.5">No matching discrepancies</p>
            <p className="text-on-surface-variant text-sm">
              Adjust the filters or run the reconciliation agent.
            </p>
          </div>
          )
        ) : (
          <div className="divide-y divide-border-subtle">
            {filtered.map(disc => {
              const cA = companyMap[disc.company_a_id]
              const cB = companyMap[disc.company_b_id]
              return (
                <div
                  key={disc.id}
                  onClick={() => { setSelected(disc); setApproveError(null) }}
                  className="flex items-center gap-3 px-4 sm:px-6 py-4 hover:bg-surface-container transition-colors cursor-pointer group"
                >
                  {/* Ref + badges */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-mono font-semibold text-white">{disc.ledger_ref}</span>
                      <TypeBadge type={disc.discrepancy_type} />
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-on-surface-variant flex-wrap">
                      <span className="truncate max-w-[120px] sm:max-w-[140px]">{cA?.name ?? `…${disc.company_a_id.slice(-6)}`}</span>
                      <span className="text-on-surface-variant">↔</span>
                      <span className="truncate max-w-[120px] sm:max-w-[140px]">{cB?.name ?? `…${disc.company_b_id.slice(-6)}`}</span>
                      {disc.difference != null && (
                        <span className="md:hidden text-error font-medium whitespace-nowrap">· {formatCurrency(disc.difference, (disc as Discrepancy & { currency?: string }).currency ?? undefined)}</span>
                      )}
                    </div>
                  </div>

                  {/* Amounts — desktop */}
                  <div className="hidden md:block text-right flex-shrink-0 w-36">
                    {disc.difference != null && (
                      <>
                        <p className="text-sm font-semibold text-error">{formatCurrency(disc.difference, (disc as Discrepancy & { currency?: string }).currency ?? undefined)}</p>
                        <p className="text-[10px] text-on-surface-variant">difference</p>
                      </>
                    )}
                  </div>

                  {/* Date — desktop */}
                  <div className="hidden lg:block text-right flex-shrink-0 w-28">
                    <p className="text-xs text-on-surface-variant">{formatDate(disc.detected_at)}</p>
                  </div>

                  {/* Status + caret */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusBadge status={disc.status} />
                    <ChevronRight className="w-4 h-4 text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
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
