'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Users, Shield, Save, Plus, Trash2, Pencil,
  X, Check, Eye, EyeOff, ChevronDown, AlertCircle,
} from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { useAuth } from '@/lib/auth-context'
import {
  getCompanySettings, updateCompanySettings,
  getUsers, createUser, updateUser, deleteUser,
  getRoles, createRole, updateRole, deleteRole,
} from '@/lib/api'
import type { CompanySettings, User, Role } from '@/types'

const EU_COUNTRIES = ['DE','FR','IT','ES','NL','BE','AT','PT','SE','DK','FI','IE','GR','CZ','HU','PL','RO','BG','HR','SK','SI','EE','LV','LT','LU','MT','CY']
function getIdentifierType(cc: string) {
  if (cc === 'US') return 'EIN'
  if (cc === 'GB' || EU_COUNTRIES.includes(cc)) return 'VAT'
  if (cc === 'CA') return 'BN'
  if (cc === 'AU') return 'ABN'
  if (cc === 'JP') return 'Corporate Number'
  if (cc === 'CN') return 'USCC'
  if (cc === 'IN') return 'GSTIN'
  return 'Tax ID'
}

const COUNTRIES = [
  {code:'US',name:'United States'},{code:'GB',name:'United Kingdom'},{code:'TR',name:'Turkey'},
  {code:'DE',name:'Germany'},{code:'FR',name:'France'},{code:'IT',name:'Italy'},
  {code:'ES',name:'Spain'},{code:'NL',name:'Netherlands'},{code:'CA',name:'Canada'},
  {code:'AU',name:'Australia'},{code:'JP',name:'Japan'},{code:'CN',name:'China'},
  {code:'IN',name:'India'},{code:'BR',name:'Brazil'},{code:'SG',name:'Singapore'},
]
const CURRENCIES = ['USD','EUR','TRY','GBP','JPY','CAD','AUD','CHF','CNY','SEK','NOK','DKK','INR','BRL','MXN','SGD','HKD','PLN','CZK','HUF']
const INDUSTRIES = ['Manufacturing','Retail','SaaS','Logistics','Other']
const COMPANY_SIZES = ['1–10','11–50','51–200','200+']

const PERMISSION_LABELS: Record<string, string> = {
  'dashboard.view': 'View Dashboard',
  'counterparties.view': 'View Counterparties',
  'counterparties.manage': 'Manage Counterparties',
  'reconciliations.view': 'View Reconciliations',
  'reconciliations.run': 'Run Reconciliation',
  'discrepancies.view': 'View Discrepancies',
  'discrepancies.approve': 'Approve Discrepancies',
  'erp_integration.view': 'View ERP Integration',
  'erp_integration.manage': 'Manage ERP Integration',
  'settings.view': 'View Company Settings',
  'settings.edit': 'Edit Company Settings',
  'users.view': 'View Users',
  'users.manage': 'Manage Users & Roles',
}
const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS)

type Tab = 'profile' | 'users' | 'roles'

export default function SettingsPage() {
  const { user, hasPermission } = useAuth()
  const [tab, setTab] = useState<Tab>('profile')

  const canEditSettings = hasPermission('settings.edit')
  const canViewUsers = hasPermission('users.view')
  const canManageUsers = hasPermission('users.manage')

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="font-display text-headline-lg-mobile md:text-headline-lg text-white">Company Settings</h1>
          <p className="font-body-md text-on-surface-variant mt-1">Manage your organisation profile, users, and access roles.</p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 bg-white/10 p-1 rounded-xl overflow-x-auto scrollbar-none">
          {[
            { key: 'profile' as Tab, label: 'Company Profile', icon: Building2 },
            ...(canViewUsers ? [{ key: 'users' as Tab, label: 'User Management', icon: Users }] : []),
            ...(canViewUsers ? [{ key: 'roles' as Tab, label: 'Roles & Permissions', icon: Shield }] : []),
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={[
                'flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap flex-shrink-0',
                tab === key
                  ? 'bg-surface-elevated text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-white',
              ].join(' ')}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {tab === 'profile' && <CompanyProfileTab canEdit={canEditSettings} />}
        {tab === 'users' && canViewUsers && <UsersTab canManage={canManageUsers} currentUser={user} />}
        {tab === 'roles' && canViewUsers && <RolesTab canManage={canManageUsers} />}
      </div>
    </AppShell>
  )
}

// ── Company Profile Tab ───────────────────────────────────────────────────────

function CompanyProfileTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['company-settings'],
    queryFn: getCompanySettings,
  })

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Partial<CompanySettings>>({})
  const [saveError, setSaveError] = useState('')

  const mutation = useMutation({
    mutationFn: updateCompanySettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company-settings'] })
      setEditing(false)
      setSaveError('')
    },
    onError: (e: unknown) => {
      setSaveError(e instanceof Error ? e.message : 'Failed to save')
    },
  })

  if (isLoading) return <LoadingCard />
  if (!settings) return <ErrorCard message="Company settings not found." />

  function startEdit() {
    setForm({
      identity: { ...settings!.identity },
      profile: { ...settings!.profile },
      financial: { ...settings!.financial },
      contact: { ...settings!.contact },
    })
    setEditing(true)
    setSaveError('')
  }

  function handleCountryChange(cc: string) {
    setForm(f => ({
      ...f,
      identity: { ...f.identity!, legal_country: cc, identifier_type: getIdentifierType(cc) },
    }))
  }

  function save() {
    mutation.mutate(form)
  }

  const s = editing ? form : settings

  return (
    <div className="space-y-6">
      {/* Company Identity */}
      <Card title="Company Identity" action={
        canEdit && !editing ? (
          <button onClick={startEdit} className={BTN_GHOST}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        ) : null
      }>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoField label="Company Name" editing={editing}>
            {editing ? (
              <input className={INPUT} value={s?.identity?.company_name || ''} onChange={e => setForm(f => ({ ...f, identity: { ...f.identity!, company_name: e.target.value } }))} />
            ) : settings.identity.company_name}
          </InfoField>
          <InfoField label="Legal Country" editing={editing}>
            {editing ? (
              <select className={INPUT} value={s?.identity?.legal_country || ''} onChange={e => handleCountryChange(e.target.value)}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            ) : COUNTRIES.find(c => c.code === settings.identity.legal_country)?.name || settings.identity.legal_country}
          </InfoField>
          <InfoField label={s?.identity?.identifier_type || 'Tax Identifier'} editing={editing}>
            {editing ? (
              <input className={INPUT} value={s?.identity?.identifier_value || ''} onChange={e => setForm(f => ({ ...f, identity: { ...f.identity!, identifier_value: e.target.value } }))} />
            ) : settings.identity.identifier_value}
          </InfoField>
        </div>
      </Card>

      {/* Company Profile */}
      <Card title="Company Profile">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoField label="Industry" editing={editing}>
            {editing ? (
              <select className={INPUT} value={s?.profile?.industry || ''} onChange={e => setForm(f => ({ ...f, profile: { ...f.profile!, industry: e.target.value } }))}>
                <option value="">Select…</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            ) : settings.profile?.industry || <span className="text-on-surface-variant">—</span>}
          </InfoField>
          <InfoField label="Company Size" editing={editing}>
            {editing ? (
              <select className={INPUT} value={s?.profile?.company_size || ''} onChange={e => setForm(f => ({ ...f, profile: { ...f.profile!, company_size: e.target.value } }))}>
                <option value="">Select…</option>
                {COMPANY_SIZES.map(sz => <option key={sz} value={sz}>{sz}</option>)}
              </select>
            ) : settings.profile?.company_size || <span className="text-on-surface-variant">—</span>}
          </InfoField>
        </div>
      </Card>

      {/* Financial Settings */}
      <Card title="Financial Settings">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoField label="Base Currency" editing={editing}>
            {editing ? (
              <select className={INPUT} value={s?.financial?.base_currency || ''} onChange={e => setForm(f => ({ ...f, financial: { ...f.financial!, base_currency: e.target.value } }))}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : settings.financial.base_currency}
          </InfoField>
          <InfoField label="Fiscal Year Start" editing={editing}>
            {editing ? (
              <input className={INPUT} placeholder="MM-DD" value={s?.financial?.fiscal_year_start || ''} onChange={e => setForm(f => ({ ...f, financial: { ...f.financial!, fiscal_year_start: e.target.value } }))} />
            ) : settings.financial.fiscal_year_start}
          </InfoField>
        </div>
      </Card>

      {/* Contact */}
      <Card title="Contact Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoField label="Contact Name" editing={editing}>
            {editing ? (
              <input className={INPUT} value={s?.contact?.contact_name || ''} onChange={e => setForm(f => ({ ...f, contact: { ...f.contact!, contact_name: e.target.value } }))} />
            ) : settings.contact.contact_name}
          </InfoField>
          <InfoField label="Contact Email" editing={editing}>
            {editing ? (
              <input type="email" className={INPUT} value={s?.contact?.contact_email || ''} onChange={e => setForm(f => ({ ...f, contact: { ...f.contact!, contact_email: e.target.value } }))} />
            ) : settings.contact.contact_email}
          </InfoField>
          <InfoField label="Phone" editing={editing}>
            {editing ? (
              <input className={INPUT} value={s?.contact?.contact_phone || ''} onChange={e => setForm(f => ({ ...f, contact: { ...f.contact!, contact_phone: e.target.value } }))} />
            ) : settings.contact.contact_phone || <span className="text-on-surface-variant">—</span>}
          </InfoField>
        </div>
      </Card>

      {editing && (
        <div className="flex items-center gap-3">
          {saveError && (
            <p className="text-sm text-error flex items-center gap-1">
              <AlertCircle className="w-4 h-4" /> {saveError}
            </p>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={() => setEditing(false)} className={BTN_GHOST}>
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button onClick={save} disabled={mutation.isPending} className={BTN_PRIMARY}>
              {mutation.isPending
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
                : <><Save className="w-3.5 h-3.5" /> Save Changes</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab({ canManage, currentUser }: { canManage: boolean; currentUser: User | null }) {
  const qc = useQueryClient()
  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: getUsers })
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: getRoles })

  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'Staff', full_name: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [formError, setFormError] = useState('')

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowCreate(false); setForm({ username: '', email: '', password: '', role: 'Staff', full_name: '' }) },
    onError: (e: unknown) => setFormError(e instanceof Error ? e.message : 'Error'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => updateUser(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setEditUser(null) },
    onError: (e: unknown) => setFormError(e instanceof Error ? e.message : 'Error'),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const roleOptions = ['System Administrator', 'Manager', 'IT Specialist', 'Staff', ...roles.filter(r => !r.is_system_role).map(r => r.name)]

  if (isLoading) return <LoadingCard />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-on-surface-variant">{users.length} user{users.length !== 1 ? 's' : ''}</p>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className={BTN_PRIMARY}>
            <Plus className="w-4 h-4" /> Add User
          </button>
        )}
      </div>

      <div className="bg-surface-elevated rounded-xl border border-border-subtle divide-y divide-border-subtle">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5">
            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-white">
                {(u.full_name || u.username).charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{u.full_name || u.username}</p>
              <p className="text-xs text-on-surface-variant truncate">{u.email}</p>
              <div className="flex items-center gap-1.5 mt-1 sm:hidden">
                <RoleBadge role={u.role} />
                {!u.is_active && (
                  <span className="text-xs bg-white/10 text-on-surface-variant px-2 py-0.5 rounded-full">Inactive</span>
                )}
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <RoleBadge role={u.role} />
              {!u.is_active && (
                <span className="text-xs bg-white/10 text-on-surface-variant px-2 py-0.5 rounded-full">Inactive</span>
              )}
            </div>
            {canManage && u.id !== currentUser?.id && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => { setEditUser(u); setFormError('') }}
                  className="p-1.5 text-on-surface-variant hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => confirm(`Delete user "${u.username}"?`) && deleteMutation.mutate(u.id)}
                  className="p-1.5 text-on-surface-variant hover:text-error rounded-lg hover:bg-error/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <Modal title="Add New User" onClose={() => setShowCreate(false)}>
          <div className="space-y-4">
            <Field2 label="Username" required>
              <input className={INPUT} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="jsmith" />
            </Field2>
            <Field2 label="Full Name">
              <input className={INPUT} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Jane Smith" />
            </Field2>
            <Field2 label="Email" required>
              <input type="email" className={INPUT} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@company.com" />
            </Field2>
            <Field2 label="Password" required>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} className={`${INPUT} pr-10`} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" />
                <button type="button" onClick={() => setShowPwd(p => !p)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field2>
            <Field2 label="Role" required>
              <select className={INPUT} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field2>
            {formError && <p className="text-sm text-error">{formError}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setShowCreate(false)} className={`${BTN_GHOST} flex-1`}>Cancel</button>
              <button
                onClick={() => createMutation.mutate(form)}
                disabled={createMutation.isPending}
                className={`${BTN_PRIMARY} flex-1`}
              >
                {createMutation.isPending ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editUser && (
        <Modal title={`Edit: ${editUser.username}`} onClose={() => setEditUser(null)}>
          <div className="space-y-4">
            <Field2 label="Role">
              <select className={INPUT} defaultValue={editUser.role}
                onChange={e => setEditUser(u => u ? { ...u, role: e.target.value } : null)}>
                {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field2>
            <Field2 label="Active">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" defaultChecked={editUser.is_active}
                  onChange={e => setEditUser(u => u ? { ...u, is_active: e.target.checked } : null)}
                  className="w-4 h-4 accent-white" />
                <span className="text-sm text-on-surface">Account is active</span>
              </label>
            </Field2>
            {formError && <p className="text-sm text-error">{formError}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditUser(null)} className={`${BTN_GHOST} flex-1`}>Cancel</button>
              <button
                onClick={() => updateMutation.mutate({
                  id: editUser.id,
                  data: { role: editUser.role, is_active: editUser.is_active },
                })}
                disabled={updateMutation.isPending}
                className={`${BTN_PRIMARY} flex-1`}
              >
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

function RolesTab({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const { data: roles = [], isLoading } = useQuery({ queryKey: ['roles'], queryFn: getRoles })
  const [showCreate, setShowCreate] = useState(false)
  const [editRole, setEditRole] = useState<Role | null>(null)
  const [roleName, setRoleName] = useState('')
  const [roleDesc, setRoleDesc] = useState('')
  const [perms, setPerms] = useState<Record<string, boolean>>({})
  const [formError, setFormError] = useState('')

  const createMutation = useMutation({
    mutationFn: createRole,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setShowCreate(false) },
    onError: (e: unknown) => setFormError(e instanceof Error ? e.message : 'Error'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: unknown }) => updateRole(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setEditRole(null) },
    onError: (e: unknown) => setFormError(e instanceof Error ? e.message : 'Error'),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteRole,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })

  function openCreate() {
    setRoleName(''); setRoleDesc('')
    setPerms(Object.fromEntries(PERMISSION_KEYS.map(k => [k, false])))
    setFormError(''); setShowCreate(true)
  }

  function openEdit(role: Role) {
    setRoleName(role.name); setRoleDesc(role.description || '')
    setPerms({ ...Object.fromEntries(PERMISSION_KEYS.map(k => [k, false])), ...role.permissions })
    setFormError(''); setEditRole(role)
  }

  if (isLoading) return <LoadingCard />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-on-surface-variant">{roles.length} role{roles.length !== 1 ? 's' : ''}</p>
        {canManage && (
          <button onClick={openCreate} className={BTN_PRIMARY}>
            <Plus className="w-4 h-4" /> Create Role
          </button>
        )}
      </div>

      <div className="space-y-3">
        {roles.map(role => (
          <div key={role.id} className="bg-surface-elevated rounded-xl border border-border-subtle p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">{role.name}</h3>
                  {role.is_system_role && (
                    <span className="text-[10px] bg-white/10 text-on-surface-variant px-1.5 py-0.5 rounded font-medium">SYSTEM</span>
                  )}
                </div>
                {role.description && <p className="text-xs text-on-surface-variant mt-0.5">{role.description}</p>}
              </div>
              {canManage && !role.is_system_role && (
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(role)} className="p-1.5 text-on-surface-variant hover:text-white rounded hover:bg-white/10">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => confirm(`Delete role "${role.name}"?`) && deleteMutation.mutate(role.id)}
                    className="p-1.5 text-on-surface-variant hover:text-error rounded hover:bg-error/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {PERMISSION_KEYS.map(key => {
                const granted = role.permissions?.[key] ?? false
                return (
                  <div key={key} className={[
                    'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md',
                    granted ? 'bg-white/5 text-white' : 'bg-surface-container text-on-surface-variant',
                  ].join(' ')}>
                    {granted ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {PERMISSION_LABELS[key]}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Create Role Modal */}
      {(showCreate || editRole) && (
        <Modal
          title={editRole ? `Edit Role: ${editRole.name}` : 'Create Custom Role'}
          onClose={() => { setShowCreate(false); setEditRole(null) }}
        >
          <div className="space-y-4">
            <Field2 label="Role Name" required>
              <input className={INPUT} value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="e.g. Finance Viewer" />
            </Field2>
            <Field2 label="Description">
              <input className={INPUT} value={roleDesc} onChange={e => setRoleDesc(e.target.value)} placeholder="Optional description" />
            </Field2>
            <div>
              <p className="text-sm font-medium text-on-surface mb-2">Permissions</p>
              <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto">
                {PERMISSION_KEYS.map(key => (
                  <label key={key} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-container cursor-pointer">
                    <input
                      type="checkbox"
                      checked={perms[key] ?? false}
                      onChange={e => setPerms(p => ({ ...p, [key]: e.target.checked }))}
                      className="w-4 h-4 accent-white"
                    />
                    <span className="text-sm text-on-surface">{PERMISSION_LABELS[key]}</span>
                  </label>
                ))}
              </div>
            </div>
            {formError && <p className="text-sm text-error">{formError}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={() => { setShowCreate(false); setEditRole(null) }} className={`${BTN_GHOST} flex-1`}>Cancel</button>
              <button
                onClick={() => {
                  const payload = { name: roleName, description: roleDesc || undefined, permissions: perms }
                  if (editRole) updateMutation.mutate({ id: editRole.id, data: payload })
                  else createMutation.mutate(payload)
                }}
                disabled={createMutation.isPending || updateMutation.isPending}
                className={`${BTN_PRIMARY} flex-1`}
              >
                {(createMutation.isPending || updateMutation.isPending) ? 'Saving…' : editRole ? 'Update Role' : 'Create Role'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Shared UI Primitives ──────────────────────────────────────────────────────

const INPUT = 'input-underline'
const BTN_PRIMARY = 'flex items-center gap-1.5 px-6 py-2.5 bg-primary hover:bg-surface-tint text-on-primary text-sm font-medium rounded-full transition-colors disabled:opacity-50'
const BTN_GHOST = 'flex items-center gap-1.5 px-3 py-2 text-on-surface-variant hover:text-white hover:bg-white/10 text-sm rounded-lg transition-colors'

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-subtle p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-on-surface uppercase tracking-wide">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function InfoField({ label, editing, children }: { label: string; editing: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-on-surface-variant uppercase tracking-wide block mb-1">{label}</label>
      {editing
        ? children
        : <p className="text-sm text-white">{children}</p>
      }
    </div>
  )
}

function Field2({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-on-surface mb-1.5">
        {label}{required && <span className="text-error ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-elevated rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    'System Administrator': 'bg-purple-100 text-purple-700',
    'Manager': 'bg-blue-100 text-blue-700',
    'IT Specialist': 'bg-amber-100 text-white',
    'Staff': 'bg-white/10 text-on-surface-variant',
  }
  return (
    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${colors[role] || 'bg-white/10 text-on-surface-variant'}`}>
      {role}
    </span>
  )
}

function LoadingCard() {
  return (
    <div className="bg-surface-elevated rounded-xl border border-border-subtle p-8 text-center">
      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
      <p className="text-sm text-on-surface-variant mt-3">Loading…</p>
    </div>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-error/20 p-6 flex items-center gap-3 text-error">
      <AlertCircle className="w-5 h-5 flex-shrink-0" />
      <p className="text-sm">{message}</p>
    </div>
  )
}
