'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plug, Plus, Trash2, Download, X, Copy, CheckCircle2,
  AlertCircle, Loader2, KeyRound, Shield, Terminal,
  RefreshCw, Eye, EyeOff,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import {
  getErpIntegrations,
  createErpIntegration,
  deleteErpIntegration,
  downloadAgentPackage,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import type { ErpIntegration, ErpIntegrationCreated } from '@/types'

// ── Created Key Modal ─────────────────────────────────────────────────────────

function CreatedKeyModal({ integration, onClose }: { integration: ErpIntegrationCreated; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(integration.api_key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-surface-elevated border border-white/20 rounded-2xl w-full max-w-[520px] shadow-2xl">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border-subtle">
          <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/15 flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">API Key Generated</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">Save this key now — it will not be shown again.</p>
          </div>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-2.5 p-3.5 bg-white/5 border border-amber-500/20 rounded-xl">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-white leading-relaxed">
              This API key is shown <strong>exactly once</strong>. Copy and store it securely
              (e.g., in a password manager or secrets vault). You can always regenerate a new key
              via the "Download Agent Package" button, which invalidates the previous key.
            </p>
          </div>

          {/* Key display */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-widest">API Key — {integration.name}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-surface-container border border-border-subtle rounded-xl font-mono text-sm text-white overflow-hidden">
                <span className="truncate">{revealed ? integration.api_key : '•'.repeat(44)}</span>
              </div>
              <button
                onClick={() => setRevealed(r => !r)}
                title={revealed ? 'Hide' : 'Reveal'}
                className="p-2.5 rounded-xl border border-white/10 text-[#94A3B8] hover:text-white hover:bg-white/5 transition-colors flex-shrink-0"
              >
                {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={handleCopy}
                title="Copy to clipboard"
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors flex-shrink-0',
                  copied
                    ? 'bg-white/20 text-white border border-white/20'
                    : 'bg-primary text-on-primary hover:bg-white/90',
                )}
              >
                {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Tracker ID */}
          <div>
            <label className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-widest">Tracker ID</label>
            <p className="mt-1 px-3 py-2 bg-surface-container border border-border-subtle rounded-xl font-mono text-xs text-on-surface-variant">{integration.tracker_id}</p>
          </div>
        </div>

        <div className="px-6 pb-5">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:bg-white/90 transition-colors">
            I&apos;ve saved the key — Continue
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Create Integration Modal ───────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (i: ErpIntegrationCreated) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => createErpIntegration({ name: name.trim(), description: desc.trim() || undefined }),
    onSuccess: (data: ErpIntegrationCreated) => {
      qc.invalidateQueries({ queryKey: ['erp-integrations'] })
      onClose()
      onCreated(data)
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface-elevated border border-border-subtle rounded-2xl w-full max-w-[440px] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-white" />
            <h2 className="text-sm font-semibold text-white">New ERP Integration</h2>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[11px] uppercase tracking-widest text-on-surface-variant mb-1.5">Integration Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. SAP Production Server"
              className="w-full px-3 py-2.5 bg-surface-container border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-white/40 placeholder:text-on-surface-variant transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-widest text-on-surface-variant mb-1.5">Description (optional)</label>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={2}
              placeholder="e.g. Accounting office — Windows Server 2022"
              className="w-full px-3 py-2.5 bg-surface-container border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-white/40 placeholder:text-on-surface-variant transition-colors resize-none"
            />
          </div>
          <div className="p-3 bg-surface-container rounded-xl border border-white/5 text-xs text-[#94A3B8] leading-relaxed">
            <Shield className="w-3.5 h-3.5 text-white inline mr-1.5 -mt-0.5" />
            A unique API key will be generated and hashed with bcrypt before storage.
            The raw key is shown once — copy and save it securely.
          </div>
          {mutation.isError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-error/100/10 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <p className="text-xs text-red-400">Failed to create integration. Please try again.</p>
            </div>
          )}
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-sm text-[#94A3B8] hover:text-white hover:bg-white/5 transition-colors">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || mutation.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating…</> : <><KeyRound className="w-4 h-4" />Generate API Key</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete Confirm ─────────────────────────────────────────────────────────────

function DeleteConfirmModal({ name, onConfirm, onClose, isDeleting }: {
  name: string; onConfirm: () => void; onClose: () => void; isDeleting: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface-elevated border border-border-subtle rounded-2xl w-full max-w-[400px] shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-error/100/10 border border-red-500/20 flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Revoke Integration</h3>
            <p className="text-xs text-on-surface-variant mt-0.5">Delete &quot;{name}&quot; permanently?</p>
          </div>
        </div>
        <p className="text-xs text-on-surface-variant mb-5 leading-relaxed">
          This revokes the API key and removes the integration record. Any local agent using this key will stop syncing immediately.
        </p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border-subtle text-sm text-on-surface-variant hover:text-white hover:bg-surface-container transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={isDeleting} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-error/100 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors">
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Revoke
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ErpIntegrationPage() {
  const [showCreate,   setShowCreate]   = useState(false)
  const [createdData,  setCreatedData]  = useState<ErpIntegrationCreated | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ErpIntegration | null>(null)
  const [downloading,  setDownloading]  = useState<string | null>(null)

  const qc = useQueryClient()

  const { data: integrations = [], isLoading, refetch, isFetching } = useQuery<ErpIntegration[]>({
    queryKey: ['erp-integrations'],
    queryFn: getErpIntegrations,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteErpIntegration(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['erp-integrations'] })
      setDeleteTarget(null)
    },
  })

  async function handleDownload(integration: ErpIntegration) {
    setDownloading(integration.id)
    try {
      await downloadAgentPackage(integration.id, `lumina-agent-package-${integration.tracker_id.slice(0, 8)}.zip`)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <AppShell>
      {/* ── Page header ── */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div>
          <h1 className="font-display text-headline-lg-mobile md:text-headline-lg text-white">ERP Integration</h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Manage local synchronization agents and encrypted API credentials for your ERP pipelines.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-on-surface-variant hover:text-white border border-border-subtle hover:border-white/20 rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3 h-3', isFetching && 'animate-spin')} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:bg-white/90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Integration
          </button>
        </div>
      </div>

      {/* ── How it works ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[
          {
            icon: <KeyRound className="w-5 h-5 text-white" />,
            title: 'Generate Credentials',
            body: 'Create a named integration. A unique API key is generated and stored as a bcrypt hash — the raw key is shown once.',
            color: 'border-white/15 bg-white/5',
          },
          {
            icon: <Terminal className="w-5 h-5 text-[#bec8d2]" />,
            title: 'Download Agent Package',
            body: 'Click "Download Package" to regenerate the key and receive a ZIP containing the agent executable, config.json, and installation guide.',
            color: 'border-[#bec8d2]/20 bg-[#bec8d2]/5',
          },
          {
            icon: <Shield className="w-5 h-5 text-amber-400" />,
            title: 'Deploy on Your Network',
            body: 'Run the agent on your LAN. It reads the bundled config.json for credentials and syncs your ERP data to LedgerIQ automatically.',
            color: 'border-amber-400/20 bg-amber-400/5',
          },
        ].map(({ icon, title, body, color }) => (
          <div key={title} className={cn('rounded-2xl border p-5', color)}>
            <div className="mb-3">{icon}</div>
            <p className="text-sm font-semibold text-white mb-1.5">{title}</p>
            <p className="text-xs text-on-surface-variant leading-relaxed">{body}</p>
          </div>
        ))}
      </div>

      {/* ── Integrations table ── */}
      <div className="bg-surface-elevated rounded-2xl border border-border-subtle overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-surface-container">
          <div className="flex items-center gap-2">
            <Plug className="w-4 h-4 text-[#bec8d2]" />
            <h2 className="text-sm font-semibold text-white">Active Integrations</h2>
            {!isLoading && <span className="text-xs text-on-surface-variant">({integrations.length})</span>}
          </div>
        </div>

        {/* Column headers — desktop only */}
        <div
          className="hidden md:grid text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider px-5 py-3 border-b border-border-subtle bg-surface-container"
          style={{ gridTemplateColumns: '1fr 200px 180px 100px 220px' }}
        >
          <span>Name / Description</span>
          <span>Key Prefix</span>
          <span>Tracker ID</span>
          <span>Created</span>
          <span className="text-right">Actions</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-on-surface-variant gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : integrations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 border border-border-subtle flex items-center justify-center">
              <Plug className="w-7 h-7 text-on-surface-variant" />
            </div>
            <div className="text-center">
              <p className="text-white font-medium mb-1">No integrations yet</p>
              <p className="text-on-surface-variant text-sm">Create your first integration to start syncing your ERP system.</p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-on-primary text-sm font-semibold hover:bg-white/90 transition-colors"
            >
              <Plus className="w-4 h-4" />New Integration
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {integrations.map(integration => {
              const isDl  = downloading === integration.id
              const isDel = deleteTarget?.id === integration.id && deleteMutation.isPending

              return (
                <div key={integration.id} className="hover:bg-surface-container transition-colors">
                  {/* ── Mobile Card (< md) ── */}
                  <div className="block md:hidden px-4 py-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
                        <Plug className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{integration.name}</p>
                        {integration.description && (
                          <p className="text-xs text-on-surface-variant truncate mt-0.5">{integration.description}</p>
                        )}
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2.5">
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-on-surface-variant mb-0.5">Key Prefix</p>
                            <p className="text-xs font-mono text-on-surface-variant truncate">{integration.key_prefix}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wide text-on-surface-variant mb-0.5">Created</p>
                            <p className="text-xs text-on-surface-variant">{new Date(integration.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-[10px] uppercase tracking-wide text-on-surface-variant mb-0.5">Tracker ID</p>
                            <p className="text-xs font-mono text-on-surface-variant truncate">{integration.tracker_id.slice(0, 20)}…</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            onClick={() => handleDownload(integration)}
                            disabled={isDl}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#bec8d2]/10 text-[#bec8d2] border border-[#bec8d2]/20 hover:bg-[#bec8d2]/20 transition-colors disabled:opacity-40"
                          >
                            {isDl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                            {isDl ? 'Building…' : 'Download'}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(integration)}
                            className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors ml-auto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Desktop Row (≥ md) ── */}
                  <div
                    className="hidden md:grid items-center px-5 py-4"
                    style={{ gridTemplateColumns: '1fr 200px 180px 100px 220px' }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center flex-shrink-0">
                          <Plug className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{integration.name}</p>
                          {integration.description && (
                            <p className="text-xs text-on-surface-variant truncate">{integration.description}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="font-mono text-xs text-[#94A3B8] bg-surface-container border border-border-subtle rounded-lg px-2.5 py-1.5 truncate">
                      {integration.key_prefix}
                    </div>

                    <div className="font-mono text-xs text-on-surface-variant truncate">
                      {integration.tracker_id.slice(0, 16)}…
                    </div>

                    <div className="text-xs text-on-surface-variant">
                      {new Date(integration.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleDownload(integration)}
                        disabled={isDl}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#bec8d2]/10 text-[#bec8d2] border border-[#bec8d2]/20 hover:bg-[#bec8d2]/20 transition-colors disabled:opacity-40"
                        title="Download agent package (regenerates key)"
                      >
                        {isDl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        {isDl ? 'Building…' : 'Download Package'}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(integration)}
                        className="p-1.5 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
                        title="Revoke integration"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Security note */}
      <div className="flex items-start gap-3 mt-4 p-4 bg-surface-container border border-border-subtle rounded-xl">
        <Shield className="w-4 h-4 text-on-surface-variant flex-shrink-0 mt-0.5" />
        <p className="text-xs text-on-surface-variant leading-relaxed">
          <strong className="text-on-surface">Security:</strong> API keys are hashed with bcrypt (cost factor 12) before storage.
          Raw keys are never persisted in the database. Clicking "Download Package" regenerates the key,
          invalidating any previously issued credentials for that integration.
        </p>
      </div>

      {/* ── Modals ── */}
      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={data => setCreatedData(data)}
        />
      )}
      {createdData && (
        <CreatedKeyModal
          integration={createdData}
          onClose={() => setCreatedData(null)}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          name={deleteTarget.name}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </AppShell>
  )
}
