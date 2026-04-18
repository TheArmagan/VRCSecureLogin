// ─── IPC Handlers: Bridge between renderer and main process ───

import { ipcMain, BrowserWindow, app } from 'electron'
import { accountManager } from './account-manager'
import { tokenManager } from './token-manager'
import { auditLogger } from './audit-logger'
import { DataStore } from './data-store'
import { apiServer, setConsentCallback } from './api-server'
import { pipelineManager } from './pipeline-manager'
import { getScopeDescription, validateScopes } from './scope-resolver'
import type {
  AppSettings,
  ConfigStore,
  ConsentRequest,
  ConsentResponse,
  AuditLogFilter,
  RegistrationUpdate,
  RegisterRequest
} from './types'
import { DEFAULT_SETTINGS } from './types'

const configStore = new DataStore<ConfigStore>('config.enc.json', { settings: DEFAULT_SETTINGS })

// Pending consent requests
let pendingConsent: {
  request: ConsentRequest
  resolve: (result: { approved: boolean; grantedScopes: string[]; grantedAccountIds: string[] }) => void
} | null = null

let mainWindowRef: BrowserWindow | null = null

export function setMainWindowRef(win: BrowserWindow): void {
  mainWindowRef = win
}

/**
 * Register all IPC handlers.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  setMainWindowRef(mainWindow)

  // ─── Accounts ───

  ipcMain.handle('vrcsl:getAccounts', async () => {
    const accounts = await accountManager.getAccounts()
    return accounts.map((a) => ({
      id: a.id,
      vrchatUserId: a.vrchatUserId,
      displayName: a.displayName,
      status: a.status,
      avatarThumbnailUrl: a.avatarThumbnailUrl,
      addedAt: a.addedAt,
      sessionExpiry: a.sessionData?.expiresAt ?? null
    }))
  })

  ipcMain.handle('vrcsl:addAccount', async (_e, credentials: { username: string; password: string }) => {
    return accountManager.addAccount(credentials.username, credentials.password)
  })

  ipcMain.handle('vrcsl:submitTwoFactor', async (_e, accountId: string, code: string) => {
    return accountManager.submitTwoFactor(accountId, code)
  })

  ipcMain.handle('vrcsl:removeAccount', async (_e, accountId: string) => {
    await accountManager.removeAccount(accountId)
  })

  ipcMain.handle('vrcsl:refreshSession', async (_e, accountId: string) => {
    return accountManager.refreshSession(accountId)
  })

  // ─── Connected Apps ───

  ipcMain.handle('vrcsl:getRegistrations', async () => {
    const registrations = await tokenManager.getRegistrations()
    const accounts = await accountManager.getAccounts()

    return registrations.map((r) => ({
      ...r,
      grantedAccountNames: r.grantedAccountIds
        .map((id) => accounts.find((a) => a.id === id)?.displayName ?? id)
    }))
  })

  ipcMain.handle('vrcsl:updateRegistration', async (_e, regId: string, changes: RegistrationUpdate) => {
    return tokenManager.updateRegistration(regId, changes)
  })

  ipcMain.handle('vrcsl:revokeRegistration', async (_e, regId: string) => {
    return tokenManager.revokeRegistration(regId)
  })

  // ─── Audit Log ───

  ipcMain.handle('vrcsl:getAuditLog', async (_e, filter?: AuditLogFilter) => {
    return auditLogger.getEntries(filter)
  })

  // ─── Settings ───

  ipcMain.handle('vrcsl:getSettings', async () => {
    const data = await configStore.read()
    return data.settings
  })

  ipcMain.handle('vrcsl:updateSettings', async (_e, settings: Partial<AppSettings>) => {
    await configStore.update((data) => {
      data.settings = { ...data.settings, ...settings }
    })

    // Apply settings to running services
    const data = await configStore.read()
    accountManager.updateConfig(data.settings)
    tokenManager.updateConfig(data.settings)
    auditLogger.updateConfig(data.settings)
    apiServer.updateConfig(data.settings)
  })

  // ─── Consent Dialog ───

  ipcMain.handle('vrcsl:getConsentRequest', async () => {
    return pendingConsent?.request ?? null
  })

  ipcMain.handle('vrcsl:respondToConsent', async (_e, response: ConsentResponse) => {
    if (pendingConsent && pendingConsent.request.requestId === response.requestId) {
      pendingConsent.resolve({
        approved: response.approved,
        grantedScopes: response.grantedScopes,
        grantedAccountIds: response.grantedAccountIds
      })
      pendingConsent = null
    }
  })

  // ─── Scope helpers ───

  ipcMain.handle('vrcsl:getScopeDescription', (_e, scope: string) => {
    return getScopeDescription(scope)
  })

  ipcMain.handle('vrcsl:getScopeDescriptions', (_e, scopes: string[]) => {
    const result: Record<string, string> = {}
    for (const scope of scopes) {
      result[scope] = getScopeDescription(scope)
    }
    return result
  })

  ipcMain.handle('vrcsl:validateScopes', (_e, scopes: string[]) => {
    return validateScopes(scopes)
  })

  // Set up consent callback for API server
  setConsentCallback(async (
    request: RegisterRequest,
    processPath: string | null,
    signatureHash: string | null,
    _remotePort: number
  ) => {
    const accounts = await accountManager.getAccounts()

    const consentRequest: ConsentRequest = {
      requestId: `consent_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      appName: request.appName,
      appDescription: request.appDescription ?? '',
      requestedScopes: request.scopes,
      processPath,
      signatureStatus: signatureHash ? 'Signed' : processPath ? 'Unsigned' : 'Web Client',
      origin: request.origin ?? request.callbackUrl ?? null,
      accounts: accounts
        .filter((a) => a.status === 'online')
        .map((a) => ({ id: a.id, vrchatUserId: a.vrchatUserId, displayName: a.displayName }))
    }

    return new Promise((resolve) => {
      pendingConsent = { request: consentRequest, resolve }

      // Show consent dialog as overlay in the main window
      if (mainWindowRef) {
        mainWindowRef.webContents.send('vrcsl:consentRequested', consentRequest)

        // Bring main window to front so the user sees the consent dialog
        if (mainWindowRef.isMinimized()) mainWindowRef.restore()
        mainWindowRef.setAlwaysOnTop(true)
        mainWindowRef.focus()
        mainWindowRef.setAlwaysOnTop(false)
      }
    })
  })

  // ─── Forward account events to renderer ───

  accountManager.on('account-online', (accountId: string) => {
    mainWindow.webContents.send('vrcsl:accountStatusChanged', accountId, 'online')
  })

  accountManager.on('account-offline', (accountId: string) => {
    mainWindow.webContents.send('vrcsl:accountStatusChanged', accountId, 'offline')
  })

  accountManager.on('session-expired', (accountId: string) => {
    mainWindow.webContents.send('vrcsl:accountStatusChanged', accountId, 're-auth')
  })

  accountManager.on('session-refreshed', (accountId: string) => {
    mainWindow.webContents.send('vrcsl:accountStatusChanged', accountId, 'online')
  })

  // ─── App Info ───

  ipcMain.handle('vrcsl:getVersion', () => app.getVersion())

  // ─── Window Controls ───

  ipcMain.handle('vrcsl:windowMinimize', () => {
    mainWindow.minimize()
  })

  ipcMain.handle('vrcsl:windowMaximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.handle('vrcsl:windowClose', () => {
    mainWindow.close()
  })
}

/**
 * Load settings and apply to all services.
 */
export async function loadAndApplySettings(): Promise<AppSettings> {
  const data = await configStore.read()
  const settings = data.settings

  accountManager.updateConfig(settings)
  tokenManager.updateConfig(settings)
  auditLogger.updateConfig(settings)
  apiServer.updateConfig(settings)

  return settings
}
