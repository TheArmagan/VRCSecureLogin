import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const vrcsl = {
  // ─── Accounts ───
  getAccounts: () => ipcRenderer.invoke('vrcsl:getAccounts'),
  addAccount: (credentials: { username: string; password: string }) =>
    ipcRenderer.invoke('vrcsl:addAccount', credentials),
  submitTwoFactor: (accountId: string, code: string) =>
    ipcRenderer.invoke('vrcsl:submitTwoFactor', accountId, code),
  removeAccount: (accountId: string) => ipcRenderer.invoke('vrcsl:removeAccount', accountId),
  refreshSession: (accountId: string) => ipcRenderer.invoke('vrcsl:refreshSession', accountId),

  // ─── Connected Apps ───
  getRegistrations: () => ipcRenderer.invoke('vrcsl:getRegistrations'),
  updateRegistration: (regId: string, changes: Record<string, unknown>) =>
    ipcRenderer.invoke('vrcsl:updateRegistration', regId, changes),
  revokeRegistration: (regId: string) => ipcRenderer.invoke('vrcsl:revokeRegistration', regId),

  // ─── Audit Log ───
  getAuditLog: (filter?: Record<string, unknown>) =>
    ipcRenderer.invoke('vrcsl:getAuditLog', filter),

  // ─── Settings ───
  getSettings: () => ipcRenderer.invoke('vrcsl:getSettings'),
  updateSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('vrcsl:updateSettings', settings),

  // ─── Consent ───
  getConsentRequest: () => ipcRenderer.invoke('vrcsl:getConsentRequest'),
  respondToConsent: (response: Record<string, unknown>) =>
    ipcRenderer.invoke('vrcsl:respondToConsent', response),

  // ─── Scope helpers ───
  getScopeDescription: (scope: string) => ipcRenderer.invoke('vrcsl:getScopeDescription', scope),
  getScopeDescriptions: (scopes: string[]) => ipcRenderer.invoke('vrcsl:getScopeDescriptions', scopes),
  validateScopes: (scopes: string[]) => ipcRenderer.invoke('vrcsl:validateScopes', scopes),

  // ─── Events from main ───
  onAccountStatusChanged: (cb: (accountId: string, status: string) => void) => {
    const handler = (_e: unknown, accountId: string, status: string) => cb(accountId, status)
    ipcRenderer.on('vrcsl:accountStatusChanged', handler)
    return () => ipcRenderer.removeListener('vrcsl:accountStatusChanged', handler)
  },
  onConsentRequested: (cb: (request: unknown) => void) => {
    const handler = (_e: unknown, request: unknown) => cb(request)
    ipcRenderer.on('vrcsl:consentRequested', handler)
    return () => ipcRenderer.removeListener('vrcsl:consentRequested', handler)
  },
  onUpdateAvailable: (cb: (version: string) => void) => {
    const handler = (_e: unknown, version: string) => cb(version)
    ipcRenderer.on('vrcsl:updateAvailable', handler)
    return () => ipcRenderer.removeListener('vrcsl:updateAvailable', handler)
  },
  onShowAccountPicker: (cb: (action: string) => void) => {
    const handler = (_e: unknown, action: string) => cb(action)
    ipcRenderer.on('vrcsl:showAccountPicker', handler)
    return () => ipcRenderer.removeListener('vrcsl:showAccountPicker', handler)
  },
  sendAccountPickerResult: (idx: number | null) => {
    ipcRenderer.send('vrcsl:accountPickerResult', idx)
  },

  // ─── Deep Link Confirmation ───
  onDeeplinkConfirmation: (cb: (request: unknown) => void) => {
    const handler = (_e: unknown, request: unknown) => cb(request)
    ipcRenderer.on('vrcsl:deeplinkConfirmation', handler)
    return () => ipcRenderer.removeListener('vrcsl:deeplinkConfirmation', handler)
  },
  sendDeeplinkConfirmationResult: (confirmed: boolean, selectedAccountIdx: number) => {
    ipcRenderer.send('vrcsl:deeplinkConfirmationResult', confirmed, selectedAccountIdx)
  },

  // ─── App Info ───
  getVersion: () => ipcRenderer.invoke('vrcsl:getVersion'),

  // ─── Window Controls ───
  windowMinimize: () => ipcRenderer.invoke('vrcsl:windowMinimize'),
  windowMaximize: () => ipcRenderer.invoke('vrcsl:windowMaximize'),
  windowClose: () => ipcRenderer.invoke('vrcsl:windowClose'),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('vrcsl', vrcsl)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.vrcsl = vrcsl
}
