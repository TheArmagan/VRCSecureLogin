// ─── Pipeline Manager: VRChat WebSocket pipeline + event routing ───

import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { accountManager } from './account-manager'
import type { PipelineEvent } from './types'

const VRCHAT_PIPELINE_URL = 'wss://pipeline.vrchat.cloud'

interface PipelineConnection {
  accountId: string
  vrchatUserId: string
  ws: WebSocket | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

export class PipelineManager extends EventEmitter {
  private connections = new Map<string, PipelineConnection>()

  /**
   * Start pipeline connections for all active accounts.
   */
  async startAll(): Promise<void> {
    const accounts = await accountManager.getAccounts()
    for (const account of accounts) {
      if (account.status === 'online' && account.sessionData) {
        this.connect(account.id, account.vrchatUserId, account.sessionData.authCookie)
      }
    }

    // Listen for account status changes
    accountManager.on('account-online', async (accountId: string) => {
      const account = await accountManager.getAccount(accountId)
      if (account?.sessionData) {
        this.connect(account.id, account.vrchatUserId, account.sessionData.authCookie)
      }
    })

    accountManager.on('account-offline', (accountId: string) => {
      this.disconnect(accountId)
    })

    accountManager.on('account-removed', (accountId: string) => {
      this.disconnect(accountId)
    })

    accountManager.on('session-refreshed', async (accountId: string) => {
      const account = await accountManager.getAccount(accountId)
      if (account?.sessionData) {
        this.disconnect(accountId)
        this.connect(account.id, account.vrchatUserId, account.sessionData.authCookie)
      }
    })
  }

  /**
   * Connect to VRChat pipeline for a specific account.
   */
  private connect(accountId: string, vrchatUserId: string, authCookie: string): void {
    if (this.connections.has(accountId)) {
      this.disconnect(accountId)
    }

    const conn: PipelineConnection = {
      accountId,
      vrchatUserId,
      ws: null,
      reconnectTimer: null
    }

    try {
      const url = `${VRCHAT_PIPELINE_URL}/?authToken=${encodeURIComponent(authCookie)}`
      conn.ws = new WebSocket(url, {
        headers: {
          'User-Agent': 'VRCSecureLogin/1.0.0'
        }
      })

      conn.ws.on('open', () => {
        console.log(`[Pipeline] Connected for account ${accountId}`)
      })

      conn.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString())
          this.handlePipelineMessage(accountId, vrchatUserId, msg)
        } catch {
          // Ignore malformed messages
        }
      })

      conn.ws.on('close', () => {
        console.log(`[Pipeline] Disconnected for account ${accountId}`)
        // Reconnect after 5 seconds
        conn.reconnectTimer = setTimeout(async () => {
          const account = await accountManager.getAccount(accountId)
          if (account?.status === 'online' && account.sessionData) {
            this.connect(accountId, vrchatUserId, account.sessionData.authCookie)
          }
        }, 5000)
      })

      conn.ws.on('error', (err) => {
        console.error(`[Pipeline] Error for account ${accountId}:`, err.message)
      })
    } catch (err) {
      console.error(`[Pipeline] Failed to connect for account ${accountId}:`, err)
    }

    this.connections.set(accountId, conn)
  }

  /**
   * Disconnect pipeline for a specific account.
   */
  private disconnect(accountId: string): void {
    const conn = this.connections.get(accountId)
    if (!conn) return

    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer)
    if (conn.ws) {
      conn.ws.removeAllListeners()
      conn.ws.close()
    }
    this.connections.delete(accountId)
  }

  /**
   * Handle incoming VRChat pipeline message.
   */
  private handlePipelineMessage(
    accountId: string,
    vrchatUserId: string,
    msg: { type?: string; content?: string }
  ): void {
    if (!msg.type) return

    let data: unknown = {}
    if (msg.content) {
      try {
        data = JSON.parse(msg.content)
      } catch {
        data = msg.content
      }
    }

    const event: PipelineEvent = {
      userId: vrchatUserId,
      eventType: msg.type,
      source: 'vrchat',
      timestamp: new Date().toISOString(),
      data
    }

    // Emit to all subscribers
    this.emit('event', event, accountId)
  }

  /**
   * Emit a VRCSL internal event.
   */
  emitInternalEvent(
    accountId: string,
    vrchatUserId: string,
    eventType: string,
    data: unknown = {}
  ): void {
    const event: PipelineEvent = {
      userId: vrchatUserId,
      eventType,
      source: 'vrcsl',
      timestamp: new Date().toISOString(),
      data
    }

    this.emit('event', event, accountId)
  }

  /**
   * Stop all pipeline connections.
   */
  stopAll(): void {
    for (const [accountId] of this.connections) {
      this.disconnect(accountId)
    }
  }

  /**
   * Check if an account has an active pipeline connection.
   */
  isConnected(accountId: string): boolean {
    const conn = this.connections.get(accountId)
    return conn?.ws?.readyState === WebSocket.OPEN
  }
}

export const pipelineManager = new PipelineManager()
