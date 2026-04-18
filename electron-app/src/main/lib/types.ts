// ─── Shared Types for VRCSecureLogin ───

// ─── Account Types ───

export interface AccountInfo {
  id: string
  vrchatUserId: string
  displayName: string
  keychainKey: string
  sessionData: SessionData | null
  addedAt: string
  status: 'online' | 'offline' | 're-auth'
  avatarThumbnailUrl?: string
}

export interface SessionData {
  authCookie: string
  twoFactorAuthCookie: string
  lastRefreshed: string
  expiresAt: string
}

export interface AccountsStore {
  accounts: AccountInfo[]
}

// ─── Token / Registration Types ───

export interface AppRegistration {
  id: string
  appName: string
  appDescription: string
  appProcessPath: string | null
  appSignatureHash: string | null
  tokenHash: string
  refreshTokenHash: string
  grantedScopes: string[]
  grantedAccountIds: string[]
  createdAt: string
  expiresAt: string
  refreshExpiresAt: string
  lastUsedAt: string
  rateLimit: RateLimitConfig
}

export interface TokensStore {
  registrations: AppRegistration[]
}

export interface RateLimitConfig {
  rpm: number
  burst: number
}

// ─── Settings Types ───

export interface AppSettings {
  apiPort: number
  sessionCheckIntervalMs: number
  defaultTokenTTLSeconds: number
  defaultRefreshTokenTTLDays: number
  defaultRateLimit: RateLimitConfig
  minimizeToTray: boolean
  auditLogMaxSizeMB: number
  auditLogMaxFiles: number
  autoUpdate: boolean
}

export interface ConfigStore {
  settings: AppSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiPort: 7642,
  sessionCheckIntervalMs: 300000,
  defaultTokenTTLSeconds: 3600,
  defaultRefreshTokenTTLDays: 30,
  defaultRateLimit: { rpm: 60, burst: 10 },
  minimizeToTray: true,
  auditLogMaxSizeMB: 50,
  auditLogMaxFiles: 5,
  autoUpdate: true
}

// ─── Consent Types ───

export interface ConsentRequest {
  requestId: string
  appName: string
  appDescription: string
  requestedScopes: string[]
  processPath: string | null
  signatureStatus: string | null
  origin: string | null
  accounts: { id: string; vrchatUserId: string; displayName: string }[]
}

export interface ConsentResponse {
  requestId: string
  approved: boolean
  grantedScopes: string[]
  grantedAccountIds: string[]
}

// ─── API Types ───

export interface RegisterRequest {
  appName: string
  appDescription?: string
  scopes: string[]
  callbackUrl?: string
  origin?: string
}

export interface RegisterResponse {
  token: string
  refreshToken: string
  expiresIn: number
  grantedScopes: string[]
  grantedAccounts: { userId: string; displayName: string }[]
}

export interface RefreshRequest {
  refreshToken: string
}

export interface RefreshResponse {
  token: string
  refreshToken: string
  expiresIn: number
}

export interface ApiProxyRequest {
  userId: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
}

export interface ApiProxyResponse {
  status: number
  data: unknown
}

export interface ApiBatchRequest {
  requests: (ApiProxyRequest & { requestId: string })[]
}

export interface ApiBatchResponse {
  responses: (ApiProxyResponse & { requestId: string })[]
}

export interface ApiError {
  error: string
  message: string
}

// ─── WebSocket Message Types ───

export interface WsMessage {
  requestId?: string
  type: string
  userId?: string
  body: unknown
}

export interface WsAuthMessage {
  requestId: string
  type: 'auth'
  body: { token: string }
}

export interface WsApiRequestMessage {
  requestId: string
  type: 'api_request'
  userId: string
  body: { method: string; path: string; body?: unknown }
}

export interface WsSubscribeMessage {
  requestId: string
  type: 'subscribe'
  body: { accountIds: string[]; events?: string[] }
}

export interface WsUnsubscribeMessage {
  requestId: string
  type: 'unsubscribe'
  body: Record<string, never>
}

export interface WsRegisterMessage {
  requestId: string
  type: 'register'
  body: RegisterRequest
}

// ─── Pipeline / Event Types ───

export interface PipelineEvent {
  userId: string
  eventType: string
  source: 'vrchat' | 'vrcsl'
  timestamp: string
  data: unknown
}

// ─── Audit Log Types ───

export type AuditEventType =
  | 'app.registered'
  | 'app.denied'
  | 'app.revoked'
  | 'app.scopes_modified'
  | 'api.request'
  | 'api.rate_limited'
  | 'api.scope_denied'
  | 'api.account_denied'
  | 'pipeline.subscribed'
  | 'pipeline.unsubscribed'
  | 'pipeline.sse_connected'
  | 'pipeline.sse_disconnected'
  | 'account.added'
  | 'account.removed'
  | 'account.session_refreshed'
  | 'account.auth_failed'
  | 'token.refreshed'
  | 'token.expired'
  | 'deeplink.executed'
  | 'security.process_mismatch'

export interface AuditLogEntry {
  timestamp: string
  type: AuditEventType
  details: Record<string, unknown>
}

export interface AuditLogFilter {
  types?: AuditEventType[]
  appName?: string
  accountId?: string
  fromDate?: string
  toDate?: string
  limit?: number
  offset?: number
}

// ─── Add Account Types ───

export interface AddAccountResult {
  success: boolean
  accountId?: string
  requiresTwoFactor?: boolean
  twoFactorType?: 'totp' | 'emailOtp'
  error?: string
}

export interface TwoFactorResult {
  success: boolean
  error?: string
}

export interface RegistrationUpdate {
  grantedScopes?: string[]
  grantedAccountIds?: string[]
  rateLimit?: RateLimitConfig
}

// ─── Process Verification ───

export interface ProcessInfo {
  pid: number
  path: string
  signatureHash: string | null
  signatureValid: boolean
  signerName: string | null
}

// ─── DeepLink ───

export interface DeepLinkAction {
  action: string
  params: Record<string, string>
}

export interface DeepLinkConfirmationAccount {
  id: string
  displayName: string
  avatarThumbnailUrl?: string
}

export interface DeepLinkConfirmationRequest {
  id: string
  action: 'switchavatar' | 'joinworld' | 'addfriend'
  title: string
  message: string
  details: DeepLinkAvatarInfo | DeepLinkWorldInfo | DeepLinkUserInfo | null
  accounts: DeepLinkConfirmationAccount[]
  selectedAccountIdx: number
}

export interface DeepLinkConfirmationResult {
  confirmed: boolean
  selectedAccountIdx: number
}

export interface DeepLinkAvatarInfo {
  type: 'avatar'
  avatarId: string
  name?: string
  description?: string
  thumbnailUrl?: string
  authorName?: string
}

export interface DeepLinkWorldInfo {
  type: 'world'
  worldId: string
  instanceId?: string
  name?: string
  description?: string
  thumbnailUrl?: string
  authorName?: string
  capacity?: number
  occupants?: number
}

export interface DeepLinkUserInfo {
  type: 'user'
  userId: string
  displayName?: string
  bio?: string
  thumbnailUrl?: string
  status?: string
  statusDescription?: string
}
