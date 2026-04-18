/** SSE transport for event streaming (HTTP fallback). */

import { VRCSLError } from "../error";
import type { SubscribeResult, EventPayload } from "../types";
import type { EventTransport, TransportOptions } from "./types";

export class SSETransport implements EventTransport {
  private baseUrl: string;
  private abortController: AbortController | null = null;
  private onEvent: ((event: EventPayload) => void) | null = null;
  private lastSubscription: { accountIds: string[]; events?: string[] } | null = null;
  private reconnectInterval: number;
  private onDisconnect: (() => void) | null = null;
  private closed = false;

  constructor(options: TransportOptions & { reconnectInterval?: number }) {
    this.baseUrl = `http://${options.host}:${options.port}`;
    this.reconnectInterval = options.reconnectInterval ?? 3000;
  }

  /** Set callback for unexpected disconnects (used by client for reconnect). */
  setDisconnectHandler(handler: () => void): void {
    this.onDisconnect = handler;
  }

  get lastSub(): { accountIds: string[]; events?: string[] } | null {
    return this.lastSubscription;
  }

  async subscribe(
    token: string,
    accountIds: string[],
    events?: string[],
    onEvent?: (event: EventPayload) => void
  ): Promise<SubscribeResult> {
    // Close any existing connection
    this.closeStream();
    this.closed = false;

    if (onEvent) {
      this.onEvent = onEvent;
    }

    this.lastSubscription = { accountIds, events };

    // Build URL with query params
    const url = new URL(`${this.baseUrl}/events`);
    url.searchParams.set("accountIds", accountIds.join(","));
    if (events && events.length > 0) {
      url.searchParams.set("events", events.join(","));
    }

    // Use fetch-based SSE parsing (works in both browser and Node/Bun)
    this.connectStream(url.toString(), token);

    return {
      subscribedAccounts: accountIds,
      subscribedEvents: events ?? [],
    };
  }

  private connectStream(url: string, token: string): void {
    this.abortController = new AbortController();

    const doConnect = async () => {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          signal: this.abortController!.signal,
        });

        if (!response.ok) {
          throw new VRCSLError("sse_error", `SSE connection failed: HTTP ${response.status}`, response.status);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new VRCSLError("sse_error", "SSE response has no readable body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let eventData = "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              eventData += line.slice(6);
            } else if (line === "" && eventData) {
              // End of event
              try {
                const parsed = JSON.parse(eventData);
                this.onEvent?.({
                  userId: parsed.userId ?? "",
                  eventType: parsed.eventType ?? "",
                  source: parsed.source ?? "vrchat",
                  timestamp: parsed.timestamp ?? new Date().toISOString(),
                  data: parsed.data ?? null,
                });
              } catch {
                // Malformed SSE data — skip
              }
              eventData = "";
            }
          }
        }
      } catch (err) {
        if (this.closed) return;
        if (err instanceof DOMException && err.name === "AbortError") return;

        // Schedule reconnect
        if (!this.closed) {
          this.onDisconnect?.();
          setTimeout(() => {
            if (!this.closed) {
              this.connectStream(url, token);
            }
          }, this.reconnectInterval);
        }
      }
    };

    doConnect();
  }

  async unsubscribe(): Promise<void> {
    this.closeStream();
    this.onEvent = null;
    this.lastSubscription = null;
  }

  private closeStream(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  close(): void {
    this.closed = true;
    this.closeStream();
    this.onEvent = null;
    this.lastSubscription = null;
  }
}
