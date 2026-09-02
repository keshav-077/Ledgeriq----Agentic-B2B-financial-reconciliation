'use client'
import { ArrowUpRight } from 'lucide-react'
import { openGeminiPanel } from './GeminiPanel'

interface Props {
  context: Record<string, unknown>
  label?: string
  page?: string
  message?: string
}

export function GeminiContextButton({ context, label, page, message }: Props) {
  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    const contextMessage = message ?? buildMessage(context)
    openGeminiPanel({ contextMessage, context, page })
  }

  return (
    <button
      onClick={handleClick}
      title="Ask LedgerIQ"
      className="group inline-flex items-center gap-0.5 ml-1 p-0.5 rounded-md text-white/30 hover:text-white hover:bg-white/10 transition-colors"
    >
      <ArrowUpRight className="w-3 h-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      <span className="hidden group-hover:inline text-[10px] font-medium text-white pr-0.5">
        Ask LedgerIQ
      </span>
    </button>
  )
}

function fmt(val: unknown): string {
  if (typeof val !== 'string') return String(val)
  return val.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function buildMessage(ctx: Record<string, unknown>): string {
  const type = ctx.type as string
  if (type === 'master_balance') {
    return `Tell me about this balance record:\n- Company: ${ctx.company_name}\n- Tax ID: ${ctx.tax_id}\n- Customer Code: ${ctx.customer_code}\n- Balance: ${Number(ctx.balance).toLocaleString()} ${ctx.currency}\n- Status: ${fmt(ctx.status)}`
  }
  if (type === 'discrepancy') {
    return `Explain this discrepancy:\n- Ref: ${ctx.ledger_ref}\n- Type: ${ctx.discrepancy_type}\n- Difference: $${ctx.difference}`
  }
  if (type === 'company') {
    return `Tell me about this company: ${ctx.name} (Tax ID: ${ctx.tax_id})`
  }
  return `Analyze this data: ${JSON.stringify(ctx, null, 2)}`
}
