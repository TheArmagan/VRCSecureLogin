/** Shared TypeScript interfaces for vrcsl.js SDK. */

export interface RegisterResult {
  token: string;
  refreshToken: string;
  expiresIn: number;
  grantedScopes: string[];
  grantedAccounts: AccountInfo[];
}

export interface AccountInfo {
  userId: string;
  displayName: string;
  status?: string;
  avatarThumbnailUrl?: string;
}

export interface RefreshResult {
  token: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ApiResponse {
  status: number;
  data: unknown;
}

export interface BatchRequest {
  requestId: string;
  userId: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

export interface BatchResponse {
  requestId: string;
  status: number;
  data: unknown;
}

export interface SubscribeResult {
  subscribedAccounts: string[];
  subscribedEvents: string[];
}

export interface EventPayload {
  userId: string;
  eventType: string;
  source: "vrchat" | "vrcsl";
  timestamp: string;
  data: unknown;
}

/** Fetch adapter signature used by the official `vrchat` npm package. */
export type VRChatFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Generic configuration shape accepted by `new vrchat.Configuration(...)`.
 *
 * Keep this intentionally structural so users don't need to import runtime types from
 * this SDK just to pass the object into the vrchat package.
 */
export interface VRChatPackageConfig {
  basePath: string;
  fetchApi: VRChatFetch;
  [key: string]: unknown;
}
