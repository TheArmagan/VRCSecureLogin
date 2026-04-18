// ─── Account Manager: VRChat account CRUD + session keep-alive ───

import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { DataStore } from './data-store'
import { credentialStore } from './credential-store'
import { vrchatClient } from './vrchat-client'
import { tokenManager } from './token-manager'
import { auditLogger } from './audit-logger'
import type { AccountInfo, AccountsStore, AppSettings } from './types'

export class AccountManager extends EventEmitter {
  private store: DataStore<AccountsStore>
  private sessionCheckInterval: ReturnType<typeof setInterval> | null = null
  private checkIntervalMs = 300000

  constructor() {
    super()
    this.store = new DataStore<AccountsStore>('accounts.enc.json', { accounts: [] })
  }

  updateConfig(settings: Pick<AppSettings, 'sessionCheckIntervalMs'>): void {
    this.checkIntervalMs = settings.sessionCheckIntervalMs
    // Restart keep-alive with new interval
    if (this.sessionCheckInterval) {
      this.stopKeepAlive()
      this.startKeepAlive()
    }
  }

  /**
   * Get all accounts (public info, no credentials).
   */
  async getAccounts(): Promise<AccountInfo[]> {
    const data = await this.store.read()
    return data.accounts
  }

  /**
   * Get a single account by ID.
   */
  async getAccount(accountId: string): Promise<AccountInfo | null> {
    const data = await this.store.read()
    return data.accounts.find((a) => a.id === accountId) ?? null
  }

  /**
   * Find account by VRChat user ID.
   */
  async getAccountByVrchatUserId(vrchatUserId: string): Promise<AccountInfo | null> {
    const data = await this.store.read()
    return data.accounts.find((a) => a.vrchatUserId === vrchatUserId) ?? null
  }

  /**
   * Add a new VRChat account. Returns { success, accountId, requiresTwoFactor, ... }
   */
  async addAccount(
    username: string,
    password: string
  ): Promise<{
    success: boolean
    accountId?: string
    requiresTwoFactor?: boolean
    twoFactorType?: 'totp' | 'emailOtp'
    error?: string
  }> {
    const accountId = `acc_${randomUUID().replace(/-/g, '')}`

    // Store credentials in keychain
    await credentialStore.setCredentials(accountId, username, password)

    // Attempt login
    const result = await vrchatClient.login(username, password)

    if (result.requiresTwoFactor) {
      // Save partial account (pending 2FA)
      const account: AccountInfo = {
        id: accountId,
        vrchatUserId: '',
        displayName: username,
        keychainKey: `vrcsl/account/${accountId}`,
        sessionData: null,
        addedAt: new Date().toISOString(),
        status: 're-auth'
      }

      await this.store.update((data) => {
        data.accounts.push(account)
      })

      return {
        success: false,
        accountId,
        requiresTwoFactor: true,
        twoFactorType: result.twoFactorType
      }
    }

    if (!result.success || !result.session) {
      await credentialStore.deleteCredentials(accountId)
      auditLogger.log('account.auth_failed', { userId: username, reason: result.error ?? 'Unknown' })
      return { success: false, error: result.error }
    }

    // Save account with session
    const now = new Date()
    const account: AccountInfo = {
      id: accountId,
      vrchatUserId: result.session.userId,
      displayName: result.session.displayName,
      keychainKey: `vrcsl/account/${accountId}`,
      sessionData: {
        authCookie: result.session.authCookie,
        twoFactorAuthCookie: result.session.twoFactorAuthCookie,
        lastRefreshed: now.toISOString(),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
      },
      addedAt: now.toISOString(),
      status: 'online',
      avatarThumbnailUrl: result.session.avatarThumbnailUrl
    }

    await this.store.update((data) => {
      data.accounts.push(account)
    })

    auditLogger.log('account.added', {
      userId: result.session.userId,
      displayName: result.session.displayName
    })

    this.emit('account-online', accountId)
    return { success: true, accountId }
  }

  /**
   * Complete 2FA for a pending account.
   */
  async submitTwoFactor(
    accountId: string,
    code: string
  ): Promise<{ success: boolean; error?: string }> {
    const data = await this.store.read()
    const account = data.accounts.find((a) => a.id === accountId)
    if (!account) return { success: false, error: 'Account not found' }

    const creds = await credentialStore.getCredentials(accountId)
    if (!creds) return { success: false, error: 'Credentials not found' }

    const result = await vrchatClient.verifyTwoFactor(
      creds.username,
      code,
      account.status === 're-auth' ? 'totp' : 'totp'
    )

    if (!result.success || !result.session) {
      return { success: false, error: result.error }
    }

    const now = new Date()
    account.vrchatUserId = result.session.userId
    account.displayName = result.session.displayName
    account.avatarThumbnailUrl = result.session.avatarThumbnailUrl
    account.status = 'online'
    account.sessionData = {
      authCookie: result.session.authCookie,
      twoFactorAuthCookie: result.session.twoFactorAuthCookie,
      lastRefreshed: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    }

    await this.store.write(data)

    auditLogger.log('account.added', {
      userId: result.session.userId,
      displayName: result.session.displayName
    })

    this.emit('account-online', accountId)
    return { success: true }
  }

  /**
   * Remove an account. Cascade: revoke tokens, delete credentials, wipe session.
   */
  async removeAccount(accountId: string): Promise<void> {
    const data = await this.store.read()
    const idx = data.accounts.findIndex((a) => a.id === accountId)
    if (idx === -1) return

    const account = data.accounts[idx]

    // Revoke all tokens for this account
    await tokenManager.revokeByAccount(accountId)

    // Delete credentials from keychain
    await credentialStore.deleteCredentials(accountId)

    // Remove from data store
    data.accounts.splice(idx, 1)
    await this.store.write(data)

    auditLogger.log('account.removed', { userId: account.vrchatUserId })
    this.emit('account-offline', accountId)
    this.emit('account-removed', accountId)
  }

  /**
   * Get session data for an account (for API proxying).
   */
  async getSession(
    accountId: string
  ): Promise<{ authCookie: string; twoFactorAuthCookie: string } | null> {
    const account = await this.getAccount(accountId)
    if (!account?.sessionData) return null
    return {
      authCookie: account.sessionData.authCookie,
      twoFactorAuthCookie: account.sessionData.twoFactorAuthCookie
    }
  }

  /**
   * Refresh a specific account's session.
   */
  async refreshSession(accountId: string): Promise<boolean> {
    const data = await this.store.read()
    const account = data.accounts.find((a) => a.id === accountId)
    if (!account?.sessionData) return false

    // First try to verify existing session
    const session = await vrchatClient.verifySession(
      account.sessionData.authCookie,
      account.sessionData.twoFactorAuthCookie
    )

    if (session) {
      const now = new Date()
      account.sessionData.lastRefreshed = now.toISOString()
      account.sessionData.expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
      account.displayName = session.displayName
      account.avatarThumbnailUrl = session.avatarThumbnailUrl
      account.status = 'online'
      await this.store.write(data)

      auditLogger.log('account.session_refreshed', { userId: account.vrchatUserId })
      this.emit('session-refreshed', accountId)
      return true
    }

    // Session invalid — try re-login
    const creds = await credentialStore.getCredentials(accountId)
    if (!creds) {
      account.status = 're-auth'
      await this.store.write(data)
      this.emit('session-expired', accountId)
      return false
    }

    const loginResult = await vrchatClient.login(creds.username, creds.password)

    if (loginResult.requiresTwoFactor) {
      account.status = 're-auth'
      await this.store.write(data)
      this.emit('session-expired', accountId)
      auditLogger.log('account.auth_failed', {
        userId: account.vrchatUserId,
        reason: '2FA required for re-auth'
      })
      return false
    }

    if (!loginResult.success || !loginResult.session) {
      account.status = 're-auth'
      await this.store.write(data)
      this.emit('session-expired', accountId)
      auditLogger.log('account.auth_failed', {
        userId: account.vrchatUserId,
        reason: loginResult.error ?? 'Re-auth failed'
      })
      return false
    }

    const now = new Date()
    account.sessionData = {
      authCookie: loginResult.session.authCookie,
      twoFactorAuthCookie: loginResult.session.twoFactorAuthCookie,
      lastRefreshed: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    }
    account.displayName = loginResult.session.displayName
    account.avatarThumbnailUrl = loginResult.session.avatarThumbnailUrl
    account.status = 'online'
    await this.store.write(data)

    auditLogger.log('account.session_refreshed', { userId: account.vrchatUserId })
    this.emit('session-refreshed', accountId)
    return true
  }

  /**
   * Start the session keep-alive loop.
   */
  startKeepAlive(): void {
    if (this.sessionCheckInterval) return

    this.sessionCheckInterval = setInterval(async () => {
      const accounts = await this.getAccounts()
      for (const account of accounts) {
        if (account.status === 're-auth') continue
        if (!account.sessionData) continue

        // Check if session is expiring soon (within 10 minutes)
        const expiresAt = new Date(account.sessionData.expiresAt)
        const now = new Date()
        if (expiresAt.getTime() - now.getTime() < 600000) {
          await this.refreshSession(account.id)
        }
      }
    }, this.checkIntervalMs)
  }

  /**
   * Stop the session keep-alive loop.
   */
  stopKeepAlive(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval)
      this.sessionCheckInterval = null
    }
  }
}

export const accountManager = new AccountManager()
