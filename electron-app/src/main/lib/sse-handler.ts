// ─── SSE Handler for /events endpoint ───

import type { IncomingMessage, ServerResponse } from 'http'
import { createHash } from 'crypto'
import { tokenManager } from './token-manager'
import { pipelineManager } from './pipeline-manager'
import { auditLogger } from './audit-logger'
import { hasScope, getEventScope, filterPermittedEvents } from './scope-resolver'
import type { PipelineEvent, AppRegistration } from './types'

interface SSEConnection {
  res: ServerResponse
  registration: AppRegistration
  subscribedAccountIds: string[]
  subscribedEvents: string[]
  connectedAt: number
}

const MAX_SSE_PER_TOKEN = 3
const IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export class SSEHandler {
  private connections = new Map<string, SSEConnection[]>()
  private idleTimers = new Map<ServerResponse, ReturnType<typeof setTimeout>>()

  constructor() {
    // Listen to pipeline events
    pipelineManager.on('event', (event: PipelineEvent, accountId: string) => {
      this.broadcastEvent(event, accountId)
    })
  }

  /**
   * Handle GET /events SSE request.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Extract token
    const authHeader = req.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_token', message: 'Missing or invalid Authorization header.' }))
      return
    }

    const token = authHeader.slice(7)
    const registration = await tokenManager.validateToken(token)
    if (!registration) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_token', message: 'Token is invalid or expired.' }))
      return
    }

    // Parse query params
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const accountIdsParam = url.searchParams.get('accountIds')
    const eventsParam = url.searchParams.get('events')

    if (!accountIdsParam) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'invalid_request', message: 'accountIds parameter is required.' }))
      return
    }

    const requestedAccountIds = accountIdsParam.split(',').filter(Boolean)
    const requestedEvents = eventsParam ? eventsParam.split(',').filter(Boolean) : undefined

    // Verify account access
    const validAccountIds = requestedAccountIds.filter((id) =>
      registration.grantedAccountIds.includes(id)
    )
    if (validAccountIds.length === 0) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'account_denied', message: 'Token does not have access to any of the requested accounts.' }))
      return
    }

    // Filter permitted events by scope
    const permittedEvents = filterPermittedEvents(registration.grantedScopes, requestedEvents)
    if (permittedEvents.length === 0) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'scope_denied', message: 'Token does not have any pipeline scopes.' }))
      return
    }

    // Check connection limit per token
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const existing = this.connections.get(tokenHash) ?? []
    if (existing.length >= MAX_SSE_PER_TOKEN) {
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'rate_limited', message: `Maximum ${MAX_SSE_PER_TOKEN} concurrent SSE connections per token.` }))
      return
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    // Send retry directive
    res.write('retry: 3000\n\n')

    const connection: SSEConnection = {
      res,
      registration,
      subscribedAccountIds: validAccountIds,
      subscribedEvents: permittedEvents,
      connectedAt: Date.now()
    }

    // Store connection
    existing.push(connection)
    this.connections.set(tokenHash, existing)

    auditLogger.log('pipeline.sse_connected', {
      appName: registration.appName,
      subscribedAccounts: validAccountIds.join(','),
      subscribedEvents: permittedEvents.join(',')
    })

    // Set up idle timeout
    this.resetIdleTimer(res, tokenHash, connection)

    // Handle disconnect
    req.on('close', () => {
      this.removeConnection(tokenHash, connection)
      const timer = this.idleTimers.get(res)
      if (timer) {
        clearTimeout(timer)
        this.idleTimers.delete(res)
      }

      const duration = Date.now() - connection.connectedAt
      auditLogger.log('pipeline.sse_disconnected', {
        appName: registration.appName,
        duration: `${duration}ms`
      })
    })
  }

  /**
   * Broadcast a pipeline event to all matching SSE connections.
   */
  private broadcastEvent(event: PipelineEvent, accountId: string): void {
    for (const [tokenHash, connections] of this.connections) {
      for (const conn of connections) {
        // Check account filter
        if (!conn.subscribedAccountIds.includes(accountId)) continue

        // Check event filter
        if (!conn.subscribedEvents.includes(event.eventType)) continue

        // Check scope
        const requiredScope = getEventScope(event.eventType)
        if (requiredScope && !hasScope(conn.registration.grantedScopes, requiredScope)) continue

        // Send SSE message
        try {
          conn.res.write(`event: ${event.eventType}\n`)
          conn.res.write(`data: ${JSON.stringify(event)}\n\n`)
          this.resetIdleTimer(conn.res, tokenHash, conn)
        } catch {
          // Connection broken, will be cleaned up
        }
      }
    }
  }

  private resetIdleTimer(res: ServerResponse, tokenHash: string, conn: SSEConnection): void {
    const existing = this.idleTimers.get(res)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      try {
        res.end()
      } catch {
        // Already closed
      }
      this.removeConnection(tokenHash, conn)
      this.idleTimers.delete(res)
    }, IDLE_TIMEOUT_MS)

    this.idleTimers.set(res, timer)
  }

  private removeConnection(tokenHash: string, conn: SSEConnection): void {
    const connections = this.connections.get(tokenHash)
    if (!connections) return

    const idx = connections.indexOf(conn)
    if (idx !== -1) connections.splice(idx, 1)
    if (connections.length === 0) this.connections.delete(tokenHash)
  }

  /**
   * Close all SSE connections.
   */
  closeAll(): void {
    for (const [, connections] of this.connections) {
      for (const conn of connections) {
        try {
          conn.res.end()
        } catch {
          // Already closed
        }
      }
    }
    this.connections.clear()
    for (const [, timer] of this.idleTimers) {
      clearTimeout(timer)
    }
    this.idleTimers.clear()
  }
}

export const sseHandler = new SSEHandler()
