/** WebSocket transport with requestId correlation. */

import { VRCSLError } from "../error";
import type {
  RegisterResult,
  RefreshResult,
  AccountInfo,
  ApiResponse,
  BatchRequest,
  BatchResponse,
  SubscribeResult,
  EventPayload,
} from "../types";
import type { Transport, EventTransport, TransportOptions } from "./types";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: VRCSLError) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WSMessage {
  requestId?: string;
  type: string;
  userId?: string;
  body?: Record<string, unknown>;
}

/** Get a WebSocket constructor for the current runtime. */
function getWebSocketCtor(): typeof WebSocket {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket;
  }
  // Node.js < 22 — use ws package
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // @ts-ignore
    return require("ws");
  } catch {
    throw new VRCSLError(
      "connection_failed",
      "WebSocket not available. Install the 'ws' package: npm install ws"
    );
  }
}

export class WSTransport implements Transport, EventTransport {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private onEvent: ((event: EventPayload) => void) | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastSubscription: { accountIds: string[]; events?: string[] } | null = null;

  private host: string;
  private port: number;
  private connectionTimeout: number;
  private requestTimeout: number;

  // Reconnection state
  private onDisconnect: (() => void) | null = null;
  private closed = false;

  constructor(options: TransportOptions) {
    this.host = options.host;
    this.port = options.port;
    this.connectionTimeout = options.connectionTimeout;
    this.requestTimeout = options.requestTimeout;
  }

  private nextRequestId(): string {
    return `req-${++this.requestCounter}`;
  }

  /** Connect the WebSocket. */
  async connect(token?: string): Promise<void> {
    const WS = getWebSocketCtor();
    this.closed = false;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.close();
        reject(new VRCSLError("connection_timeout", "WebSocket connection timed out"));
      }, this.connectionTimeout);

      const ws = new WS(`ws://${this.host}:${this.port}/ws`);

      ws.onopen = async () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.setupPingPong();

        if (token) {
          try {
            await this.authenticate(token);
          } catch (err) {
            reject(err);
            return;
          }
        }
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new VRCSLError("connection_failed", "WebSocket connection failed"));
      };

      ws.onclose = (event: CloseEvent) => {
        clearTimeout(timeout);
        const code = event.code;
        const reason = event.reason || 'Unknown reason';
        this.cleanup(code, reason);
        if (!this.closed) {
          this.onDisconnect?.();
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };
    });
  }

  /** Set callback for unexpected disconnects (used by client for reconnect). */
  setDisconnectHandler(handler: () => void): void {
    this.onDisconnect = handler;
  }

  async authenticate(token: string): Promise<void> {
    const result = await this.send<{ success: boolean }>("auth", { token });
    if (!result.success) {
      throw new VRCSLError("invalid_token", "WebSocket authentication failed", 401);
    }
  }

  private send<T>(type: string, body: Record<string, unknown>, userId?: string): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new VRCSLError("not_connected", "WebSocket is not connected"));
    }

    const requestId = this.nextRequestId();
    const message: WSMessage = { requestId, type, body };
    if (userId) message.userId = userId;

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new VRCSLError("request_timeout", `Request ${requestId} timed out`));
      }, this.requestTimeout);

      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.ws!.send(JSON.stringify(message));
    });
  }

  private handleMessage(event: MessageEvent): void {
    let msg: WSMessage;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return;
    }

    // Handle pong
    if (msg.type === "pong") {
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = null;
      }
      return;
    }

    // Handle pipeline events
    if (msg.type === "event" && this.onEvent) {
      this.onEvent({
        userId: msg.userId ?? "",
        eventType: (msg.body?.eventType as string) ?? "",
        source: (msg.body?.source as "vrchat" | "vrcsl") ?? "vrchat",
        timestamp: (msg.body?.timestamp as string) ?? new Date().toISOString(),
        data: msg.body?.data ?? null,
      });
      return;
    }

    // Handle request/response correlation
    if (msg.requestId && this.pending.has(msg.requestId)) {
      const pending = this.pending.get(msg.requestId)!;
      this.pending.delete(msg.requestId);
      clearTimeout(pending.timeout);

      if (msg.type === "error") {
        pending.reject(
          new VRCSLError(
            (msg.body?.error as string) ?? "internal_error",
            (msg.body?.message as string) ?? "Unknown error"
          )
        );
      } else {
        pending.resolve(msg.body ?? {});
      }
    }
  }

  private setupPingPong(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
        this.pongTimeout = setTimeout(() => {
          // No pong received — close and trigger reconnect
          this.ws?.close();
        }, 10_000);
      }
    }, 30_000);
  }

  private cleanup(code?: number, reason?: string): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    // Reject all pending requests
    const errorMessage = code
      ? `WebSocket closed (code: ${code}, reason: ${reason ?? 'none'})`
      : 'WebSocket closed';
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new VRCSLError("ws_closed", errorMessage));
    }
    this.pending.clear();
    this.ws = null;
  }

  /** Close the WebSocket connection cleanly. */
  close(): void {
    this.closed = true;
    this.onEvent = null;
    this.lastSubscription = null;
    // Clear pending before closing so they get a clear error
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new VRCSLError("ws_closed", "WebSocket closed by client"));
    }
    this.pending.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get lastSub(): { accountIds: string[]; events?: string[] } | null {
    return this.lastSubscription;
  }

  // --- Transport interface ---

  async register(params: {
    appName: string;
    appDescription?: string;
    scopes: string[];
    origin?: string;
    token?: string;
  }): Promise<RegisterResult> {
    return this.send<RegisterResult>("register", {
      appName: params.appName,
      appDescription: params.appDescription,
      scopes: params.scopes,
      ...(params.origin ? { origin: params.origin } : {}),
    });
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    return this.send<RefreshResult>("refresh", { refreshToken });
  }

  async getAccounts(token: string): Promise<AccountInfo[]> {
    const data = await this.send<{ accounts: AccountInfo[] }>("accounts", { token });
    return data.accounts;
  }

  async api(
    _token: string,
    userId: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse> {
    const result = await this.send<{ status: number; data: unknown }>(
      "api_request",
      { method, path, body: body ?? null },
      userId
    );
    return { status: result.status, data: result.data };
  }

  async batch(_token: string, requests: BatchRequest[]): Promise<BatchResponse[]> {
    // WS doesn't have a batch message — send individual requests and collect
    const promises = requests.map(async (req) => {
      try {
        const result = await this.send<{ status: number; data: unknown }>(
          "api_request",
          { method: req.method, path: req.path, body: req.body ?? null },
          req.userId
        );
        return {
          requestId: req.requestId,
          status: result.status,
          data: result.data,
        } as BatchResponse;
      } catch (err) {
        return {
          requestId: req.requestId,
          status: err instanceof VRCSLError ? (err.status ?? 500) : 500,
          data: { error: err instanceof VRCSLError ? err.code : "internal_error" },
        } as BatchResponse;
      }
    });
    return Promise.all(promises);
  }

  // --- EventTransport interface ---

  async subscribe(
    _token: string,
    accountIds: string[],
    events?: string[],
    onEvent?: (event: EventPayload) => void
  ): Promise<SubscribeResult> {
    if (onEvent) {
      this.onEvent = onEvent;
    }

    const body: Record<string, unknown> = { accountIds };
    if (events && events.length > 0) {
      body.events = events;
    }

    const result = await this.send<{
      success: boolean;
      subscribedAccounts: string[];
      subscribedEvents: string[];
    }>("subscribe", body);

    this.lastSubscription = { accountIds, events };

    return {
      subscribedAccounts: result.subscribedAccounts,
      subscribedEvents: result.subscribedEvents,
    };
  }

  async unsubscribe(): Promise<void> {
    await this.send("unsubscribe", {});
    this.onEvent = null;
    this.lastSubscription = null;
  }
}
