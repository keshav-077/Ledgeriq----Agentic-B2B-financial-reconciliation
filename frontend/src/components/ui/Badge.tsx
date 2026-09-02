import { cn } from '@/lib/utils'
import type { DiscrepancyType, DiscrepancyStatus } from '@/types'

const TYPE_CONFIG: Record<DiscrepancyType, { label: string; cls: string }> = {
  amount_mismatch: { label: 'Amount Mismatch', cls: 'bg-white/10 text-white border-white/15' },
  missing_record:  { label: 'Missing Record',  cls: 'bg-error/10 text-error border-error/20' },
  date_mismatch:   { label: 'Date Mismatch',   cls: 'bg-white/5 text-on-surface-variant border-white/10' },
  duplicate:       { label: 'Duplicate',        cls: 'bg-white/5 text-secondary border-white/10' },
}

const STATUS_CONFIG: Record<DiscrepancyStatus, { label: string; cls: string; pulse?: boolean }> = {
  detected:          { label: 'Detected',          cls: 'bg-white/5 text-on-surface-variant border-white/10' },
  awaiting_approval: { label: 'Awaiting Approval', cls: 'bg-white/10 text-white border-white/20', pulse: true },
  email_sent:        { label: 'Email Sent',         cls: 'bg-secondary/15 text-secondary border-secondary/20' },
  resolved:          { label: 'Resolved',           cls: 'bg-white/10 text-white border-white/15' },
  disputed:          { label: 'Disputed',           cls: 'bg-error/10 text-error border-error/20' },
}

export function TypeBadge({ type }: { type: DiscrepancyType }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.amount_mismatch
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border', cfg.cls)}>
      {cfg.label}
    </span>
  )
}

export function StatusBadge({ status }: { status: DiscrepancyStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.detected
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border', cfg.cls)}>
      {cfg.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-surface-elevated opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-surface-elevated" />
        </span>
      )}
      {cfg.label}
    </span>
  )
}
