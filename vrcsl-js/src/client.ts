/** VRCSLClient — main public API class for vrcsl.js SDK. */

import { VRCSLError } from "./error";
import { EventEmitter } from "./events";
import type { Logger, LogLevel } from "./logger";
import { createLogger } from "./logger";
import type { TokenStore } from "./token-store";
import { MemoryStore, getDefaultTokenStore } from "./token-store";
import { HTTPTransport } from "./transport/http";
import { WSTransport } from "./transport/ws";
import { SSETransport } from "./transport/sse";
import type {
  RegisterResult,
  RefreshResult,
  AccountInfo,
  ApiResponse,
  BatchRequest,
  BatchResponse,
  SubscribeResult,
  EventPayload,
} from "./types";

const TOKEN_KEY = "vrcsl_token";
const REFRESH_TOKEN_KEY = "vrcsl_refresh_token";

export interface VRCSLClientOptions {
  appName: string;
  appDescription?: string;
  appImage?: string;
  port?: number;
  host?: string;
  transport?: "auto" | "http" | "ws";
  scopes?: string[];
  maxAccounts?: number;
  token?: string;
  refreshToken?: string;
  tokenStore?: TokenStore | false;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  connectionTimeout?: number;
  requestTimeout?: number;
  logLevel?: LogLevel;
  logger?: Logger;
}

type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

export class VRCSLClient extends EventEmitter {
  private opts: Required<
    Pick<
      VRCSLClientOptions,
      "appName" | "port" | "host" | "reconnectInterval" | "maxReconnectAttempts" | "connectionTimeout" | "requestTimeout"
    >
  > & {
    appDescription?: string;
    appImage?: string;
    transportMode: "auto" | "http" | "ws";
    scopes: string[];
    maxAccounts: number;
  };

  private log: Logger;
  private store: TokenStore;

  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;

  private httpTransport: HTTPTransport | null = null;
  private wsTransport: WSTransport | null = null;
  private sseTransport: SSETransport | null = null;

  private _state: ConnectionState = "disconnected";
  private _activeTransport: "ws" | "http" | null = null;

  private refreshLock: Promise<RefreshResult> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: VRCSLClientOptions) {
    super();

    this.opts = {
      appName: options.appName,
      appDescription: options.appDescription,
      appImage: options.appImage,
      port: options.port ?? 7642,
      host: options.host ?? "127.0.0.1",
      transportMode: options.transport ?? "auto",
      scopes: options.scopes ?? [],
      maxAccounts: options.maxAccounts ?? 0,
      reconnectInterval: options.reconnectInterval ?? 5000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      connectionTimeout: options.connectionTimeout ?? 3000,
      requestTimeout: options.requestTimeout ?? 60000 * 5,
    };

    this.log = createLogger(options.logLevel ?? "silent", options.logger);

    // Token store
    if (options.tokenStore === false) {
      this.store = new MemoryStore();
    } else if (options.tokenStore) {
      this.store = options.tokenStore;
    } else {
      this.store = getDefaultTokenStore();
    }

    // Pre-supplied tokens
    if (options.token) {
      this.accessToken = options.token;
    }
    if (options.refreshToken) {
      this.refreshTokenValue = options.refreshToken;
    }
  }

  /** Current connection state. */
  get state(): ConnectionState {
    return this._state;
  }

  /** The currently active transport type. */
  get activeTransport(): "ws" | "http" | null {
    return this._activeTransport;
  }

  /** Whether the client has a valid access token. */
  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  /** Connect to VRCSL. Establishes WS or verifies HTTP connectivity. */
  async connect(): Promise<void> {
    if (this._state === "connected") return;
    this._state = "connecting";

    // Load tokens from store if not pre-supplied
    if (!this.accessToken) {
      this.accessToken = await this.store.get(TOKEN_KEY) ?? null;
    }
    if (!this.refreshTokenValue) {
      this.refreshTokenValue = await this.store.get(REFRESH_TOKEN_KEY) ?? null;
    }

    const transportOpts = {
      host: this.opts.host,
      port: this.opts.port,
      connectionTimeout: this.opts.connectionTimeout,
      requestTimeout: this.opts.requestTimeout,
    };

    if (this.opts.transportMode === "http") {
      this.httpTransport = new HTTPTransport(transportOpts);
      this._activeTransport = "http";

      // Validate stored token
      if (this.accessToken) {
        try {
          await this.httpTransport.getAccounts(this.accessToken);
        } catch (err) {
          if (err instanceof VRCSLError && err.code === "invalid_token") {
            // Try refresh
            if (this.refreshTokenValue) {
              try {
                this.log.debug("Stored token expired, attempting refresh");
                const result = await this.httpTransport.refresh(this.refreshTokenValue);
                await this.storeTokens(result.token, result.refreshToken);
                this.log.info("Token refreshed successfully during connect");
              } catch {
                this.log.warn("Token refresh failed, clearing credentials");
                await this.clearTokens();
              }
            } else {
              await this.clearTokens();
            }
          }
          // Non-auth errors (network, etc) — keep tokens, server might be temporarily down
        }
      }

      this._state = "connected";
      this.log.info("Connected via HTTP transport");
      this.emit("connected", {});
      return;
    }

    // Try WebSocket first (auto or ws mode)
    try {
      const ws = new WSTransport(transportOpts);
      await ws.connect();
      this.wsTransport = ws;
      this._activeTransport = "ws";

      // Validate stored token via WS auth
      if (this.accessToken) {
        try {
          await this.wsAuthenticateToken(ws, this.accessToken);
        } catch {
          // Token invalid — try refresh
          if (this.refreshTokenValue) {
            try {
              this.log.debug("Stored token expired, attempting refresh");
              const transport = this.getTransport();
              const result = await transport.refresh(this.refreshTokenValue);
              await this.storeTokens(result.token, result.refreshToken);
              await this.wsAuthenticateToken(ws, result.token);
              this.log.info("Token refreshed successfully during connect");
            } catch {
              this.log.warn("Token refresh failed, clearing credentials");
              await this.clearTokens();
            }
          } else {
            this.log.info("Stored token invalid and no refresh token, clearing");
            await this.clearTokens();
          }
        }
      }

      this._state = "connected";
      this.log.info("Connected via WebSocket transport");

      // Set up disconnect handler for reconnection
      ws.setDisconnectHandler(() => this.handleWSDisconnect());

      this.emit("connected", {});
    } catch (err) {
      if (this.opts.transportMode === "ws") {
        this._state = "disconnected";
        throw err instanceof VRCSLError
          ? err
          : new VRCSLError("connection_failed", "WebSocket connection failed");
      }

      // Fallback to HTTP (auto mode)
      this.log.warn("WebSocket failed, falling back to HTTP transport");
      this.httpTransport = new HTTPTransport(transportOpts);
      this._activeTransport = "http";
      this._state = "connected";
      this.emit("transport_fallback", { from: "ws", to: "http" });
      this.emit("connected", {});
    }
  }

  /** Disconnect. Closes WS, SSE, clears pending requests. */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;

    this.wsTransport?.close();
    this.wsTransport = null;

    this.sseTransport?.close();
    this.sseTransport = null;

    this.httpTransport = null;
    this._activeTransport = null;
    this._state = "disconnected";

    this.log.info("Disconnected");
    this.emit("disconnected", { reason: "client_disconnect" });
  }

  /** Register this app with VRCSL. */
  async register(options?: { scopes?: string[]; origin?: string }): Promise<RegisterResult> {
    this.ensureConnected();

    const scopes = options?.scopes ?? this.opts.scopes;
    let origin = options?.origin;
    if (!origin && typeof window !== "undefined" && window.location) {
      origin = window.location.origin;
    }

    const params = {
      appName: this.opts.appName,
      appDescription: this.opts.appDescription,
      appImage: this.opts.appImage,
      scopes,
      maxAccounts: this.opts.maxAccounts,
      origin,
    };

    this.log.info("Registering app:", this.opts.appName);

    const transport = this.getTransport();
    const result = await transport.register(params);

    await this.storeTokens(result.token, result.refreshToken);
    this.log.info("Registration successful");

    return result;
  }

  /** Manually refresh the access token. */
  async refresh(): Promise<RefreshResult> {
    // Use the refresh lock to prevent concurrent refreshes
    if (this.refreshLock) {
      return this.refreshLock;
    }

    if (!this.refreshTokenValue) {
      throw new VRCSLError("refresh_failed", "No refresh token available");
    }

    this.refreshLock = this.doRefresh(this.refreshTokenValue);
    try {
      const result = await this.refreshLock;
      return result;
    } finally {
      this.refreshLock = null;
    }
  }

  private async doRefresh(refreshToken: string): Promise<RefreshResult> {
    this.ensureConnected();
    const transport = this.getTransport();

    try {
      this.log.debug("Refreshing access token");
      const result = await transport.refresh(refreshToken);
      await this.storeTokens(result.token, result.refreshToken);
      this.log.info("Token refreshed successfully");
      this.emit("token_refreshed", { expiresIn: result.expiresIn });
      return result;
    } catch (err) {
      this.log.error("Token refresh failed");
      this.emit("token_expired", {});
      throw new VRCSLError("refresh_failed", "Token refresh failed");
    }
  }

  /** List VRChat accounts this token has access to. */
  async getAccounts(): Promise<AccountInfo[]> {
    return this.authenticatedRequest(() => {
      const transport = this.getTransport();
      return transport.getAccounts(this.accessToken!);
    });
  }

  /** Proxy a single VRChat API request through VRCSL. */
  async api(
    userId: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<ApiResponse> {
    return this.authenticatedRequest(() => {
      const transport = this.getTransport();
      return transport.api(this.accessToken!, userId, method, path, body);
    });
  }

  /** Proxy multiple VRChat API requests in a single call. */
  async batch(requests: BatchRequest[]): Promise<BatchResponse[]> {
    return this.authenticatedRequest(() => {
      const transport = this.getTransport();
      return transport.batch(this.accessToken!, requests);
    });
  }

  /** Subscribe to VRCSL pipeline events. */
  async subscribe(accountIds: string[], events?: string[]): Promise<SubscribeResult> {
    this.ensureConnected();
    this.ensureAuthenticated();

    const onEvent = (event: EventPayload) => {
      this.emit(event.eventType, event);
    };

    if (this._activeTransport === "ws" && this.wsTransport) {
      return this.wsTransport.subscribe(this.accessToken!, accountIds, events, onEvent);
    }

    // HTTP mode — use SSE
    if (!this.sseTransport) {
      this.sseTransport = new SSETransport({
        host: this.opts.host,
        port: this.opts.port,
        connectionTimeout: this.opts.connectionTimeout,
        requestTimeout: this.opts.requestTimeout,
        reconnectInterval: this.opts.reconnectInterval,
      });
    }

    return this.sseTransport.subscribe(this.accessToken!, accountIds, events, onEvent);
  }

  /** Unsubscribe from all pipeline events. */
  async unsubscribe(): Promise<void> {
    if (this._activeTransport === "ws" && this.wsTransport) {
      await this.wsTransport.unsubscribe();
      return;
    }

    if (this.sseTransport) {
      await this.sseTransport.unsubscribe();
    }
  }

  // --- Event emitter public API (typed wrappers) ---

  on(event: string, listener: (data: EventPayload) => void): () => void {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off(event: string, listener: (data: EventPayload) => void): void {
    super.off(event, listener as (...args: unknown[]) => void);
  }

  once(event: string, listener: (data: EventPayload) => void): () => void {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  // --- Private helpers ---

  private getTransport() {
    if (this._activeTransport === "ws" && this.wsTransport) {
      return this.wsTransport;
    }
    if (this.httpTransport) {
      return this.httpTransport;
    }
    throw new VRCSLError("not_connected", "No transport available. Call connect() first.");
  }

  private ensureConnected(): void {
    if (this._state !== "connected") {
      throw new VRCSLError("not_connected", "Client is not connected. Call connect() first.");
    }
  }

  private ensureAuthenticated(): void {
    if (!this.accessToken) {
      throw new VRCSLError("not_authenticated", "Client is not authenticated. Call register() first.");
    }
  }

  private async storeTokens(token: string, refreshToken: string): Promise<void> {
    this.accessToken = token;
    this.refreshTokenValue = refreshToken;
    await this.store.set(TOKEN_KEY, token);
    await this.store.set(REFRESH_TOKEN_KEY, refreshToken);
  }

  private async clearTokens(): Promise<void> {
    this.accessToken = null;
    this.refreshTokenValue = null;
    await this.store.remove(TOKEN_KEY);
    await this.store.remove(REFRESH_TOKEN_KEY);
  }

  private async wsAuthenticateToken(ws: WSTransport, token: string): Promise<void> {
    await ws.authenticate(token);
  }

  /** Execute an authenticated request with auto-refresh on 401. */
  private async authenticatedRequest<T>(fn: () => Promise<T>): Promise<T> {
    this.ensureConnected();
    this.ensureAuthenticated();

    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof VRCSLError &&
        err.code === "invalid_token" &&
        this.refreshTokenValue
      ) {
        // Attempt token refresh
        this.log.debug("Received 401, attempting token refresh");
        try {
          await this.refresh();
          // Retry the original request with new token
          return await fn();
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }

  private handleWSDisconnect(): void {
    if (this._state === "disconnected") return;

    this.log.warn("WebSocket disconnected unexpectedly");
    this.emit("disconnected", { reason: "ws_closed" });

    // Attempt reconnection
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    const maxAttempts = this.opts.maxReconnectAttempts;
    if (maxAttempts !== 0 && this.reconnectAttempts >= maxAttempts) {
      this.log.error(`Reconnect failed after ${this.reconnectAttempts} attempts`);
      this._state = "disconnected";
      this.emit("reconnect_failed", { attempts: this.reconnectAttempts });
      return;
    }

    this.reconnectAttempts++;
    this._state = "reconnecting";
    this.log.warn(`Reconnecting (attempt ${this.reconnectAttempts})`);
    this.emit("reconnecting", { attempt: this.reconnectAttempts });

    this.reconnectTimer = setTimeout(async () => {
      try {
        const transportOpts = {
          host: this.opts.host,
          port: this.opts.port,
          connectionTimeout: this.opts.connectionTimeout,
          requestTimeout: this.opts.requestTimeout,
        };

        const ws = new WSTransport(transportOpts);
        await ws.connect(this.accessToken ?? undefined);

        this.wsTransport = ws;
        this._activeTransport = "ws";
        this._state = "connected";
        this.reconnectAttempts = 0;

        ws.setDisconnectHandler(() => this.handleWSDisconnect());

        // Re-subscribe if there was an active subscription
        const lastSub = this.wsTransport.lastSub;
        if (lastSub) {
          const onEvent = (event: EventPayload) => {
            this.emit(event.eventType, event);
          };
          await this.wsTransport.subscribe(
            this.accessToken!,
            lastSub.accountIds,
            lastSub.events,
            onEvent
          );
        }

        this.log.info("Reconnected successfully");
        this.emit("reconnected", {});
      } catch {
        this.attemptReconnect();
      }
    }, this.opts.reconnectInterval);
  }
}
