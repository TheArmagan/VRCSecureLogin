/** Transport interface shared by HTTP, WS, and SSE transports. */

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

export interface TransportOptions {
  host: string;
  port: number;
  connectionTimeout: number;
  requestTimeout: number;
}

export interface Transport {
  /** Register with VRCSL. */
  register(params: {
    appName: string;
    appDescription?: string;
    appImage?: string;
    scopes: string[];
    maxAccounts?: number;
    origin?: string;
    token?: string;
  }): Promise<RegisterResult>;

  /** Refresh access token. */
  refresh(refreshToken: string): Promise<RefreshResult>;

  /** List accounts. */
  getAccounts(token: string): Promise<AccountInfo[]>;

  /** Proxy a single VRChat API request. */
  api(
    token: string,
    userId: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse>;

  /** Proxy multiple VRChat API requests. */
  batch(token: string, requests: BatchRequest[]): Promise<BatchResponse[]>;
}

export interface EventTransport {
  /** Subscribe to pipeline events. Returns subscription info. */
  subscribe(
    token: string,
    accountIds: string[],
    events?: string[],
    onEvent?: (event: EventPayload) => void
  ): Promise<SubscribeResult>;

  /** Unsubscribe from all events. */
  unsubscribe(): Promise<void>;

  /** Close the event transport. */
  close(): void;
}
