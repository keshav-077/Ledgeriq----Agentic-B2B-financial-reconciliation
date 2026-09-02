'use client'
import { useState } from 'react'
import { X, Zap, Mail, AlertCircle, CheckCircle2, Lightbulb, Calendar, ArrowRight, TrendingDown } from 'lucide-react'
import { TypeBadge, StatusBadge } from '@/components/ui/Badge'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Company, Discrepancy } from '@/types'
import { cn } from '@/lib/utils'

// ── Fix suggestion engine ──────────────────────────────────────────────────────
function computeFixSuggestion(disc: Discrepancy): string | null {
  const a = disc.company_a_amount ?? 0
  const b = disc.company_b_amount ?? 0
  if (disc.discrepancy_type === 'missing_record') return null
  if (!a && !b) return null

  if (a && b) {
    // Decimal placement (10x or 100x off)
    if (Math.abs(a / b - 10) < 0.02 || Math.abs(b / a - 10) < 0.02) {
      const correct = Math.min(Math.abs(a), Math.abs(b))
      return `Decimal placement error detected — suggested correction: ${formatCurrency(correct * (a > b ? -1 : 1) < 0 ? correct : correct)}`
    }
    if (Math.abs(a / b - 100) < 0.02 || Math.abs(b / a - 100) < 0.02) {
      return `100× decimal error — suggested correction: ${formatCurrency(Math.min(Math.abs(a), Math.abs(b)))}`
    }

    // Sign reversal (amounts cancel)
    if (Math.abs(a + b) < 0.01) {
      return 'Sign reversal detected — amounts cancel out. Verify if this is a credit/debit mismatch.'
    }

    // Rounding (< 0.5% diff)
    const pct = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b))
    if (pct < 0.005) {
      return `Rounding difference (${(pct * 100).toFixed(3)}%) — likely a currency rounding or truncation issue.`
    }

    // VAT / tax rate
    if (Math.abs(pct - 0.18) < 0.01) return 'Difference matches 18% VAT — verify if one party excluded tax.'
    if (Math.abs(pct - 0.20) < 0.01) return 'Difference matches 20% VAT — verify if one party excluded tax.'
    if (Math.abs(pct - 0.10) < 0.01) return 'Difference matches 10% — possible partial payment or discount applied.'
  }

  return 'Verify if this transaction was partially applied or split across multiple entries in one system.'
}

interface Props {
  discrepancy: Discrepancy
  companyMap: Record<string, Company>
  onClose: () => void
  onApprove: () => void
  isApproving: boolean
  approveError?: string | null
}

// ── Fix Suggestion Card ────────────────────────────────────────────────────────
function FixSuggestionCard({ suggestion }: { suggestion: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-white/15 bg-white/5/60">
      <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-white font-bold uppercase tracking-wider mb-1">
          LedgerIQ Fix Suggestion
        </p>
        <p className="text-xs text-amber-800 leading-relaxed">{suggestion}</p>
      </div>
    </div>
  )
}

export function DiscrepancyModal({
  discrepancy: disc,
  companyMap,
  onClose,
  onApprove,
  isApproving,
  approveError,
}: Props) {
  const companyA = companyMap[disc.company_a_id]
  const companyB = companyMap[disc.company_b_id]
  const canApprove = disc.status === 'awaiting_approval'
  const isResolved = ['resolved', 'email_sent'].includes(disc.status)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-surface-elevated border border-surface-border rounded-2xl w-full max-w-[640px] max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">

        {/* ── Header ── */}
        <div className="sticky top-0 z-10 bg-surface-secondary border-b border-surface-border px-6 py-5 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <TypeBadge type={disc.discrepancy_type} />
              <StatusBadge status={disc.status} />
            </div>
            <h2 className="text-base font-semibold text-white">
              Transaction Ref: <span className="font-mono">{disc.ledger_ref}</span>
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Detected {formatDate(disc.detected_at)}
              {disc.resolved_at && ` · Resolved ${formatDate(disc.resolved_at)}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Amount Comparison (upgraded) ── */}
        <div className="px-6 py-5 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[11px] uppercase tracking-widest text-on-surface-variant font-semibold">Amount Comparison</p>
            <span className="text-[10px] text-on-surface-variant font-mono">{disc.ledger_ref}</span>
          </div>

          {/* Side-by-side diff */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            {/* Company A */}
            <div className={cn(
              'rounded-xl p-4 border-2 transition-colors',
              disc.company_a_amount != null && disc.company_b_amount != null
                ? Math.abs((disc.company_a_amount ?? 0) - (disc.company_b_amount ?? 0)) > 0.01
                  ? 'border-error/20 bg-error/10/50'
                  : 'border-white/15 bg-white/5/50'
                : 'border-border-subtle bg-surface-elevated',
            )}>
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-2 h-2 rounded-full bg-blue-400" />
                <p className="text-[10px] text-on-surface-variant font-semibold uppercase tracking-wide truncate">
                  {companyA?.name ?? 'Company A'}
                </p>
              </div>
              <p className={cn(
                'text-2xl font-bold tabular-nums',
                disc.company_a_amount != null && disc.company_b_amount != null
                  ? Math.abs((disc.company_a_amount ?? 0) - (disc.company_b_amount ?? 0)) > 0.01
                    ? 'text-error'
                    : 'text-white'
                  : 'text-white',
              )}>
                {disc.company_a_amount != null ? formatCurrency(disc.company_a_amount, disc.currency ?? undefined) : <span className="text-on-surface-variant text-base">—</span>}
              </p>
              {/* Tenant mailini göster, yoksa default'a düşme boş bırak ki yanıltmasın */}
              {companyA?.reconciliation_email && companyA.reconciliation_email !== 'accounting@acme.com' && (
                <p className="text-[10px] text-on-surface-variant mt-1.5 truncate">{companyA.reconciliation_email}</p>
              )}
            </div>

            {/* Company B */}
            <div className={cn(
              'rounded-xl p-4 border-2 transition-colors',
              disc.company_b_amount == null
                ? 'border-red-300 bg-error/10'
                : disc.company_a_amount != null
                  ? Math.abs((disc.company_a_amount ?? 0) - (disc.company_b_amount ?? 0)) > 0.01
                    ? 'border-error/20 bg-error/10/50'
                    : 'border-white/15 bg-white/5/50'
                  : 'border-border-subtle bg-surface-elevated',
            )}>
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-2 h-2 rounded-full bg-purple-400" />
                <p className="text-[10px] text-on-surface-variant font-semibold uppercase tracking-wide truncate">
                  {companyB?.name ?? 'Company B'}
                </p>
              </div>
              <p className={cn(
                'text-2xl font-bold tabular-nums',
                disc.company_b_amount == null
                  ? 'text-error text-base'
                  : disc.company_a_amount != null
                    ? Math.abs((disc.company_a_amount ?? 0) - (disc.company_b_amount ?? 0)) > 0.01
                      ? 'text-error'
                      : 'text-white'
                    : 'text-white',
              )}>
                {disc.company_b_amount != null
                  ? formatCurrency(disc.company_b_amount, disc.currency ?? undefined)
                  : <span className="text-error font-semibold text-sm">NOT FOUND</span>}
              </p>
              {companyB?.reconciliation_email && (
                <p className="text-[10px] text-on-surface-variant mt-1.5 truncate">{companyB.reconciliation_email}</p>
              )}
            </div>
          </div>

          {/* Difference bar */}
          {disc.difference != null && disc.difference > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-error/10 border border-error/20 mb-3">
              <TrendingDown className="w-4 h-4 text-error flex-shrink-0" />
              <span className="text-sm font-bold text-red-700">{formatCurrency(disc.difference, disc.currency ?? undefined)} difference</span>
              <span className="text-xs text-red-400 ml-auto">unreconciled amount</span>
            </div>
          )}

          {/* Fix Suggestion */}
          {(() => {
            const suggestion = computeFixSuggestion(disc)
            if (!suggestion) return null
            return (
              <FixSuggestionCard suggestion={suggestion} />
            )
          })()}
        </div>

        {/* ── Timeline ── */}
        <div className="px-6 py-4 border-b border-border-subtle">
          <p className="text-[11px] uppercase tracking-widest text-on-surface-variant font-semibold mb-3">Event Timeline</p>
          <div className="flex items-center gap-0">
            {[
              {
                label: 'Detected',
                date: disc.detected_at,
                icon: <AlertCircle className="w-3.5 h-3.5" />,
                color: 'bg-amber-100 border-amber-300 text-white',
                dot: 'bg-amber-400',
              },
              {
                label: disc.status === 'resolved' ? 'Resolved' : disc.status === 'email_sent' ? 'Email Sent' : 'Pending',
                date: disc.resolved_at ?? null,
                icon: disc.status === 'resolved'
                  ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : <Mail className="w-3.5 h-3.5" />,
                color: disc.status === 'resolved'
                  ? 'bg-white/10 border-white/20 text-white'
                  : 'bg-white/10 border-border-subtle text-on-surface-variant',
                dot: disc.status === 'resolved' ? 'bg-surface-elevated' : 'bg-white/20',
              },
            ].map((step, i, arr) => (
              <div key={i} className="flex items-center flex-1">
                <div className="flex flex-col items-center min-w-[90px]">
                  <div className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold', step.color)}>
                    {step.icon}
                    {step.label}
                  </div>
                  <p className="text-[9px] text-on-surface-variant mt-1 font-mono">
                    {step.date ? formatDate(step.date) : '—'}
                  </p>
                </div>
                {i < arr.length - 1 && (
                  <div className="flex-1 flex items-center justify-center px-2 mb-4">
                    <div className="flex-1 h-px bg-white/15" />
                    <ArrowRight className="w-3 h-3 text-on-surface-variant/70 flex-shrink-0 mx-1" />
                    <div className="flex-1 h-px bg-white/15" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── AI Analysis ── */}
        <div className="px-6 py-5 border-b border-surface-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-md bg-accent-green/15 border border-accent-green/25 flex items-center justify-center">
              <Zap className="w-3 h-3 text-accent-green" />
            </div>
            <p className="text-[11px] uppercase tracking-widest text-text-muted">AI Analysis</p>
          </div>
          {disc.ai_analysis ? (
            <p className="text-sm text-on-surface leading-relaxed">{disc.ai_analysis}</p>
          ) : (
            <div className="flex items-center gap-2 text-text-secondary">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">
                Analysis will be generated by the Gemini agent after running reconciliation (Phase 2).
              </p>
            </div>
          )}
        </div>

        {/* ── Email Draft ── */}
        <div className="px-6 py-5 border-b border-surface-border">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-md bg-accent-blue/15 border border-accent-blue/25 flex items-center justify-center">
              <Mail className="w-3 h-3 text-accent-blue" />
            </div>
            <p className="text-[11px] uppercase tracking-widest text-text-muted">Email Draft</p>
            {disc.email_draft && (
              <span className="ml-auto text-[10px] text-text-muted">
                To: {companyB?.reconciliation_email ?? 'counterparty contact'}
              </span>
            )}
          </div>
          {disc.email_draft ? (
            <div className="bg-surface-primary rounded-xl p-5 border border-surface-border">
              <pre className="text-sm text-on-surface whitespace-pre-wrap font-sans leading-relaxed">
                {disc.email_draft}
              </pre>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-text-secondary">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm">
                Email draft will be composed by the Gemini agent (Phase 2).
              </p>
            </div>
          )}
        </div>

        {/* ── Actions ── */}
        <div className="px-6 py-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-xs text-text-muted max-w-xs">
            {isResolved ? (
              <span className="flex items-center gap-1.5 text-accent-green">
                <CheckCircle2 className="w-3.5 h-3.5" /> This discrepancy has been handled.
              </span>
            ) : canApprove ? (
              'Approving will trigger the email send and mark this discrepancy as resolved.'
            ) : (
              `Status: ${disc.status} — no action required.`
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
            {approveError && (
              <p className="text-red-400 text-xs">{approveError}</p>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-on-surface-variant hover:text-white border border-border-subtle hover:border-white/20 rounded-xl transition-colors"
            >
              Close
            </button>
            <button
              onClick={onApprove}
              disabled={!canApprove || isApproving}
              className="px-4 py-2 text-sm font-semibold bg-accent-green hover:bg-accent-green-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors flex items-center gap-2"
            >
              {isApproving ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Mail className="w-3.5 h-3.5" />
                  Approve &amp; Send
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
