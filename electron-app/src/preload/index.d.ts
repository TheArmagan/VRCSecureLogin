import { ElectronAPI } from '@electron-toolkit/preload'

interface VRCSLBridge {
  // Accounts
  getAccounts(): Promise<Array<{
    id: string
    vrchatUserId: string
    displayName: string
    status: string
    avatarThumbnailUrl: string | null
    addedAt: string
    sessionExpiry: string | null
  }>>
  addAccount(credentials: { username: string; password: string }): Promise<{
    success: boolean
    accountId?: string
    requiresTwoFactor?: boolean
    error?: string
  }>
  submitTwoFactor(accountId: string, code: string): Promise<{
    success: boolean
    error?: string
  }>
  removeAccount(accountId: string): Promise<void>
  refreshSession(accountId: string): Promise<boolean>

  // Connected Apps
  getRegistrations(): Promise<Array<{
    id: string
    appName: string
    grantedScopes: string[]
    grantedAccountIds: string[]
    grantedAccountNames: string[]
    createdAt: string
    lastUsedAt: string | null
    processPath: string | null
    signatureHash: string | null
  }>>
  updateRegistration(regId: string, changes: Record<string, unknown>): Promise<void>
  revokeRegistration(regId: string): Promise<void>

  // Audit Log
  getAuditLog(filter?: Record<string, unknown>): Promise<Array<{
    timestamp: string
    type: string
    details: Record<string, string>
  }>>

  // Settings
  getSettings(): Promise<{
    apiPort: number
    sessionCheckIntervalMs: number
    defaultTokenTTLSeconds: number
    defaultRefreshTokenTTLDays: number
    defaultRateLimit: { rpm: number; burst: number }
    minimizeToTray: boolean
    auditLogMaxSizeMB: number
    auditLogMaxFiles: number
    autoUpdate: boolean
  }>
  updateSettings(settings: Record<string, unknown>): Promise<void>

  // Consent
  getConsentRequest(): Promise<{
    requestId: string
    appName: string
    appDescription: string
    requestedScopes: string[]
    processPath: string | null
    signatureStatus: string
    origin: string | null
    accounts: Array<{ id: string; vrchatUserId: string; displayName: string }>
  } | null>
  respondToConsent(response: {
    requestId: string
    approved: boolean
    grantedScopes: string[]
    grantedAccountIds: string[]
  }): Promise<void>

  // Scope helpers
  getScopeDescription(scope: string): Promise<string>
  getScopeDescriptions(scopes: string[]): Promise<Record<string, string>>
  validateScopes(scopes: string[]): Promise<string[]>

  // Events
  onAccountStatusChanged(cb: (accountId: string, status: string) => void): () => void
  onConsentRequested(cb: (request: unknown) => void): () => void
  onUpdateAvailable(cb: (version: string) => void): () => void
  onShowAccountPicker(cb: (action: string) => void): () => void
  sendAccountPickerResult(idx: number | null): void

  // Deep Link Confirmation
  onDeeplinkConfirmation(cb: (request: unknown) => void): () => void
  sendDeeplinkConfirmationResult(confirmed: boolean, selectedAccountIdx: number): void

  // App Info
  getVersion(): Promise<string>

  // Window Controls
  windowMinimize(): Promise<void>
  windowMaximize(): Promise<void>
  windowClose(): Promise<void>
}

declare global {
  interface Window {
    electron: ElectronAPI
    vrcsl: VRCSLBridge
  }
}
