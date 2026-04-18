/** HTTP transport using native fetch. */

import { VRCSLError } from "../error";
import type {
  RegisterResult,
  RefreshResult,
  AccountInfo,
  ApiResponse,
  BatchRequest,
  BatchResponse,
} from "../types";
import type { Transport, TransportOptions } from "./types";

export class HTTPTransport implements Transport {
  private baseUrl: string;
  private requestTimeout: number;

  constructor(options: TransportOptions) {
    this.baseUrl = `http://${options.host}:${options.port}`;
    this.requestTimeout = options.requestTimeout;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string }
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options?.token) {
      headers["Authorization"] = `Bearer ${options.token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new VRCSLError(
          data.error ?? "internal_error",
          data.message ?? `HTTP ${response.status}`,
          response.status
        );
      }

      return data as T;
    } catch (err) {
      if (err instanceof VRCSLError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new VRCSLError("request_timeout", "Request timed out");
      }
      throw new VRCSLError(
        "connection_failed",
        `Failed to connect to VRCSL: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async register(params: {
    appName: string;
    appDescription?: string;
    scopes: string[];
    origin?: string;
  }): Promise<RegisterResult> {
    return this.request<RegisterResult>("POST", "/register", {
      body: {
        appName: params.appName,
        appDescription: params.appDescription,
        scopes: params.scopes,
        ...(params.origin ? { origin: params.origin } : {}),
      },
    });
  }

  async refresh(refreshToken: string): Promise<RefreshResult> {
    return this.request<RefreshResult>("POST", "/refresh", {
      body: { refreshToken },
    });
  }

  async getAccounts(token: string): Promise<AccountInfo[]> {
    const data = await this.request<{ accounts: AccountInfo[] }>("GET", "/accounts", { token });
    return data.accounts;
  }

  async api(
    token: string,
    userId: string,
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse> {
    return this.request<ApiResponse>("POST", "/api", {
      token,
      body: { userId, method, path, body: body ?? null },
    });
  }

  async batch(token: string, requests: BatchRequest[]): Promise<BatchResponse[]> {
    const data = await this.request<{ responses: BatchResponse[] }>("POST", "/api/batch", {
      token,
      body: { requests },
    });
    return data.responses;
  }
}
