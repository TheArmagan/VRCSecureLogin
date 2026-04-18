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
