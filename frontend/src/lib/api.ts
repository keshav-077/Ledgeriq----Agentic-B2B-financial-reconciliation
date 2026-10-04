import axios from 'axios'
import type {
  BulkImportResult,
  Company,
  CompanySettings,
  DeleteResponse,
  Discrepancy,
  ErpIntegration,
  ErpIntegrationCreated,
  FileRecord,
  GlobalStatementRecord,
  ImportMasterResult,
  ImportStatementOfAccountResult,
  MasterBalance,
  PortalUploadResponse,
  ReconciliationSession,
  Role,
  SendMagicLinkResult,
  StatementEntry,
  TokenValidationResponse,
  User,
} from '@/types'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '',
})

api.interceptors.request.use((config) => {
  const token = readCookie('ledgeriq_token')
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

async function downloadBlob(url: string, filename: string) {
  const { data } = await api.get(url, { responseType: 'blob' })
  const href = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}

export async function getCurrentUser(): Promise<User> {
  const { data } = await api.get('/api/v1/auth/me')
  return data
}

export async function getCompanies(): Promise<Company[]> {
  const { data } = await api.get('/api/v1/companies/')
  return data
}

export async function updateCompany(id: string, payload: Partial<Company>): Promise<Company> {
  const { data } = await api.patch(`/api/v1/companies/${id}`, payload)
  return data
}

export async function deleteCompany(id: string): Promise<void> {
  await api.delete(`/api/v1/companies/${id}`)
}

export async function bulkDeleteCompanies(ids: string[]): Promise<DeleteResponse> {
  const { data } = await api.post('/api/v1/companies/bulk-delete', { ids })
  return data
}

export async function importCounterparties(file: File): Promise<BulkImportResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/api/v1/companies/import', form)
  return data
}

export async function downloadCounterpartiesTemplate() {
  await downloadBlob('/api/v1/companies/template', 'counterparties-template.xlsx')
}

export async function getDiscrepancies(): Promise<Discrepancy[]> {
  const { data } = await api.get('/api/v1/discrepancies/')
  return data
}

export async function approveDiscrepancy(id: string): Promise<Discrepancy> {
  const { data } = await api.post(`/api/v1/discrepancies/${id}/approve`)
  return data
}

export async function getDiscrepancyAnalytics(days = 90) {
  const { data } = await api.get('/api/v1/discrepancies/analytics', { params: { days } })
  return data
}

export async function getMasterBalances(): Promise<MasterBalance[]> {
  const { data } = await api.get('/api/v1/reconciliations/')
  return data
}

export async function importMasterBalances(file: File): Promise<ImportMasterResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/api/v1/reconciliations/import-master', form)
  return data
}

export async function importStatementOfAccount(file: File): Promise<ImportStatementOfAccountResult> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/api/v1/reconciliations/import-statement-of-account', form)
  return data
}

export async function uploadInternalStatement(counterpartyId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post(
    `/api/v1/reconciliations/upload-statement/${counterpartyId}`,
    form,
  )
  return data
}

export async function getStatementEntries(counterpartyId: string): Promise<StatementEntry[]> {
  const { data } = await api.get(`/api/v1/reconciliations/statements/${counterpartyId}`)
  return data
}

export async function getStatementFiles(counterpartyId: string): Promise<FileRecord[]> {
  const { data } = await api.get(`/api/v1/reconciliations/statement-files/${counterpartyId}`)
  return data
}

export async function sendMagicLinkFromReconciliation(counterpartyId: string): Promise<SendMagicLinkResult> {
  const { data } = await api.post(`/api/v1/reconciliations/send-magic-link/${counterpartyId}`)
  return data
}

export async function deleteMasterBalance(id: string): Promise<DeleteResponse> {
  const { data } = await api.delete(`/api/v1/reconciliations/${id}`)
  return data
}

export async function bulkDeleteMasterBalances(ids: string[]): Promise<DeleteResponse> {
  const { data } = await api.post('/api/v1/reconciliations/bulk-delete', { ids })
  return data
}

export async function getGlobalStatements(): Promise<GlobalStatementRecord[]> {
  const { data } = await api.get('/api/v1/reconciliations/global-statements')
  return data
}

export async function deleteGlobalStatement(id: string) {
  const { data } = await api.delete(`/api/v1/reconciliations/global-statements/${id}`)
  return data
}

export async function downloadGlobalStatement(id: string, filename: string) {
  await downloadBlob(`/api/v1/reconciliations/global-statements/${id}/download`, filename)
}

export async function downloadStorageFile(storageId: string, filename: string) {
  await downloadBlob(`/api/v1/reconciliations/files/${storageId}/download`, filename)
}

export async function deleteStorageFile(storageId: string) {
  const { data } = await api.delete(`/api/v1/reconciliations/files/${storageId}`)
  return data
}

export async function downloadMasterBalancesTemplate() {
  await downloadBlob('/api/v1/reconciliations/template/master-balances', 'master-balances-template.xlsx')
}

export async function downloadStatementOfAccountTemplate() {
  await downloadBlob('/api/v1/reconciliations/template/statement-of-account', 'statement-of-account-template.xlsx')
}

export async function downloadInternalStatementTemplate() {
  await downloadBlob('/api/v1/reconciliations/template/internal-statement', 'internal-statement-template.xlsx')
}

export async function triggerReconciliation(companyAId: string | null, companyBId: string) {
  const { data } = await api.post('/api/v1/reconciliation/run', null, {
    params: {
      company_b_id: companyBId,
      ...(companyAId ? { company_a_id: companyAId } : {}),
    },
  })
  return data
}

export async function getAgentRuns(limit = 50) {
  const { data } = await api.get('/api/v1/reconciliation/runs', { params: { limit } })
  return data
}

export async function cancelAgentRun(runId: string) {
  const { data } = await api.post(`/api/v1/reconciliation/cancel/${runId}`)
  return data
}

export async function getCompanySettings(): Promise<CompanySettings> {
  const { data } = await api.get('/api/v1/settings/')
  return data
}

export async function createCompanySettings(payload: unknown): Promise<CompanySettings> {
  const { data } = await api.post('/api/v1/settings/', payload)
  return data
}

export async function updateCompanySettings(payload: unknown): Promise<CompanySettings> {
  const { data } = await api.patch('/api/v1/settings/', payload)
  return data
}

export async function uploadCompanyLogo(file: File) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post('/api/v1/settings/logo', form)
  return data
}

export async function getUsers(): Promise<User[]> {
  const { data } = await api.get('/api/v1/users/')
  return data
}

export async function createUser(payload: unknown): Promise<User> {
  const { data } = await api.post('/api/v1/users/', payload)
  return data
}

export async function updateUser(id: string, payload: unknown): Promise<User> {
  const { data } = await api.patch(`/api/v1/users/${id}`, payload)
  return data
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/api/v1/users/${id}`)
}

export async function getRoles(): Promise<Role[]> {
  const { data } = await api.get('/api/v1/users/roles')
  return data
}

export async function createRole(payload: unknown): Promise<Role> {
  const { data } = await api.post('/api/v1/users/roles', payload)
  return data
}

export async function updateRole(id: string, payload: unknown): Promise<Role> {
  const { data } = await api.patch(`/api/v1/users/roles/${id}`, payload)
  return data
}

export async function deleteRole(id: string): Promise<void> {
  await api.delete(`/api/v1/users/roles/${id}`)
}

export async function getErpIntegrations(): Promise<ErpIntegration[]> {
  const { data } = await api.get('/api/v1/erp/')
  return data
}

export async function createErpIntegration(payload: { name: string; description?: string }): Promise<ErpIntegrationCreated> {
  const { data } = await api.post('/api/v1/erp/', payload)
  return data
}

export async function deleteErpIntegration(id: string): Promise<void> {
  await api.delete(`/api/v1/erp/${id}`)
}

export async function downloadAgentPackage(id: string, filename: string) {
  await downloadBlob(`/api/v1/erp/${id}/download-agent`, filename)
}

export async function startReconciliationSession(initiatingCompanyId: string, counterpartyId: string): Promise<ReconciliationSession> {
  const { data } = await api.post('/api/v1/portal/sessions/start', {
    initiating_company_id: initiatingCompanyId,
    counterparty_id: counterpartyId,
  })
  return data
}

export async function getCounterpartySessions(counterpartyId: string): Promise<ReconciliationSession[]> {
  const { data } = await api.get(`/api/v1/portal/sessions/counterparty/${counterpartyId}`)
  return data
}

export async function downloadSessionFile(sessionId: string, filename: string) {
  await downloadBlob(`/api/v1/portal/sessions/${sessionId}/download`, filename)
}

export async function deleteSessionFile(sessionId: string) {
  const { data } = await api.delete(`/api/v1/portal/sessions/${sessionId}/file`)
  return data
}

export async function getCounterpartyPortalResponses() {
  const { data } = await api.get('/api/v1/portal/sessions/counterparty-responses')
  return data
}

export async function validatePortalToken(token: string): Promise<TokenValidationResponse> {
  const { data } = await api.get(`/api/v1/portal/sessions/validate/${token}`)
  return data
}

export async function uploadPortalFile(token: string, file: File): Promise<PortalUploadResponse> {
  const form = new FormData()
  form.append('token', token)
  form.append('file', file)
  const { data } = await api.post('/api/v1/portal/upload', form)
  return data
}

export async function agreePortalSession(token: string) {
  const { data } = await api.post('/api/v1/portal/sessions/agree', { token })
  return data
}

export async function requestPortalAI(token: string) {
  const { data } = await api.post('/api/v1/portal/sessions/request-ai', { token })
  return data
}

export async function getPortalStatements(token: string) {
  const { data } = await api.get(`/api/v1/portal/statements/${token}`)
  return data
}

export async function globalSearch(q: string) {
  const { data } = await api.get('/api/v1/search/', { params: { q } })
  return data
}

export async function chatWithGemini(payload: {
  message: string
  context?: unknown
  history?: Array<{ role: string; content: string }>
  page?: string
}) {
  const { data } = await api.post('/api/v1/gemini/chat', payload)
  return data
}
