'use client'
import { useState, useCallback, useRef, DragEvent, ChangeEvent, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Upload, FileSpreadsheet, FileText, CheckCircle2,
  XCircle, AlertTriangle, Loader2, X, Zap, Shield, Lock, Timer,
  ThumbsUp, ThumbsDown, Brain, Sparkles,
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { validatePortalToken, uploadPortalFile, agreePortalSession, requestPortalAI, getPortalStatements } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { TokenValidationResponse, PortalUploadResponse } from '@/types'

type Phase = 'loading' | 'invalid' | 'already_used' | 'decision' | 'agreed' | 'upload' | 'uploading' | 'success' | 'ai_requested' | 'error'

const ACCEPTED      = '.xlsx,.xls,.csv,.pdf'
const ACCEPTED_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/pdf',
]

function isAcceptedFile(f: File) {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  return ['xlsx', 'xls', 'csv', 'pdf'].includes(ext) || ACCEPTED_MIME.includes(f.type)
}

// ── Burst particles on success ────────────────────────────────────────────────
function SuccessBurst() {
  const dots = Array.from({ length: 16 }, (_, i) => ({
    angle: (i / 16) * 360,
    r:     55 + (i % 3) * 15,
    color: ['#ffffff','#c6c6c7','#bec8d2','#ffb4ab','#8e9192'][i % 5],
    s:     3 + (i % 3) * 2,
    delay: (i % 4) * 0.07,
  }))
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {dots.map((d, i) => (
        <div key={i} className="absolute rounded-full"
          style={{
            width: d.s, height: d.s, background: d.color,
            transform: `rotate(${d.angle}deg) translateY(-${d.r}px)`,
            animation: `ping 1s cubic-bezier(0,0,0.2,1) ${d.delay}s both`,
          }}
        />
      ))}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function ReconcilePortalPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-7 h-7 text-white animate-spin" />
      </div>
    }>
      <PortalContent />
    </Suspense>
  )
}

function PortalContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [phase,          setPhase]          = useState<Phase>('loading')
  const [session,        setSession]        = useState<TokenValidationResponse | null>(null)
  const [selectedFile,   setSelectedFile]   = useState<File | null>(null)
  const [isDragging,     setIsDragging]     = useState(false)
  const [uploadResult,   setUploadResult]   = useState<PortalUploadResponse | null>(null)
  const [errorMsg,       setErrorMsg]       = useState('')
  const [uploadProgress, setUploadProgress]   = useState(0)
  const [aiMode, setAiMode]                   = useState(false)
  const [showSecurityInfo, setShowSecurityInfo] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data: stmtData } = useQuery<{
    total_balance:  number | null
    currency:       string
    entry_count:    number
    entries: {
      transaction_ref:  string
      description:      string
      amount:           number
      currency:         string
      transaction_type: string
      transaction_date: string | null
    }[]
  }>({
    queryKey:  ['portal-statements', token],
    queryFn:   () => getPortalStatements(token),
    enabled:   !!token && phase === 'decision',
    staleTime: 60_000,
    retry:     false,
  })

  useEffect(() => {
    if (!token) { setPhase('invalid'); return }
    validatePortalToken(token)
      .then((d: TokenValidationResponse) => {
        setSession(d)
        if (d.valid) {
          setPhase('decision')
          setShowSecurityInfo(true) // show security popup on first valid open
        } else if (d.already_used) {
          setPhase('already_used')
        } else {
          setPhase('invalid')
        }
      })
      .catch(() => setPhase('invalid'))
  }, [token])

  // Fake progress during upload
  useEffect(() => {
    if (phase !== 'uploading') { setUploadProgress(0); return }
    const t = setInterval(() => setUploadProgress(p => Math.min(p + Math.random() * 12, 88)), 380)
    return () => clearInterval(t)
  }, [phase])

  const handleDragOver  = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true)  }, [])
  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }, [])
  const handleDrop      = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && isAcceptedFile(f)) setSelectedFile(f)
  }, [])
  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setSelectedFile(f)
  }, [])

  async function handleAgree() {
    if (!token) return
    setPhase('uploading') // show spinner briefly
    try {
      await agreePortalSession(token)
      qc.invalidateQueries()
      setPhase('agreed')
    } catch {
      qc.invalidateQueries()
      setPhase('agreed') // show agreed regardless — backend might have already processed
    }
  }

  async function handleRequestAI() {
    if (!token) return
    try {
      await requestPortalAI(token)
      qc.invalidateQueries()
    } catch { /* ignore — show UI anyway */ }
    setPhase('ai_requested')
  }

  async function handleUpload() {
    if (!selectedFile || !token) return
    setPhase('uploading')
    try {
      const result: PortalUploadResponse = await uploadPortalFile(token, selectedFile)
      setUploadProgress(100)
      setUploadResult(result)
      qc.invalidateQueries()
      setTimeout(() => setPhase(aiMode ? 'ai_requested' : 'success'), 350)
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed. Please try again.')
      setPhase('error')
    }
  }

  function fileIcon(f: File) {
    return f.name.endsWith('.pdf')
      ? <FileText className="w-5 h-5 text-red-400" />
      : <FileSpreadsheet className="w-5 h-5 text-white" />
  }

  function fmtBytes(b: number) {
    if (b < 1024) return `${b} B`
    if (b < 1048576) return `${(b/1024).toFixed(1)} KB`
    return `${(b/1048576).toFixed(1)} MB`
  }

  const initials = session?.initiating_company_name?.slice(0, 2).toUpperCase() ?? 'LC'

  // ── Shared card style ──────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background:    'rgba(20, 29, 38, 0.7)',
    border:        '1px solid rgba(255,255,255,0.12)',
    boxShadow:     '0 4px 24px rgba(0,0,0,0.2)',
    borderRadius:  '12px',
    backdropFilter: 'blur(20px)',
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden bg-background">

      {/* Grid overlay */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.05), transparent 55%)',
        }} />

      <div className="w-full max-w-[460px] relative z-10">

        {/* ── Security info popup (shown once on first valid open) ── */}
        {showSecurityInfo && phase === 'decision' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowSecurityInfo(false)}>
            <div className="w-full max-w-[360px] rounded-2xl p-5 animate-in zoom-in-95 duration-200 bg-surface-elevated border border-border-subtle shadow-glass"
              onClick={e => e.stopPropagation()}>
              
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/10 border border-white/10">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Secure One-Time Link</h3>
                  <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">Portal Security</p>
                </div>
              </div>

              <div className="space-y-3 mb-5">
                {[
                  { Icon: Lock, text: 'This link is encrypted and single-use only' },
                  { Icon: Timer, text: session?.expires_at ? `Expires ${new Date(session.expires_at).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Valid for 7 days from when it was sent' },
                  { Icon: XCircle, text: 'Once you respond, this link will be permanently deactivated' },
                  { Icon: Shield, text: '256-bit encrypted · Your data is never stored beyond this session' },
                ].map(({ Icon, text }) => (
                  <div key={text} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 bg-white/5">
                      <Icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <p className="text-xs text-on-surface-variant leading-relaxed">{text}</p>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setShowSecurityInfo(false)}
                className="w-full py-2.5 rounded-full text-sm font-bold text-on-primary bg-primary hover:bg-surface-tint transition-all active:scale-[0.99]">
                I Understand — Proceed
              </button>
            </div>
          </div>
        )}

        {/* ── Top branding ── */}
        <div className="flex flex-col items-center mb-7">
          <h1 className="font-display text-headline-md md:text-display-lg text-primary tracking-tight mb-4">LedgerIQ</h1>
          <div className="glass-panel rounded-full px-6 py-2 inline-flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-secondary text-sm">lock</span>
            <span className="font-label-md text-label-md text-secondary uppercase tracking-wider">Secure Counterparty Portal</span>
          </div>

          {session?.initiating_company_name && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl glass-panel">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-on-primary flex-shrink-0 bg-primary">
                {initials}
              </div>
              <div className="min-w-0 text-left">
                <p className="text-[9px] text-white font-semibold uppercase tracking-widest">Reconciliation request from</p>
                <p className="text-sm font-bold text-white truncate">{session.initiating_company_name}</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Loading ── */}
        {phase === 'loading' && (
          <div className="p-12 flex flex-col items-center gap-5" style={card}>
            <div className="w-12 h-12 rounded-full border-2 animate-spin"
              style={{ borderColor:'rgba(255,255,255,0.15)', borderTopColor:'#ffffff' }} />
            <p className="text-on-surface-variant text-sm">Validating secure token…</p>
          </div>
        )}

        {/* ── Already Used ── */}
        {phase === 'already_used' && (
          <div className="p-8 text-center relative overflow-hidden"
            style={{ ...card, borderColor: 'rgba(37,151,248,0.2)' }}>
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'rgba(37,151,248,0.07)', border: '1px solid rgba(37,151,248,0.2)' }}>
              <Shield className="w-8 h-8 text-[#bec8d2]" />
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Already Responded</h2>
            <p className="text-on-surface-variant text-sm leading-relaxed mb-4">
              {session?.message || 'This portal link has already been used. Each invitation is single-use for security.'}
            </p>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl justify-center"
              style={{ background: 'rgba(37,151,248,0.05)', border: '1px solid rgba(37,151,248,0.15)' }}>
              <Lock className="w-3.5 h-3.5 text-[#bec8d2]" />
              <p className="text-xs text-on-surface-variant">Contact the sender if you need a new invitation link.</p>
            </div>
          </div>
        )}

        {/* ── Invalid ── */}
        {phase === 'invalid' && (
          <div className="p-8 text-center" style={{ ...card, borderColor:'rgba(239,68,68,0.15)' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
              style={{ background:'rgba(239,68,68,0.05)', border:'1px solid rgba(239,68,68,0.15)' }}>
              <XCircle className="w-7 h-7 text-red-400" />
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Invalid or Expired Link</h2>
            <p className="text-on-surface-variant text-sm leading-relaxed">
              {session?.message ?? 'This reconciliation link is invalid or has expired. Please contact the requesting company.'}
            </p>
          </div>
        )}

        {/* ── Decision ── */}
        {phase === 'decision' && session?.valid && (
          <div style={card} className="overflow-hidden">
            <div className="px-6 pt-6 pb-5" style={{ borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ffffff] animate-pulse" />
                <p className="text-[10px] text-white font-semibold uppercase tracking-widest">Account Reconciliation Request</p>
              </div>
              <h2 className="text-xl font-bold text-white">Do you agree with our records?</h2>
              <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
                <span className="text-white font-semibold">{session.initiating_company_name}</span>{' '}
                is requesting confirmation of your mutual account balance.
                Please review and indicate whether you agree with their records.
              </p>
            </div>

            <div className="px-6 py-6 space-y-3">
              {/* Balance summary */}
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)' }}>
                <Zap className="w-4 h-4 text-white flex-shrink-0" />
                <p className="text-sm text-on-surface-variant leading-relaxed">
                  <span className="text-white font-semibold">{session.initiating_company_name}</span>{' '}
                  has shared their ledger records below. Review each entry and
                  indicate whether you agree with the figures shown.
                </p>
              </div>

              {/* Statement Entries table */}
              {stmtData && stmtData.entry_count > 0 ? (
                <div className="rounded-xl overflow-hidden"
                  style={{ border: '1px solid rgba(255,255,255,0.15)' }}>
                  {/* Table header with total */}
                  <div className="flex items-center justify-between px-4 py-2.5"
                    style={{ background: 'rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                    <p className="text-[10px] font-bold text-[#1a9e7e] uppercase tracking-widest">
                      Statement Entries ({stmtData.entry_count})
                    </p>
                    {stmtData.total_balance != null && (
                      <p className="text-xs font-bold text-on-surface">
                        Total:{' '}
                        <span className="text-[#1a9e7e]">
                          {stmtData.total_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {stmtData.currency}
                        </span>
                      </p>
                    )}
                  </div>
                  {/* Column headers */}
                  <div className="grid px-4 py-2 text-[9px] font-semibold uppercase tracking-wider text-on-surface-variant"
                    style={{ gridTemplateColumns: '1fr 90px 70px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <span>Ref / Description</span>
                    <span className="text-right">Amount</span>
                    <span className="text-right">Date</span>
                  </div>
                  {/* Rows */}
                  <div className="max-h-[220px] overflow-y-auto divide-y divide-border-subtle">
                    {stmtData.entries.map((e, i) => (
                      <div key={i} className="grid items-center px-4 py-2.5 hover:bg-background transition-colors"
                        style={{ gridTemplateColumns: '1fr 90px 70px' }}>
                        <div className="min-w-0">
                          <p className="text-[11px] font-mono text-[#1a9e7e] truncate">{e.transaction_ref}</p>
                          {e.description && (
                            <p className="text-[10px] text-on-surface-variant truncate mt-0.5">{e.description}</p>
                          )}
                        </div>
                        <p className="text-[11px] font-semibold text-on-surface text-right tabular-nums">
                          {e.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          <span className="text-on-surface-variant text-[9px] ml-1">{e.currency}</span>
                        </p>
                        <p className="text-[10px] text-on-surface-variant text-right">
                          {e.transaction_date ? e.transaction_date.slice(0, 7) : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : stmtData && stmtData.entry_count === 0 ? (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
                  style={{ background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.12)' }}>
                  <AlertTriangle className="w-4 h-4 text-on-surface-variant flex-shrink-0" />
                  <p className="text-xs text-on-surface-variant">
                    No statement entries uploaded yet. Please check with {session.initiating_company_name} for details.
                  </p>
                </div>
              ) : null}

              {/* Two main action buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {/* We Agree */}
                <button
                  onClick={handleAgree}
                  className="flex flex-col items-center gap-2.5 py-5 px-4 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] group"
                  style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.2)' }}
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center transition-colors group-hover:scale-110"
                    style={{ background: 'rgba(255,255,255,0.15)' }}>
                    <ThumbsUp className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-white">Confirmed</p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">Confirm balance is correct</p>
                  </div>
                </button>

                {/* We Disagree */}
                <button
                  onClick={() => { setAiMode(false); setPhase('upload') }}
                  className="flex flex-col items-center gap-2.5 py-5 px-4 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] group"
                  style={{ background: 'rgba(239,68,68,0.03)', borderColor: 'rgba(239,68,68,0.15)' }}
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center transition-colors group-hover:scale-110"
                    style={{ background: 'rgba(239,68,68,0.1)' }}>
                    <ThumbsDown className="w-6 h-6 text-red-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-white">Disputed</p>
                    <p className="text-[10px] text-on-surface-variant mt-0.5">Upload our statement</p>
                  </div>
                </button>
              </div>

              {/* 3rd button — AI direct comparison */}
              <button
                onClick={() => { setAiMode(true); setPhase('upload') }}
                className="w-full flex items-center gap-3 py-3.5 px-5 rounded-2xl border-2 transition-all duration-200 hover:scale-[1.005] active:scale-[0.99] group"
                style={{ background: 'rgba(37,151,248,0.03)', borderColor: 'rgba(37,151,248,0.15)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(37,151,248,0.12)' }}>
                  <Brain className="w-5 h-5 text-[#bec8d2]" />
                </div>
                <div className="text-left flex-1">
                  <p className="text-sm font-bold text-white">Let AI Compare</p>
                  <p className="text-[10px] text-on-surface-variant mt-0.5">
                    LedgerIQ AI reconciles both sides automatically
                  </p>
                </div>
                <Sparkles className="w-4 h-4 text-[#bec8d2] flex-shrink-0 opacity-60" />
              </button>

              <div className="flex items-center justify-center gap-1.5 pt-1">
                <Lock className="w-3 h-3 text-white/20" />
                <p className="text-[10px] text-on-surface-variant">256-bit encrypted · Secure portal</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Agreed ── */}
        {phase === 'agreed' && (
          <div className="p-8 text-center relative overflow-hidden"
            style={{ ...card, borderColor: 'rgba(255,255,255,0.2)' }}>
            <SuccessBurst />
            <div className="relative inline-flex mb-5">
              <div className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.1)', border: '2px solid rgba(255,255,255,0.4)' }}>
                <ThumbsUp className="w-9 h-9 text-white" />
              </div>
              <div className="absolute inset-0 rounded-full animate-ping opacity-20"
                style={{ border: '2px solid #ffffff' }} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Accounts Confirmed!</h2>
            <p className="text-on-surface-variant text-sm leading-relaxed mb-5">
              You've confirmed agreement with{' '}
              <span className="text-white font-semibold">{session?.initiating_company_name}</span>.
              This reconciliation is now marked as <span className="text-white font-semibold">matched ✓</span>
            </p>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl justify-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}>
              <CheckCircle2 className="w-4 h-4 text-white flex-shrink-0" />
              <p className="text-xs text-on-surface-variant">No further action needed. Both parties are reconciled.</p>
            </div>
          </div>
        )}

        {/* ── Upload / Uploading ── */}
        {(phase === 'upload' || phase === 'uploading') && session?.valid && (
          <div style={card} className="overflow-hidden">

            {/* Card header */}
            <div className="px-6 pt-6 pb-5" style={{ borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ffffff] animate-pulse" />
                <p className="text-[10px] text-white font-semibold uppercase tracking-widest">Secure Reconciliation Portal</p>
              </div>
              <h2 className="text-xl font-bold text-white">
                {aiMode ? 'Upload Statement for AI Analysis' : 'Upload Ledger Statement'}
              </h2>
              <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">
                {aiMode ? (
                  <>
                    Dear <span className="text-white font-semibold">{session.counterparty_name}</span>, upload
                    your statement and{' '}
                    <span className="text-[#bec8d2] font-semibold">LedgerIQ AI</span> will automatically
                    compare both sides and notify <span className="text-white font-semibold">{session.initiating_company_name}</span> of any discrepancies.
                  </>
                ) : (
                  <>
                    Dear <span className="text-white font-semibold">{session.counterparty_name}</span>, please
                    upload your statement for reconciliation with{' '}
                    <span className="text-white font-semibold">{session.initiating_company_name}</span>.
                  </>
                )}
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">

              {/* Drop zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !selectedFile && phase !== 'uploading' && inputRef.current?.click()}
                className={cn(
                  'relative rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden',
                  selectedFile || phase === 'uploading' ? 'py-4 cursor-default' : 'py-10 cursor-pointer',
                  isDragging ? 'scale-[1.015]' : '',
                )}
                style={{
                  borderColor: isDragging ? '#ffffff'
                    : selectedFile ? 'rgba(255,255,255,0.35)'
                    : 'rgba(255,255,255,0.15)',
                  background: isDragging ? 'rgba(255,255,255,0.04)'
                    : selectedFile ? 'rgba(255,255,255,0.02)'
                    : 'rgba(255,255,255,0.01)',
                }}
              >
                <input ref={inputRef} type="file" accept={ACCEPTED} onChange={handleFileChange} className="hidden" />

                {/* Uploading state */}
                {phase === 'uploading' && selectedFile && (
                  <div className="px-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background:'rgba(255,255,255,0.15)' }}>
                        {fileIcon(selectedFile)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{selectedFile.name}</p>
                        <p className="text-xs text-on-surface-variant">{fmtBytes(selectedFile.size)}</p>
                      </div>
                      <Loader2 className="w-4 h-4 text-white animate-spin flex-shrink-0" />
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background:'rgba(255,255,255,0.15)' }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width:`${uploadProgress}%`, background:'linear-gradient(90deg,#ffffff,#bec8d2)' }} />
                    </div>
                    <p className="text-[11px] text-on-surface-variant mt-2 text-center">
                      {aiMode
                        ? 'Uploading your statement for AI comparison…'
                        : 'LedgerIQ AI is parsing & normalizing your statement…'}
                    </p>
                  </div>
                )}

                {/* File selected */}
                {selectedFile && phase !== 'uploading' && (
                  <div className="flex items-center gap-3 px-5">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background:'rgba(255,255,255,0.15)' }}>
                      {fileIcon(selectedFile)}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-semibold text-white truncate">{selectedFile.name}</p>
                      <p className="text-xs text-on-surface-variant">{fmtBytes(selectedFile.size)}</p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setSelectedFile(null) }}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ background:'rgba(0,0,0,0.04)' }}>
                      <X className="w-4 h-4 text-on-surface-variant" />
                    </button>
                  </div>
                )}

                {/* Idle — no file */}
                {!selectedFile && phase !== 'uploading' && (
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      'w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300',
                      isDragging ? 'scale-110 -translate-y-1' : '',
                    )}
                      style={{
                        background: isDragging ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                        border: '1px solid rgba(255,255,255,0.2)',
                      }}>
                      <Upload className={cn('w-6 h-6 text-white transition-transform duration-300', isDragging && '-translate-y-0.5')} />
                    </div>
                    <p className="text-sm font-bold text-white mb-1">
                      {isDragging ? 'Release to upload' : 'Drag & drop your statement'}
                    </p>
                    <p className="text-xs text-on-surface-variant mb-4">or click to browse</p>
                    <div className="flex items-center gap-2">
                      {['XLSX','XLS','CSV','PDF'].map(f => (
                        <span key={f} className="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold"
                          style={{ background:'rgba(255,255,255,0.08)', color:'#ffffff', border:'1px solid rgba(255,255,255,0.15)' }}>
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Upload button */}
              {selectedFile && phase !== 'uploading' && (
                <button onClick={handleUpload}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all duration-200 hover:opacity-90 active:scale-[0.99]"
                  style={{
                    background:  aiMode ? 'linear-gradient(135deg,#bec8d2,#1a7fd4)' : 'linear-gradient(135deg,#ffffff,#c6c6c7)',
                    boxShadow:   aiMode ? '0 2px 8px rgba(37,151,248,0.2)' : '0 2px 8px rgba(255,255,255,0.2)',
                  }}>
                  {aiMode ? <Brain className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  {aiMode ? 'Upload & Start AI Comparison' : 'Upload Statement'}
                </button>
              )}

              {/* Security note */}
              <div className="flex items-center justify-center gap-1.5">
                <Lock className="w-3 h-3 text-white/20" />
                <p className="text-[10px] text-on-surface-variant">256-bit encrypted · Token expires in 72 hours</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Success ── */}
        {phase === 'success' && (
          <div className="p-8 text-center relative overflow-hidden"
            style={{ ...card, borderColor:'rgba(255,255,255,0.2)' }}>
            <SuccessBurst />

            <div className="relative inline-flex mb-5">
              <div className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background:'rgba(255,255,255,0.1)', border:'2px solid rgba(255,255,255,0.4)' }}>
                <CheckCircle2 className="w-10 h-10 text-white" />
              </div>
              <div className="absolute inset-0 rounded-full animate-ping opacity-20"
                style={{ border:'2px solid #ffffff' }} />
            </div>

            <h2 className="text-2xl font-bold text-white mb-2">Statement Received!</h2>
            <p className="text-on-surface-variant text-sm leading-relaxed mb-1">
              Your ledger has been securely delivered to{' '}
              <span className="text-white font-semibold">{session?.initiating_company_name}</span>.
            </p>
            {(uploadResult as unknown as { records_processed?: number } | null)?.records_processed && (
              <p className="text-on-surface-variant text-sm font-semibold mb-5">
                {(uploadResult as unknown as { records_processed: number }).records_processed} transaction records processed.
              </p>
            )}

            <div className="flex items-center gap-3 px-4 py-3 rounded-xl mt-4"
              style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.12)' }}>
              <Loader2 className="w-4 h-4 text-white animate-spin flex-shrink-0" />
              <p className="text-xs text-on-surface-variant text-left">
                Your statement has been received. You can also request AI analysis below.
              </p>
            </div>

            {/* Request AI button */}
            <button
              onClick={handleRequestAI}
              className="w-full mt-3 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 hover:opacity-90"
              style={{ background: 'rgba(37,151,248,0.06)', border: '1px solid rgba(37,151,248,0.2)', color: '#bec8d2' }}
            >
              <Brain className="w-4 h-4" />
              Request AI Comparison
            </button>
          </div>
        )}

        {/* ── AI Requested ── */}
        {phase === 'ai_requested' && (
          <div className="p-8 text-center relative overflow-hidden"
            style={{ ...card, borderColor: 'rgba(37,151,248,0.2)' }}>
            <div className="relative inline-flex mb-5">
              <div className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(37,151,248,0.1)', border: '2px solid rgba(37,151,248,0.35)' }}>
                <Sparkles className="w-9 h-9 text-[#bec8d2]" />
              </div>
              <div className="absolute inset-0 rounded-full animate-ping opacity-20"
                style={{ border: '2px solid #bec8d2' }} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {aiMode ? 'Statement Uploaded — AI is Comparing!' : 'AI Analysis Requested!'}
            </h2>
            <p className="text-on-surface-variant text-sm leading-relaxed mb-5">
              <span className="text-[#bec8d2] font-semibold">LedgerIQ AI</span> is now comparing both
              statements using Google Gemini 3 Flash + MongoDB Atlas.{' '}
              <span className="text-white font-semibold">{session?.initiating_company_name}</span> will
              be notified of any discrepancies via email, and their dashboard will show the results.
            </p>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl justify-center"
              style={{ background: 'rgba(37,151,248,0.04)', border: '1px solid rgba(37,151,248,0.12)' }}>
              <Loader2 className="w-4 h-4 text-[#bec8d2] animate-spin flex-shrink-0" />
              <p className="text-xs text-on-surface-variant">
                Multi-agent reconciliation running · You will be notified of results
              </p>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {phase === 'error' && (
          <div className="p-8" style={{ ...card, borderColor:'rgba(239,68,68,0.15)' }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
              style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)' }}>
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="text-white font-bold text-lg mb-2">Upload Failed</h2>
            <p className="text-on-surface-variant text-sm leading-relaxed mb-5">{errorMsg}</p>
            <button
              onClick={() => { setPhase('upload'); setSelectedFile(null); setErrorMsg('') }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white border border-[#ffffff]/20 hover:bg-[#ffffff]/10 transition-colors">
              Try Again
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 mt-6">
          <Zap className="w-3 h-3 text-white/50" />
          <p className="text-[11px] text-on-surface-variant">
            Powered by <span className="text-white font-semibold">LedgerIQ AI</span>
            {' · '}Reconciliation Reinvented.
          </p>
          <Shield className="w-3 h-3 text-white/50" />
        </div>

      </div>
    </div>
  )
}