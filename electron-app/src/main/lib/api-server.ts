// ─── Local API Server: HTTP + WebSocket on 127.0.0.1:7642 ───

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { createHash } from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { tokenManager } from './token-manager'
import { accountManager } from './account-manager'
import { vrchatClient } from './vrchat-client'
import { resolveApiScope, hasScope, getEventScope, filterPermittedEvents } from './scope-resolver'
import { rateLimiter } from './rate-limiter'
import { auditLogger } from './audit-logger'
import { sseHandler } from './sse-handler'
import { pipelineManager } from './pipeline-manager'
import { verifyConnectingProcess } from './process-verifier'
import type {
  RegisterRequest,
  ApiProxyRequest,
  ApiBatchRequest,
  AppRegistration,
  PipelineEvent,
  WsMessage,
  AppSettings
} from './types'

const MAX_BODY_SIZE = 1024 * 1024 // 1 MB

// Consent flow callback — set by ipc-handlers
let consentCallback:
  | ((request: RegisterRequest, processPath: string | null, signatureHash: string | null, remotePort: number) => Promise<{
    approved: boolean
    grantedScopes: string[]
    grantedAccountIds: string[]
  }>)
  | null = null

export function setConsentCallback(
  cb: typeof consentCallback
): void {
  consentCallback = cb
}

const WS_PING_INTERVAL = 30_000
const WS_PONG_TIMEOUT = 10_000

interface WsClient {
  ws: WebSocket
  registration: AppRegistration | null
  tokenHash: string | null
  subscribedAccountIds: string[]
  subscribedEvents: string[]
  pingInterval: ReturnType<typeof setInterval> | null
  pongTimeout: ReturnType<typeof setTimeout> | null
  authTimeout: ReturnType<typeof setTimeout> | null
}

export class ApiServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private wss: WebSocketServer | null = null
  private wsClients = new Set<WsClient>()
  private port = 7642

  updateConfig(settings: Pick<AppSettings, 'apiPort'>): void {
    this.port = settings.apiPort
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer((req, res) => this.handleHttp(req, res))

      // WebSocket server on the same HTTP server
      this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' })
      this.wss.on('connection', (ws, req) => this.handleWsConnection(ws, req))

      // Listen on pipeline events for WS broadcast
      pipelineManager.on('event', (event: PipelineEvent, accountId: string) => {
        this.broadcastWsEvent(event, accountId)
      })

      this.httpServer.listen(this.port, '127.0.0.1', () => {
        console.log(`[API] Server listening on 127.0.0.1:${this.port}`)
        resolve()
      })

      this.httpServer.on('error', (err) => {
        console.error('[API] Server error:', err)
        reject(err)
      })
    })
  }

  stop(): void {
    // Close all WS clients and clean up their timers
    for (const client of this.wsClients) {
      this.cleanupWsClient(client)
      client.ws.close()
    }
    this.wsClients.clear()

    sseHandler.closeAll()

    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    if (this.httpServer) {
      this.httpServer.close()
      this.httpServer = null
    }
  }

  // ─── HTTP Request Handler ───

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Verify loopback
    const remoteAddr = req.socket.remoteAddress
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'forbidden', message: 'Only localhost connections allowed.' }))
      return
    }

    // CORS headers for browser clients
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const path = url.pathname

    try {
      switch (path) {
        case '/register':
          if (req.method === 'POST') return await this.handleRegister(req, res)
          break
        case '/refresh':
          if (req.method === 'POST') return await this.handleRefresh(req, res)
          break
        case '/accounts':
          if (req.method === 'GET') return await this.handleGetAccounts(req, res)
          break
        case '/api':
          if (req.method === 'POST') return await this.handleApiProxy(req, res)
          break
        case '/api/batch':
          if (req.method === 'POST') return await this.handleApiBatch(req, res)
          break
        case '/events':
          if (req.method === 'GET') return await sseHandler.handleRequest(req, res)
          break
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found', message: 'Endpoint not found.' }))
    } catch (err) {
      console.error('[API] Unhandled error:', err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'internal_error', message: 'Internal server error.' }))
    }
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_SIZE) {
          reject(new Error('Request body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new Error('Invalid JSON'))
        }
      })

      req.on('error', reject)
    })
  }

  private extractToken(req: IncomingMessage): string | null {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) return null
    return auth.slice(7)
  }

  private jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  // ─── POST /register ───

  private async handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await this.readBody(req)) as RegisterRequest

    if (!body.appName || !body.scopes || !Array.isArray(body.scopes) || body.scopes.length === 0) {
      return this.jsonResponse(res, 400, {
        error: 'invalid_request',
        message: 'appName and scopes are required.'
      })
    }

    // Process verification
    const remotePort = req.socket.remotePort ?? 0
    const processInfo = verifyConnectingProcess(remotePort)

    if (!consentCallback) {
      return this.jsonResponse(res, 500, {
        error: 'internal_error',
        message: 'Consent system not initialized.'
      })
    }

    // Show consent dialog and wait for user response
    const consentResult = await consentCallback(
      body,
      processInfo?.path ?? null,
      processInfo?.signatureHash ?? null,
      remotePort
    )

    if (!consentResult.approved) {
      auditLogger.log('app.denied', {
        appName: body.appName,
        processPath: processInfo?.path ?? 'unknown',
        requestedScopes: body.scopes.join(',')
      })
      return this.jsonResponse(res, 403, {
        error: 'consent_denied',
        message: 'User denied the registration request.'
      })
    }

    // Create registration
    const { token, refreshToken, expiresIn, registration } = await tokenManager.createRegistration({
      appName: body.appName,
      appDescription: body.appDescription ?? '',
      appProcessPath: processInfo?.path ?? null,
      appSignatureHash: processInfo?.signatureHash ?? null,
      grantedScopes: consentResult.grantedScopes,
      grantedAccountIds: consentResult.grantedAccountIds
    })

    // Build response accounts
    const accounts = await accountManager.getAccounts()
    const grantedAccounts = accounts
      .filter((a) => registration.grantedAccountIds.includes(a.id))
      .map((a) => ({ userId: a.vrchatUserId, displayName: a.displayName }))

    auditLogger.log('app.registered', {
      appName: body.appName,
      processPath: processInfo?.path ?? 'unknown',
      grantedScopes: consentResult.grantedScopes.join(','),
      grantedAccounts: consentResult.grantedAccountIds.join(',')
    })

    this.jsonResponse(res, 200, {
      token,
      refreshToken,
      expiresIn,
      grantedScopes: consentResult.grantedScopes,
      grantedAccounts
    })
  }

  // ─── POST /refresh ───

  private async handleRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await this.readBody(req)) as { refreshToken?: string }

    if (!body.refreshToken) {
      return this.jsonResponse(res, 400, {
        error: 'invalid_request',
        message: 'refreshToken is required.'
      })
    }

    const result = await tokenManager.refreshToken(body.refreshToken)
    if (!result) {
      return this.jsonResponse(res, 401, {
        error: 'invalid_token',
        message: 'Refresh token is invalid or expired.'
      })
    }

    this.jsonResponse(res, 200, result)
  }

  // ─── GET /accounts ───

  private async handleGetAccounts(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = this.extractToken(req)
    if (!token) {
      return this.jsonResponse(res, 401, {
        error: 'invalid_token',
        message: 'Missing or invalid Authorization header.'
      })
    }

    const registration = await tokenManager.validateToken(token)
    if (!registration) {
      return this.jsonResponse(res, 401, {
        error: 'invalid_token',
        message: 'Token is invalid or expired.'
      })
    }

    const allAccounts = await accountManager.getAccounts()
    const accounts = allAccounts
      .filter((a) => registration.grantedAccountIds.includes(a.id))
      .map((a) => ({
        userId: a.vrchatUserId,
        displayName: a.displayName,
        status: a.status,
        avatarThumbnailUrl: a.avatarThumbnailUrl
      }))

    this.jsonResponse(res, 200, { accounts })
  }

  // ─── POST /api ───

  private async handleApiProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = this.extractToken(req)
    if (!token) {
      return this.jsonResponse(res, 401, {
        error: 'invalid_token',
        message: 'Missing or invalid Authorization header.'
      })
    }

    const body = (await this.readBody(req)) as ApiProxyRequest

    if (!body.userId || !body.method || !body.path) {
      return this.jsonResponse(res, 400, {
        error: 'invalid_request',
        message: 'userId, method, and path are required.'
      })
    }

    // Resolve required scope
    const requiredScope = resolveApiScope(body.method, body.path)
    if (!requiredScope) {
      return this.jsonResponse(res, 400, {
        error: 'invalid_request',
        message: `Cannot resolve scope for ${body.method} ${body.path}.`
      })
    }

    // Find the account by VRChat user ID
    const account = await accountManager.getAccountByVrchatUserId(body.userId)
    if (!account) {
      return this.jsonResponse(res, 400, {
        error: 'invalid_request',
        message: 'Account not found for the given userId.'
      })
    }

    // Validate token + scope + account + rate limit
    const validation = await tokenManager.validateRequest(token, requiredScope, account.id)
    if (!validation.valid) {
      const statusMap: Record<string, number> = {
        invalid_token: 401,
        scope_denied: 403,
        account_denied: 403,
        rate_limited: 429
      }
      const status = statusMap[validation.errorCode ?? ''] ?? 403

      if (validation.errorCode === 'scope_denied') {
        auditLogger.log('api.scope_denied', {
          appName: validation.registration?.appName ?? 'unknown',
          attemptedScope: requiredScope,
          endpoint: `${body.method} ${body.path}`
        })
      } else if (validation.errorCode === 'account_denied') {
        auditLogger.log('api.account_denied', {
          appName: validation.registration?.appName ?? 'unknown',
          attemptedUserId: body.userId
        })
      }

      return this.jsonResponse(res, status, {
        error: validation.errorCode,
        message: validation.error
      })
    }

    // Get session and proxy request
    const session = await accountManager.getSession(account.id)
    if (!session) {
      return this.jsonResponse(res, 502, {
        error: 'vrchat_error',
        message: 'Account session is not active.'
      })
    }

    const startTime = Date.now()
    const result = await vrchatClient.proxyRequest(
      session.authCookie,
      session.twoFactorAuthCookie,
      body.method,
      body.path,
      body.body
    )
    const duration = Date.now() - startTime

    auditLogger.log('api.request', {
      appName: validation.registration!.appName,
      method: body.method,
      path: body.path,
      userId: body.userId,
      status: result.status,
      duration: `${duration}ms`
    })

    this.jsonResponse(res, 200, { status: result.status, data: result.data })
  }

  // ─── POST /api/batch ───

  private async handleApiBatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const token = this.extractToken(req)
    if (!token) {
      return this.jsonResponse(res, 401, {
        error: 'invalid_token',
        message: 'Missing or invalid Authorization header.'
      })
    }

    const body = (await this.readBody(req)) as ApiBatchRequest
    if (!body.requests || !Array.isArray(body.requests)) {
      return this.jsonResponse(res, 400, {
        error: 'invalid_request',
        message: 'requests array is required.'
      })
    }

    const registration = await tokenManager.validateToken(token)
    if (!registration) {
      return this.jsonResponse(res, 401, {
        error: 'invalid_token',
        message: 'Token is invalid or expired.'
      })
    }

    const responses = await Promise.all(
      body.requests.map(async (r) => {
        const requiredScope = resolveApiScope(r.method, r.path)
        if (!requiredScope) {
          return { requestId: r.requestId, status: 400, data: { error: 'invalid_request', message: `Cannot resolve scope for ${r.method} ${r.path}` } }
        }

        const account = await accountManager.getAccountByVrchatUserId(r.userId)
        if (!account) {
          return { requestId: r.requestId, status: 400, data: { error: 'invalid_request', message: 'Account not found' } }
        }

        if (!hasScope(registration.grantedScopes, requiredScope)) {
          return { requestId: r.requestId, status: 403, data: { error: 'scope_denied', message: `Token does not have scope '${requiredScope}'` } }
        }

        if (!registration.grantedAccountIds.includes(account.id)) {
          return { requestId: r.requestId, status: 403, data: { error: 'account_denied', message: 'Token does not have access to this account' } }
        }

        // Rate limit per request
        const { allowed } = rateLimiter.check(registration.tokenHash, registration.rateLimit)
        if (!allowed) {
          return { requestId: r.requestId, status: 429, data: { error: 'rate_limited', message: 'Rate limit exceeded' } }
        }

        const session = await accountManager.getSession(account.id)
        if (!session) {
          return { requestId: r.requestId, status: 502, data: { error: 'vrchat_error', message: 'Account session not active' } }
        }

        const result = await vrchatClient.proxyRequest(
          session.authCookie,
          session.twoFactorAuthCookie,
          r.method,
          r.path,
          r.body
        )

        return { requestId: r.requestId, status: result.status, data: result.data }
      })
    )

    this.jsonResponse(res, 200, { responses })
  }

  // ─── WebSocket Handler ───

  private handleWsConnection(ws: WebSocket, req: IncomingMessage): void {
    // Verify loopback
    const remoteAddr = req.socket.remoteAddress
    if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
      ws.close(4003, 'Only localhost connections allowed')
      return
    }

    const client: WsClient = {
      ws,
      registration: null,
      tokenHash: null,
      subscribedAccountIds: [],
      subscribedEvents: [],
      pingInterval: null,
      pongTimeout: null,
      authTimeout: null
    }

    this.wsClients.add(client)

    // Must auth within 5 minutes (consent dialog may take time)
    client.authTimeout = setTimeout(() => {
      if (!client.registration) {
        ws.close(4001, 'Authentication timeout')
      }
    }, 5 * 60 * 1000)

    // Server-side keepalive ping
    this.setupWsPing(client)

    ws.on('message', async (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsMessage
        await this.handleWsMessage(client, msg, req)
      } catch {
        ws.send(JSON.stringify({ type: 'error', body: { error: 'invalid_request', message: 'Invalid message format' } }))
      }
    })

    ws.on('close', () => {
      this.cleanupWsClient(client)
    })

    ws.on('error', () => {
      this.cleanupWsClient(client)
    })
  }

  private setupWsPing(client: WsClient): void {
    client.pingInterval = setInterval(() => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.ping()
        client.pongTimeout = setTimeout(() => {
          // No pong received — terminate dead connection
          client.ws.terminate()
        }, WS_PONG_TIMEOUT)
      }
    }, WS_PING_INTERVAL)

    client.ws.on('pong', () => {
      if (client.pongTimeout) {
        clearTimeout(client.pongTimeout)
        client.pongTimeout = null
      }
    })
  }

  private cleanupWsClient(client: WsClient): void {
    if (client.authTimeout) {
      clearTimeout(client.authTimeout)
      client.authTimeout = null
    }
    if (client.pingInterval) {
      clearInterval(client.pingInterval)
      client.pingInterval = null
    }
    if (client.pongTimeout) {
      clearTimeout(client.pongTimeout)
      client.pongTimeout = null
    }
    this.wsClients.delete(client)
  }

  private async handleWsMessage(client: WsClient, msg: WsMessage, req: IncomingMessage): Promise<void> {
    switch (msg.type) {
      case 'auth':
        return this.handleWsAuth(client, msg)
      case 'register':
        return this.handleWsRegister(client, msg, req)
      case 'refresh':
        return this.handleWsRefresh(client, msg)
      case 'accounts':
        return this.handleWsAccounts(client, msg)
      case 'api_request':
        return this.handleWsApiRequest(client, msg)
      case 'subscribe':
        return this.handleWsSubscribe(client, msg)
      case 'unsubscribe':
        return this.handleWsUnsubscribe(client, msg)
      case 'ping':
        client.ws.send(JSON.stringify({ requestId: msg.requestId, type: 'pong', body: {} }))
        return
      default:
        client.ws.send(JSON.stringify({
          requestId: msg.requestId,
          type: 'error',
          body: { error: 'invalid_request', message: `Unknown message type: ${msg.type}` }
        }))
    }
  }

  private async handleWsAuth(client: WsClient, msg: WsMessage): Promise<void> {
    const body = msg.body as { token?: string }
    if (!body?.token) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'auth_response',
        body: { success: false, error: 'Token is required' }
      }))
      return
    }

    const registration = await tokenManager.validateToken(body.token)
    if (!registration) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'auth_response',
        body: { success: false, error: 'Invalid or expired token' }
      }))
      return
    }

    client.registration = registration
    client.tokenHash = createHash('sha256').update(body.token).digest('hex')

    // Clear auth timeout on successful authentication
    if (client.authTimeout) {
      clearTimeout(client.authTimeout)
      client.authTimeout = null
    }

    const accounts = await accountManager.getAccounts()
    const grantedAccounts = accounts
      .filter((a) => registration.grantedAccountIds.includes(a.id))
      .map((a) => ({ userId: a.vrchatUserId, displayName: a.displayName }))

    client.ws.send(JSON.stringify({
      requestId: msg.requestId,
      type: 'auth_response',
      body: { success: true, accounts: grantedAccounts }
    }))
  }

  private async handleWsRefresh(client: WsClient, msg: WsMessage): Promise<void> {
    const body = msg.body as { refreshToken?: string }
    if (!body?.refreshToken) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'invalid_request', message: 'refreshToken is required' }
      }))
      return
    }

    const result = await tokenManager.refreshToken(body.refreshToken)
    if (!result) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'invalid_token', message: 'Refresh token is invalid or expired' }
      }))
      return
    }

    // Update client registration with new token
    const registration = await tokenManager.validateToken(result.token)
    if (registration) {
      client.registration = registration
      client.tokenHash = createHash('sha256').update(result.token).digest('hex')
    }

    client.ws.send(JSON.stringify({
      requestId: msg.requestId,
      type: 'refresh_response',
      body: result
    }))
  }

  private async handleWsAccounts(client: WsClient, msg: WsMessage): Promise<void> {
    if (!client.registration) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'invalid_token', message: 'Not authenticated' }
      }))
      return
    }

    const allAccounts = await accountManager.getAccounts()
    const accounts = allAccounts
      .filter((a) => client.registration!.grantedAccountIds.includes(a.id))
      .map((a) => ({
        userId: a.vrchatUserId,
        displayName: a.displayName,
        status: a.status,
        avatarThumbnailUrl: a.avatarThumbnailUrl
      }))

    client.ws.send(JSON.stringify({
      requestId: msg.requestId,
      type: 'accounts_response',
      body: { accounts }
    }))
  }

  private async handleWsRegister(client: WsClient, msg: WsMessage, req: IncomingMessage): Promise<void> {
    const body = msg.body as RegisterRequest

    if (!body?.appName || !body?.scopes || !Array.isArray(body.scopes)) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'register_response',
        body: { success: false, error: 'appName and scopes are required' }
      }))
      return
    }

    if (!consentCallback) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'register_response',
        body: { success: false, error: 'Consent system not initialized' }
      }))
      return
    }

    const remotePort = req.socket.remotePort ?? 0
    const consentResult = await consentCallback(body, null, null, remotePort)

    if (!consentResult.approved) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'register_response',
        body: { success: false, error: 'User denied the registration request' }
      }))
      return
    }

    const { token, refreshToken, expiresIn, registration } = await tokenManager.createRegistration({
      appName: body.appName,
      appDescription: body.appDescription ?? '',
      appProcessPath: null,
      appSignatureHash: null,
      grantedScopes: consentResult.grantedScopes,
      grantedAccountIds: consentResult.grantedAccountIds
    })

    const accounts = await accountManager.getAccounts()
    const grantedAccounts = accounts
      .filter((a) => registration.grantedAccountIds.includes(a.id))
      .map((a) => ({ userId: a.vrchatUserId, displayName: a.displayName }))

    // Auto-authenticate this WS client
    client.registration = registration
    client.tokenHash = createHash('sha256').update(token).digest('hex')

    // Clear auth timeout on successful registration
    if (client.authTimeout) {
      clearTimeout(client.authTimeout)
      client.authTimeout = null
    }

    client.ws.send(JSON.stringify({
      requestId: msg.requestId,
      type: 'register_response',
      body: {
        success: true,
        token,
        refreshToken,
        expiresIn,
        grantedScopes: consentResult.grantedScopes,
        grantedAccounts
      }
    }))
  }

  private async handleWsApiRequest(client: WsClient, msg: WsMessage): Promise<void> {
    if (!client.registration) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'invalid_token', message: 'Not authenticated' }
      }))
      return
    }

    const body = msg.body as { method?: string; path?: string; body?: unknown }
    const userId = msg.userId

    if (!userId || !body?.method || !body?.path) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'invalid_request', message: 'userId, method, and path are required' }
      }))
      return
    }

    const requiredScope = resolveApiScope(body.method, body.path)
    if (!requiredScope) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'invalid_request', message: `Cannot resolve scope for ${body.method} ${body.path}` }
      }))
      return
    }

    // Find account
    const account = await accountManager.getAccountByVrchatUserId(userId)
    if (!account || !client.registration.grantedAccountIds.includes(account.id)) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'account_denied', message: 'Token does not have access to this account' }
      }))
      return
    }

    // Check scope
    if (!hasScope(client.registration.grantedScopes, requiredScope)) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'scope_denied', message: `Token does not have scope '${requiredScope}'` }
      }))
      return
    }

    // Rate limit
    if (client.tokenHash) {
      const { allowed } = rateLimiter.check(client.tokenHash, client.registration.rateLimit)
      if (!allowed) {
        client.ws.send(JSON.stringify({
          requestId: msg.requestId,
          type: 'error',
          body: { error: 'rate_limited', message: 'Rate limit exceeded' }
        }))
        return
      }
    }

    // Proxy the request
    const session = await accountManager.getSession(account.id)
    if (!session) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'vrchat_error', message: 'Account session not active' }
      }))
      return
    }

    const result = await vrchatClient.proxyRequest(
      session.authCookie,
      session.twoFactorAuthCookie,
      body.method,
      body.path,
      body.body
    )

    client.ws.send(JSON.stringify({
      requestId: msg.requestId,
      type: 'api_response',
      userId,
      body: { status: result.status, data: result.data }
    }))
  }

  private async handleWsSubscribe(client: WsClient, msg: WsMessage): Promise<void> {
    if (!client.registration) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'invalid_token', message: 'Not authenticated' }
      }))
      return
    }

    const body = msg.body as { accountIds?: string[]; events?: string[] }
    if (!body?.accountIds || !Array.isArray(body.accountIds)) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'error',
        body: { error: 'invalid_request', message: 'accountIds array is required' }
      }))
      return
    }

    // Map VRChat user IDs to local account IDs and validate access
    const allAccounts = await accountManager.getAccounts()
    const validAccountIds: string[] = []
    const validVrchatUserIds: string[] = []

    for (const uid of body.accountIds) {
      const account = allAccounts.find((a) => a.vrchatUserId === uid)
      if (account && client.registration.grantedAccountIds.includes(account.id)) {
        validAccountIds.push(account.id)
        validVrchatUserIds.push(uid)
      }
    }

    if (validAccountIds.length === 0) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'subscribe_response',
        body: { success: false, error: 'No valid accounts to subscribe to' }
      }))
      return
    }

    const permittedEvents = filterPermittedEvents(client.registration.grantedScopes, body.events)
    if (permittedEvents.length === 0) {
      client.ws.send(JSON.stringify({
        requestId: msg.requestId,
        type: 'subscribe_response',
        body: { success: false, error: 'Token does not have any pipeline scopes' }
      }))
      return
    }

    client.subscribedAccountIds = validAccountIds
    client.subscribedEvents = permittedEvents

    auditLogger.log('pipeline.subscribed', {
      appName: client.registration.appName,
      subscribedAccounts: validVrchatUserIds.join(','),
      subscribedEvents: permittedEvents.join(',')
    })

    client.ws.send(JSON.stringify({
      requestId: msg.requestId,
      type: 'subscribe_response',
      body: {
        success: true,
        subscribedAccounts: validVrchatUserIds,
        subscribedEvents: permittedEvents
      }
    }))
  }

  private handleWsUnsubscribe(client: WsClient, msg: WsMessage): void {
    client.subscribedAccountIds = []
    client.subscribedEvents = []

    if (client.registration) {
      auditLogger.log('pipeline.unsubscribed', { appName: client.registration.appName })
    }

    client.ws.send(JSON.stringify({
      requestId: msg.requestId,
      type: 'unsubscribe_response',
      body: { success: true }
    }))
  }

  /**
   * Broadcast a pipeline event to all matching WS clients.
   */
  private broadcastWsEvent(event: PipelineEvent, accountId: string): void {
    for (const client of this.wsClients) {
      if (!client.registration) continue
      if (!client.subscribedAccountIds.includes(accountId)) continue
      if (!client.subscribedEvents.includes(event.eventType)) continue

      // Check scope
      const requiredScope = getEventScope(event.eventType)
      if (requiredScope && !hasScope(client.registration.grantedScopes, requiredScope)) continue

      try {
        client.ws.send(JSON.stringify({
          type: 'event',
          userId: event.userId,
          body: event
        }))
      } catch {
        // Connection broken
      }
    }
  }
}

export const apiServer = new ApiServer()
