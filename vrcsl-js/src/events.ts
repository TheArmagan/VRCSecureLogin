/** Event type definitions for vrcsl.js SDK. */

/** All VRChat pipeline event types. */
export type PipelineEvent =
  | "friend-online"
  | "friend-offline"
  | "friend-add"
  | "friend-delete"
  | "friend-update"
  | "friend-location"
  | "user-update"
  | "user-location"
  | "notification"
  | "notification-v2"
  | "see-notification"
  | "hide-notification"
  | "content-refresh"
  | "session-refreshed"
  | "session-expired"
  | "account-online"
  | "account-offline"
  | "token-revoked"
  | "token-expired";

/** SDK lifecycle event types. */
export type LifecycleEvent =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "reconnected"
  | "reconnect_failed"
  | "token_refreshed"
  | "token_expired"
  | "transport_fallback"
  | "error";

/** All event types (pipeline + lifecycle + wildcard). */
export type VRCSLEvent = PipelineEvent | LifecycleEvent | "*";

/** Minimal event emitter for the SDK. */
export class EventEmitter {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  once(event: string, listener: (...args: unknown[]) => void): () => void {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  protected emit(event: string, ...args: unknown[]): void {
    // Emit to specific listeners
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        listener(...args);
      }
    }
    // Emit to wildcard listeners (except for wildcard itself)
    if (event !== "*") {
      const wildcardListeners = this.listeners.get("*");
      if (wildcardListeners) {
        for (const listener of wildcardListeners) {
          listener(...args);
        }
      }
    }
  }

  protected removeAllListeners(): void {
    this.listeners.clear();
  }
}
