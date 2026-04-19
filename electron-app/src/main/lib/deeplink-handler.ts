// ─── DeepLink Handler: vrcsl:// protocol ───

import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { resolve } from 'path'
import { accountManager } from './account-manager'
import { vrchatClient } from './vrchat-client'
import { auditLogger } from './audit-logger'
import type {
  DeepLinkAction,
  DeepLinkConfirmationRequest,
  DeepLinkConfirmationResult,
  DeepLinkConfirmationAccount,
  DeepLinkAvatarInfo,
  DeepLinkWorldInfo,
  DeepLinkUserInfo
} from './types'

// Main window reference — set by main index
let mainWindow: BrowserWindow | null = null

export function setDeepLinkDeps(opts: {
  mainWindow: BrowserWindow | null
}): void {
  mainWindow = opts.mainWindow
}

/**
 * Register vrcsl:// protocol handler.
 */
export function registerProtocol(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('vrcsl', process.execPath, [resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('vrcsl')
  }
}

/**
 * Parse a vrcsl:// URL into an action and params.
 */
export function parseDeepLink(url: string): DeepLinkAction | null {
  try {
    // vrcsl://action?param1=value1&param2=value2
    const match = url.match(/^vrcsl:\/\/([^?]+)(\?.*)?$/)
    if (!match) return null

    const action = match[1].replace(/\/+$/, '')
    const params: Record<string, string> = {}

    if (match[2]) {
      const searchParams = new URLSearchParams(match[2])
      for (const [key, value] of searchParams) {
        params[key] = value
      }
    }

    return { action, params }
  } catch {
    return null
  }
}

/**
 * Handle a deep link URL.
 */
export async function handleDeepLink(url: string): Promise<void> {
  const parsed = parseDeepLink(url)
  if (!parsed) {
    showError('Invalid deep link URL.')
    return
  }

  switch (parsed.action) {
    case 'open':
      return handleOpen()
    case 'switchavatar':
      return handleSwitchAvatar(parsed.params)
    case 'joinworld':
      return handleJoinWorld(parsed.params)
    case 'addfriend':
      return handleAddFriend(parsed.params)
    default:
      showError(`Unknown deep link action: ${parsed.action}`)
  }
}

function handleOpen(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

/**
 * Get online accounts and determine the preselected index from params.
 */
async function getOnlineAccounts(params: Record<string, string>): Promise<{
  accounts: { id: string; displayName: string; avatarThumbnailUrl?: string; authCookie: string; twoFactorAuthCookie: string }[]
  confirmationAccounts: DeepLinkConfirmationAccount[]
  preselectedIdx: number
} | null> {
  const allAccounts = await accountManager.getAccounts()
  const onlineAccounts = allAccounts
    .filter((a) => a.status === 'online' && a.sessionData)
    .map((a) => ({
      id: a.id,
      displayName: a.displayName,
      avatarThumbnailUrl: a.avatarThumbnailUrl,
      authCookie: a.sessionData!.authCookie,
      twoFactorAuthCookie: a.sessionData!.twoFactorAuthCookie
    }))

  if (onlineAccounts.length === 0) {
    showError('No online VRChat accounts available.')
    return null
  }

  const confirmationAccounts: DeepLinkConfirmationAccount[] = onlineAccounts.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    avatarThumbnailUrl: a.avatarThumbnailUrl
  }))

  let preselectedIdx = 0
  if (params.accountIdx !== undefined) {
    const idx = parseInt(params.accountIdx, 10)
    if (!isNaN(idx) && idx >= 0 && idx < onlineAccounts.length) {
      preselectedIdx = idx
    }
  }

  return { accounts: onlineAccounts, confirmationAccounts, preselectedIdx }
}

async function handleSwitchAvatar(params: Record<string, string>): Promise<void> {
  const { avatarId } = params
  if (!avatarId) {
    showError('avatarId is required for switchavatar.')
    return
  }

  if (!/^avtr_[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(avatarId)) {
    showError('Invalid avatarId format.')
    return
  }

  const resolved = await getOnlineAccounts(params)
  if (!resolved) return

  // Fetch avatar info using first available session
  const firstSession = resolved.accounts[0]
  const avatarInfo = await fetchAvatarInfo(firstSession.authCookie, firstSession.twoFactorAuthCookie, avatarId)

  const result = await showConfirmation({
    id: `deeplink_${Date.now()}`,
    action: 'switchavatar',
    title: 'Switch Avatar',
    message: avatarInfo?.name
      ? `Switch to avatar "${avatarInfo.name}"?`
      : `Switch to avatar ${avatarId}?`,
    details: avatarInfo,
    accounts: resolved.confirmationAccounts,
    selectedAccountIdx: resolved.preselectedIdx
  })
  if (!result || !result.confirmed) return

  const account = resolved.accounts[result.selectedAccountIdx]
  if (!account) {
    showError('Selected account is not available.')
    return
  }

  const apiResult = await vrchatClient.proxyRequest(
    account.authCookie,
    account.twoFactorAuthCookie,
    'PUT',
    `/avatars/${avatarId}/select`,
    {}
  )

  if (apiResult.status === 200) {
    auditLogger.log('deeplink.executed', { action: 'switchavatar', avatarId, accountId: account.id })
  } else {
    showError(`Failed to switch avatar: ${JSON.stringify(apiResult.data)}`)
  }
}

async function handleJoinWorld(params: Record<string, string>): Promise<void> {
  const { worldId, instanceId } = params
  if (!worldId) {
    showError('worldId is required for joinworld.')
    return
  }

  if (!/^wrld_[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(worldId)) {
    showError('Invalid worldId format.')
    return
  }

  const resolved = await getOnlineAccounts(params)
  if (!resolved) return

  const locationStr = instanceId ? `${worldId}:${instanceId}` : worldId

  // Fetch world info using first available session
  const firstSession = resolved.accounts[0]
  const worldInfo = await fetchWorldInfo(firstSession.authCookie, firstSession.twoFactorAuthCookie, worldId, instanceId)

  const result = await showConfirmation({
    id: `deeplink_${Date.now()}`,
    action: 'joinworld',
    title: 'Join World',
    message: worldInfo?.name
      ? `Join world "${worldInfo.name}"?`
      : `Join world ${locationStr}?`,
    details: worldInfo,
    accounts: resolved.confirmationAccounts,
    selectedAccountIdx: resolved.preselectedIdx
  })
  if (!result || !result.confirmed) return

  const account = resolved.accounts[result.selectedAccountIdx]
  if (!account) {
    showError('Selected account is not available.')
    return
  }

  const apiResult = await vrchatClient.proxyRequest(
    account.authCookie,
    account.twoFactorAuthCookie,
    'POST',
    `/invite/myself/to/${worldId}${instanceId ? `:${instanceId}` : ''}`,
    {}
  )

  if (apiResult.status === 200) {
    auditLogger.log('deeplink.executed', { action: 'joinworld', worldId, instanceId: instanceId ?? '', accountId: account.id })
  } else {
    showError(`Failed to join world: ${JSON.stringify(apiResult.data)}`)
  }
}

async function handleAddFriend(params: Record<string, string>): Promise<void> {
  const { userId } = params
  if (!userId) {
    showError('userId is required for addfriend.')
    return
  }

  if (!/^usr_[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(userId)) {
    showError('Invalid userId format.')
    return
  }

  const resolved = await getOnlineAccounts(params)
  if (!resolved) return

  // Fetch user info using first available session
  const firstSession = resolved.accounts[0]
  const userInfo = await fetchUserInfo(firstSession.authCookie, firstSession.twoFactorAuthCookie, userId)

  const result = await showConfirmation({
    id: `deeplink_${Date.now()}`,
    action: 'addfriend',
    title: 'Add Friend',
    message: userInfo?.displayName
      ? `Send friend request to "${userInfo.displayName}"?`
      : `Send friend request to ${userId}?`,
    details: userInfo,
    accounts: resolved.confirmationAccounts,
    selectedAccountIdx: resolved.preselectedIdx
  })
  if (!result || !result.confirmed) return

  const account = resolved.accounts[result.selectedAccountIdx]
  if (!account) {
    showError('Selected account is not available.')
    return
  }

  const apiResult = await vrchatClient.proxyRequest(
    account.authCookie,
    account.twoFactorAuthCookie,
    'POST',
    `/user/${userId}/friendRequest`,
    {}
  )

  if (apiResult.status === 200) {
    auditLogger.log('deeplink.executed', { action: 'addfriend', userId, accountId: account.id })
  } else {
    showError(`Failed to send friend request: ${JSON.stringify(apiResult.data)}`)
  }
}

function showError(message: string): void {
  dialog.showErrorBox('VRCSecureLogin - Deep Link Error', message)
}

// ─── In-app confirmation via IPC ───

let pendingConfirmation: {
  resolve: (result: DeepLinkConfirmationResult | null) => void
} | null = null

async function showConfirmation(request: DeepLinkConfirmationRequest): Promise<DeepLinkConfirmationResult | null> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // Fallback to native dialog
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showMessageBox(win as BrowserWindow, {
      type: 'question',
      title: `VRCSecureLogin - ${request.title}`,
      message: request.message,
      buttons: ['Confirm', 'Cancel'],
      defaultId: 0,
      cancelId: 1
    })
    return result.response === 0
      ? { confirmed: true, selectedAccountIdx: request.selectedAccountIdx }
      : null
  }

  // Show main window
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()

  return new Promise((resolve) => {
    pendingConfirmation = { resolve }
    mainWindow!.webContents.send('vrcsl:deeplinkConfirmation', request)
  })
}

export function registerDeepLinkIpc(): void {
  ipcMain.on('vrcsl:deeplinkConfirmationResult', (_e, confirmed: boolean, selectedAccountIdx: number) => {
    if (pendingConfirmation) {
      pendingConfirmation.resolve(confirmed ? { confirmed: true, selectedAccountIdx } : null)
      pendingConfirmation = null
    }
  })
}

// ─── VRChat info fetchers ───

async function fetchAvatarInfo(
  authCookie: string,
  twoFactorCookie: string,
  avatarId: string
): Promise<DeepLinkAvatarInfo | null> {
  try {
    const result = await vrchatClient.proxyRequest(authCookie, twoFactorCookie, 'GET', `/avatars/${avatarId}`)
    if (result.status === 200 && result.data) {
      const d = result.data as Record<string, unknown>
      return {
        type: 'avatar',
        avatarId,
        name: (d.name as string) ?? undefined,
        description: (d.description as string) ?? undefined,
        thumbnailUrl: (d.thumbnailImageUrl as string) ?? (d.imageUrl as string) ?? undefined,
        authorName: (d.authorName as string) ?? undefined
      }
    }
  } catch { /* ignore */ }
  return { type: 'avatar', avatarId }
}

async function fetchWorldInfo(
  authCookie: string,
  twoFactorCookie: string,
  worldId: string,
  instanceId?: string
): Promise<DeepLinkWorldInfo | null> {
  try {
    const result = await vrchatClient.proxyRequest(authCookie, twoFactorCookie, 'GET', `/worlds/${worldId}`)
    if (result.status === 200 && result.data) {
      const d = result.data as Record<string, unknown>
      return {
        type: 'world',
        worldId,
        instanceId,
        name: (d.name as string) ?? undefined,
        description: (d.description as string) ?? undefined,
        thumbnailUrl: (d.thumbnailImageUrl as string) ?? (d.imageUrl as string) ?? undefined,
        authorName: (d.authorName as string) ?? undefined,
        capacity: (d.capacity as number) ?? undefined,
        occupants: (d.occupants as number) ?? undefined
      }
    }
  } catch { /* ignore */ }
  return { type: 'world', worldId, instanceId }
}

async function fetchUserInfo(
  authCookie: string,
  twoFactorCookie: string,
  userId: string
): Promise<DeepLinkUserInfo | null> {
  try {
    const result = await vrchatClient.proxyRequest(authCookie, twoFactorCookie, 'GET', `/users/${userId}`)
    if (result.status === 200 && result.data) {
      const d = result.data as Record<string, unknown>
      return {
        type: 'user',
        userId,
        displayName: (d.displayName as string) ?? undefined,
        bio: (d.bio as string) ?? undefined,
        thumbnailUrl: (d.currentAvatarThumbnailImageUrl as string) ?? (d.profilePicOverrideThumbnail as string) ?? undefined,
        status: (d.status as string) ?? undefined,
        statusDescription: (d.statusDescription as string) ?? undefined
      }
    }
  } catch { /* ignore */ }
  return { type: 'user', userId }
}
