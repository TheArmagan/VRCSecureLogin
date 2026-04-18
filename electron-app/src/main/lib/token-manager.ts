// ─── Token Manager: creation, validation, refresh, revocation ───

import { randomBytes, createHash } from 'crypto'
import { DataStore } from './data-store'
import { rateLimiter } from './rate-limiter'
import { hasScope } from './scope-resolver'
import { auditLogger } from './audit-logger'
import type {
  TokensStore,
  AppRegistration,
  RateLimitConfig,
  AppSettings
} from './types'

const TOKEN_PREFIX_ACCESS = 'vrcsl_at_'
const TOKEN_PREFIX_REFRESH = 'vrcsl_rt_'

function generateToken(prefix: string): string {
  return prefix + randomBytes(32).toString('hex')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class TokenManager {
  private store: DataStore<TokensStore>
  private defaultTTLSeconds = 3600
  private defaultRefreshTTLDays = 30
  private defaultRateLimit: RateLimitConfig = { rpm: 60, burst: 10 }

  constructor() {
    this.store = new DataStore<TokensStore>('tokens.enc.json', { registrations: [] })
  }

  updateConfig(
    settings: Pick<AppSettings, 'defaultTokenTTLSeconds' | 'defaultRefreshTokenTTLDays' | 'defaultRateLimit'>
  ): void {
    this.defaultTTLSeconds = settings.defaultTokenTTLSeconds
    this.defaultRefreshTTLDays = settings.defaultRefreshTokenTTLDays
    this.defaultRateLimit = settings.defaultRateLimit
  }

  /**
   * Create a new registration with tokens.
   */
  async createRegistration(params: {
    appName: string
    appDescription: string
    appProcessPath: string | null
    appSignatureHash: string | null
    grantedScopes: string[]
    grantedAccountIds: string[]
  }): Promise<{ token: string; refreshToken: string; expiresIn: number; registration: AppRegistration }> {
    const token = generateToken(TOKEN_PREFIX_ACCESS)
    const refreshToken = generateToken(TOKEN_PREFIX_REFRESH)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.defaultTTLSeconds * 1000)
    const refreshExpiresAt = new Date(
      now.getTime() + this.defaultRefreshTTLDays * 24 * 60 * 60 * 1000
    )

    const registration: AppRegistration = {
      id: `reg_${randomBytes(16).toString('hex')}`,
      appName: params.appName,
      appDescription: params.appDescription,
      appProcessPath: params.appProcessPath,
      appSignatureHash: params.appSignatureHash,
      tokenHash: hashToken(token),
      refreshTokenHash: hashToken(refreshToken),
      grantedScopes: params.grantedScopes,
      grantedAccountIds: params.grantedAccountIds,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      lastUsedAt: now.toISOString(),
      rateLimit: this.defaultRateLimit
    }

    await this.store.update((data) => {
      data.registrations.push(registration)
    })

    return {
      token,
      refreshToken,
      expiresIn: this.defaultTTLSeconds,
      registration
    }
  }

  /**
   * Validate an access token. Returns the registration if valid.
   */
  async validateToken(token: string): Promise<AppRegistration | null> {
    if (!token.startsWith(TOKEN_PREFIX_ACCESS)) return null

    const hash = hashToken(token)
    const data = await this.store.read()
    const reg = data.registrations.find((r) => r.tokenHash === hash)

    if (!reg) return null

    // Check expiry
    if (new Date(reg.expiresAt) < new Date()) {
      auditLogger.log('token.expired', { appName: reg.appName })
      return null
    }

    // Update last used time
    reg.lastUsedAt = new Date().toISOString()
    await this.store.write(data)

    return reg
  }

  /**
   * Validate token and check scope + account access.
   */
  async validateRequest(
    token: string,
    requiredScope: string,
    requestedAccountId: string,
    processPath?: string | null
  ): Promise<{
    valid: boolean
    registration: AppRegistration | null
    error?: string
    errorCode?: string
  }> {
    const reg = await this.validateToken(token)

    if (!reg) {
      return { valid: false, registration: null, error: 'Token is invalid or expired', errorCode: 'invalid_token' }
    }

    // Process verification (for native apps)
    if (reg.appProcessPath && processPath && reg.appProcessPath !== processPath) {
      auditLogger.log('security.process_mismatch', {
        appName: reg.appName,
        expectedPath: reg.appProcessPath,
        actualPath: processPath
      })
      return {
        valid: false,
        registration: reg,
        error: 'Process identity mismatch',
        errorCode: 'invalid_token'
      }
    }

    // Check scope
    if (!hasScope(reg.grantedScopes, requiredScope)) {
      return {
        valid: false,
        registration: reg,
        error: `Token does not have scope '${requiredScope}'.`,
        errorCode: 'scope_denied'
      }
    }

    // Check account access
    if (!reg.grantedAccountIds.includes(requestedAccountId)) {
      return {
        valid: false,
        registration: reg,
        error: 'Token does not have access to the requested account',
        errorCode: 'account_denied'
      }
    }

    // Check rate limit
    const { allowed, retryAfterMs } = rateLimiter.check(reg.tokenHash, reg.rateLimit)
    if (!allowed) {
      auditLogger.log('api.rate_limited', {
        appName: reg.appName,
        tokenHash: reg.tokenHash.slice(0, 8)
      })
      return {
        valid: false,
        registration: reg,
        error: `Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
        errorCode: 'rate_limited'
      }
    }

    return { valid: true, registration: reg }
  }

  /**
   * Refresh tokens. Returns new access + refresh tokens.
   */
  async refreshToken(
    refreshTokenValue: string
  ): Promise<{ token: string; refreshToken: string; expiresIn: number } | null> {
    if (!refreshTokenValue.startsWith(TOKEN_PREFIX_REFRESH)) return null

    const hash = hashToken(refreshTokenValue)
    const data = await this.store.read()
    const reg = data.registrations.find((r) => r.refreshTokenHash === hash)

    if (!reg) return null

    // Check refresh token expiry
    if (new Date(reg.refreshExpiresAt) < new Date()) {
      return null
    }

    // Generate new tokens (rotation)
    const newToken = generateToken(TOKEN_PREFIX_ACCESS)
    const newRefreshToken = generateToken(TOKEN_PREFIX_REFRESH)
    const now = new Date()

    reg.tokenHash = hashToken(newToken)
    reg.refreshTokenHash = hashToken(newRefreshToken)
    reg.expiresAt = new Date(now.getTime() + this.defaultTTLSeconds * 1000).toISOString()
    reg.refreshExpiresAt = new Date(
      now.getTime() + this.defaultRefreshTTLDays * 24 * 60 * 60 * 1000
    ).toISOString()
    reg.lastUsedAt = now.toISOString()

    await this.store.write(data)

    auditLogger.log('token.refreshed', {
      appName: reg.appName,
      tokenHash: reg.tokenHash.slice(0, 8)
    })

    return {
      token: newToken,
      refreshToken: newRefreshToken,
      expiresIn: this.defaultTTLSeconds
    }
  }

  /**
   * Revoke a registration (delete token).
   */
  async revokeRegistration(regId: string): Promise<boolean> {
    const data = await this.store.read()
    const idx = data.registrations.findIndex((r) => r.id === regId)
    if (idx === -1) return false

    const reg = data.registrations[idx]
    rateLimiter.remove(reg.tokenHash)
    data.registrations.splice(idx, 1)
    await this.store.write(data)

    auditLogger.log('app.revoked', { appName: reg.appName })
    return true
  }

  /**
   * Update a registration's scopes or accounts.
   */
  async updateRegistration(
    regId: string,
    changes: { grantedScopes?: string[]; grantedAccountIds?: string[]; rateLimit?: RateLimitConfig }
  ): Promise<AppRegistration | null> {
    const data = await this.store.read()
    const reg = data.registrations.find((r) => r.id === regId)
    if (!reg) return null

    const oldScopes = [...reg.grantedScopes]

    if (changes.grantedScopes) reg.grantedScopes = changes.grantedScopes
    if (changes.grantedAccountIds) reg.grantedAccountIds = changes.grantedAccountIds
    if (changes.rateLimit) reg.rateLimit = changes.rateLimit

    await this.store.write(data)

    if (changes.grantedScopes) {
      auditLogger.log('app.scopes_modified', {
        appName: reg.appName,
        oldScopes: oldScopes.join(','),
        newScopes: reg.grantedScopes.join(',')
      })
    }

    return reg
  }

  /**
   * Revoke all registrations for a given account.
   */
  async revokeByAccount(accountId: string): Promise<void> {
    const data = await this.store.read()
    const toRemove = data.registrations.filter((r) =>
      r.grantedAccountIds.includes(accountId)
    )

    for (const reg of toRemove) {
      // Remove account from registration
      reg.grantedAccountIds = reg.grantedAccountIds.filter((id) => id !== accountId)
      // If no accounts left, remove the entire registration
      if (reg.grantedAccountIds.length === 0) {
        rateLimiter.remove(reg.tokenHash)
        const idx = data.registrations.indexOf(reg)
        if (idx !== -1) data.registrations.splice(idx, 1)
        auditLogger.log('app.revoked', { appName: reg.appName, reason: 'account_removed' })
      }
    }

    await this.store.write(data)
  }

  /**
   * Get all registrations.
   */
  async getRegistrations(): Promise<AppRegistration[]> {
    const data = await this.store.read()
    return data.registrations
  }

  /**
   * Find registration by token hash (for WS/SSE lookups).
   */
  async findByTokenHash(tokenHash: string): Promise<AppRegistration | null> {
    const data = await this.store.read()
    return data.registrations.find((r) => r.tokenHash === tokenHash) ?? null
  }
}

export const tokenManager = new TokenManager()
