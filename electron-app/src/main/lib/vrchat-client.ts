// ─── VRChat API Client wrapper ───

const BASE_URL = 'https://api.vrchat.cloud/api/1'
const USER_AGENT = 'VRCSecureLogin/1.0.0'

export interface VRChatSession {
  authCookie: string
  twoFactorAuthCookie: string
  userId: string
  displayName: string
  avatarThumbnailUrl?: string
}

export interface LoginResult {
  success: boolean
  requiresTwoFactor?: boolean
  twoFactorType?: 'totp' | 'emailOtp'
  session?: VRChatSession
  error?: string
}

interface CurrentUserResponse {
  id: string
  displayName: string
  currentAvatarThumbnailImageUrl?: string
  requiresTwoFactorAuth?: string[]
}

export class VRChatClient {
  private pendingAuthCookies = new Map<string, string>()

  private buildHeaders(authCookie?: string, twoFactorCookie?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json'
    }

    const cookies: string[] = []
    if (authCookie) cookies.push(`auth=${authCookie}`)
    if (twoFactorCookie) cookies.push(`twoFactorAuth=${twoFactorCookie}`)
    if (cookies.length > 0) headers['Cookie'] = cookies.join('; ')

    return headers
  }

  /**
   * Login with username/password. May return requiresTwoFactor.
   */
  async login(username: string, password: string): Promise<LoginResult> {
    try {
      const credentials = Buffer.from(
        `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
      ).toString('base64')

      const response = await fetch(`${BASE_URL}/auth/user`, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Authorization: `Basic ${credentials}`
        },
        redirect: 'manual'
      })

      const setCookieHeader = response.headers.getSetCookie?.() ?? []
      const authCookie = this.extractCookie(setCookieHeader, 'auth')

      const data = (await response.json()) as CurrentUserResponse

      // Check if 2FA is required
      if (data.requiresTwoFactorAuth && Array.isArray(data.requiresTwoFactorAuth)) {
        if (authCookie) {
          this.pendingAuthCookies.set(`pending_${username}`, authCookie)
        }

        return {
          success: false,
          requiresTwoFactor: true,
          twoFactorType: data.requiresTwoFactorAuth.includes('totp') ? 'totp' : 'emailOtp'
        }
      }

      // Successful login (no 2FA)
      return {
        success: true,
        session: {
          authCookie: authCookie ?? '',
          twoFactorAuthCookie: '',
          userId: data.id,
          displayName: data.displayName,
          avatarThumbnailUrl: data.currentAvatarThumbnailImageUrl
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed'
      return { success: false, error: message }
    }
  }

  /**
   * Complete 2FA verification.
   */
  async verifyTwoFactor(
    username: string,
    code: string,
    type: 'totp' | 'emailOtp'
  ): Promise<LoginResult> {
    try {
      const authCookie = this.pendingAuthCookies.get(`pending_${username}`)
      if (!authCookie) {
        return { success: false, error: 'No pending 2FA session' }
      }

      const endpoint =
        type === 'totp'
          ? `${BASE_URL}/auth/twofactorauth/totp/verify`
          : `${BASE_URL}/auth/twofactorauth/emailotp/verify`

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(authCookie),
        body: JSON.stringify({ code })
      })

      const setCookieHeader = resp.headers.getSetCookie?.() ?? []
      const verifyData = (await resp.json()) as { verified?: boolean }

      if (!verifyData?.verified) {
        return { success: false, error: 'Invalid 2FA code' }
      }

      const twoFactorCookie = this.extractCookie(setCookieHeader, 'twoFactorAuth')

      // Now fetch current user with both cookies
      const userResp = await fetch(`${BASE_URL}/auth/user`, {
        method: 'GET',
        headers: this.buildHeaders(authCookie, twoFactorCookie ?? undefined)
      })

      const user = (await userResp.json()) as CurrentUserResponse

      this.pendingAuthCookies.delete(`pending_${username}`)

      return {
        success: true,
        session: {
          authCookie,
          twoFactorAuthCookie: twoFactorCookie ?? '',
          userId: user.id,
          displayName: user.displayName,
          avatarThumbnailUrl: user.currentAvatarThumbnailImageUrl
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '2FA verification failed'
      return { success: false, error: message }
    }
  }

  /**
   * Verify that a session is still valid.
   */
  async verifySession(authCookie: string, twoFactorCookie: string): Promise<VRChatSession | null> {
    try {
      const resp = await fetch(`${BASE_URL}/auth/user`, {
        method: 'GET',
        headers: this.buildHeaders(authCookie, twoFactorCookie)
      })

      if (!resp.ok) return null

      const user = (await resp.json()) as CurrentUserResponse

      // If 2FA is required, session is not fully valid
      if (user.requiresTwoFactorAuth) return null

      return {
        authCookie,
        twoFactorAuthCookie: twoFactorCookie,
        userId: user.id,
        displayName: user.displayName,
        avatarThumbnailUrl: user.currentAvatarThumbnailImageUrl
      }
    } catch {
      return null
    }
  }

  /**
   * Proxy a VRChat API request using the session cookies.
   */
  async proxyRequest(
    authCookie: string,
    twoFactorCookie: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: unknown }> {
    const url = `${BASE_URL}${path.startsWith('/') ? path : '/' + path}`

    try {
      const headers = this.buildHeaders(authCookie, twoFactorCookie)

      const fetchOptions: RequestInit = {
        method: method.toUpperCase(),
        headers
      }

      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = JSON.stringify(body)
      }

      const response = await fetch(url, fetchOptions)
      const data = await response.json().catch(() => null)

      return { status: response.status, data }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'VRChat API request failed'
      return { status: 502, data: { error: 'vrchat_error', message } }
    }
  }

  private extractCookie(setCookie: string[], name: string): string | null {
    for (const cookie of setCookie) {
      const match = cookie.match(new RegExp(`${name}=([^;]+)`))
      if (match) return match[1]
    }
    return null
  }
}

export const vrchatClient = new VRChatClient()
