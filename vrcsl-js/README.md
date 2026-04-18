# vrcsl.js

Official client SDK for [VRCSecureLogin](https://github.com/TheArmagan/VRCSecureLogin). Provides a single `VRCSLClient` class that communicates with the VRCSL local API server from any JavaScript runtime.

---

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Client Options](#client-options)
- [Connection Lifecycle](#connection-lifecycle)
- [Registration](#registration)
- [Token Management](#token-management)
- [API Proxy](#api-proxy)
- [Batch API](#batch-api)
- [Event System](#event-system)
- [DeepLink Helpers](#deeplink-helpers)
- [Scope Constants](#scope-constants)
- [Error Handling](#error-handling)
- [Token Storage](#token-storage)
- [Logging](#logging)
- [Browser Usage](#browser-usage)
- [TypeScript Types](#typescript-types)
- [Compatibility](#compatibility)
- [License](#license)

---

## Overview

`vrcsl.js` connects your application to VRCSecureLogin without requiring users to share their VRChat credentials. The SDK handles transport selection, token lifecycle, event streaming, and error recovery automatically.

**Key characteristics:**

- Single `VRCSLClient` class covering HTTP, WebSocket, and SSE transports.
- Automatic WebSocket-first transport with HTTP fallback.
- Built-in token refresh with transparent request retry.
- Real-time event pipeline via WebSocket or Server-Sent Events.
- Works in browsers, Node.js 18+, and Bun 1.0+ with zero configuration.
- Type-safe API with full TypeScript declarations.

---

## Installation

### npm / yarn / pnpm / bun

```bash
npm install vrcsl.js
```

```bash
yarn add vrcsl.js
```

```bash
pnpm add vrcsl.js
```

```bash
bun add vrcsl.js
```

### CDN (Browser)

```html
<script src="https://unpkg.com/vrcsl.js/dist/index.global.js"></script>
```

```html
<script src="https://cdn.jsdelivr.net/npm/vrcsl.js/dist/index.global.js"></script>
```

When loaded via `<script>` tag, the SDK is available as `window.VRCSL`.

---

## Quick Start

### ESM / TypeScript

```typescript
import { VRCSLClient, Scopes } from "vrcsl.js";

const client = new VRCSLClient({
  appName: "My VRChat Tool",
  appDescription: "Manages avatars across accounts",
  scopes: [Scopes.AVATARS_ALL, Scopes.USERS_GET],
});

await client.connect();

const result = await client.register();
console.log("Granted accounts:", result.grantedAccounts);

const avatar = await client.api("usr_xxx", "GET", "/avatars/avtr_yyy");
console.log(avatar.data);

await client.disconnect();
```

### CommonJS

```javascript
const { VRCSLClient, Scopes } = require("vrcsl.js");

const client = new VRCSLClient({
  appName: "My VRChat Tool",
  scopes: [Scopes.AVATARS_ALL],
});
```

### Browser (Script Tag)

```html
<script src="https://unpkg.com/vrcsl.js/dist/index.global.js"></script>
<script>
  const client = new VRCSL.Client({
    appName: "My Web Tool",
    scopes: [VRCSL.Scopes.AVATARS_ALL, VRCSL.Scopes.USERS_GET],
  });

  async function init() {
    await client.connect();
    await client.register();
    const accounts = await client.getAccounts();
    console.log(accounts);
  }

  init();
</script>
```

---

## Client Options

```typescript
const client = new VRCSLClient(options: VRCSLClientOptions);
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appName` | `string` | *required* | Display name shown in the VRCSL consent dialog. |
| `appDescription` | `string` | `undefined` | Description shown in the consent dialog. |
| `port` | `number` | `7642` | VRCSL API port. |
| `host` | `string` | `"127.0.0.1"` | VRCSL API host. |
| `transport` | `"auto" \| "http" \| "ws"` | `"auto"` | Transport mode. `"auto"` attempts WebSocket first, falls back to HTTP. |
| `scopes` | `string[]` | `undefined` | Scopes to request during registration. |
| `token` | `string` | `undefined` | Pre-existing access token (skip registration). |
| `refreshToken` | `string` | `undefined` | Pre-existing refresh token. |
| `tokenStore` | `TokenStore \| false` | *auto-detected* | Token persistence adapter. `false` disables persistence. |
| `reconnectInterval` | `number` | `5000` | WebSocket/SSE reconnect interval in milliseconds. |
| `maxReconnectAttempts` | `number` | `10` | Maximum reconnect attempts. `0` for infinite. |
| `connectionTimeout` | `number` | `3000` | Connection timeout in milliseconds. |
| `requestTimeout` | `number` | `15000` | Per-request timeout in milliseconds. |
| `logLevel` | `string` | `"silent"` | One of `"debug"`, `"info"`, `"warn"`, `"error"`, `"silent"`. |
| `logger` | `Logger` | `undefined` | Custom logger implementation. |

---

## Connection Lifecycle

```typescript
// Connect to VRCSL (attempts WS, falls back to HTTP).
await client.connect();

// Check current state.
client.state;            // "disconnected" | "connecting" | "connected" | "reconnecting"
client.isAuthenticated;  // true if a valid access token is present
client.activeTransport;  // "ws" | "http" | null

// Disconnect and clean up.
await client.disconnect();
```

### Transport Selection

By default (`transport: "auto"`), the SDK attempts to open a WebSocket connection to `ws://127.0.0.1:7642/ws`. If the connection succeeds within the configured timeout, all subsequent API calls and event subscriptions use WebSocket. If it fails, the SDK falls back to HTTP for API calls and SSE for event streaming.

You can force a specific transport:

```typescript
// HTTP only (no WebSocket)
const client = new VRCSLClient({ appName: "My App", transport: "http" });

// WebSocket only (no fallback)
const client = new VRCSLClient({ appName: "My App", transport: "ws" });
```

### Auto-Reconnect

On unexpected WebSocket disconnect, the SDK automatically retries at the configured `reconnectInterval`. On successful reconnect, it re-authenticates and re-subscribes to previously active event subscriptions. The `reconnecting`, `reconnected`, and `reconnect_failed` lifecycle events are emitted during this process.

---

## Registration

Registration triggers a consent dialog on the user's machine. The user sees your application name, description, requested permissions, and process identity. If approved, you receive a scoped token pair.

```typescript
const result = await client.register({
  scopes: [Scopes.AVATARS_ALL, Scopes.USERS_GET],
});
```

The `register()` method accepts an optional `scopes` parameter that overrides the scopes provided in the constructor. For web applications, the `origin` parameter is auto-detected from `window.location`.

### RegisterResult

```typescript
interface RegisterResult {
  token: string;
  refreshToken: string;
  expiresIn: number;
  grantedScopes: string[];
  grantedAccounts: AccountInfo[];
}

interface AccountInfo {
  userId: string;
  displayName: string;
  status?: string;
  avatarThumbnailUrl?: string;
}
```

Tokens are automatically stored via the configured `TokenStore`. Subsequent API calls use the stored token without further action.

### Resuming a Session

If the `TokenStore` contains valid tokens from a previous session, the client is authenticated immediately after `connect()`:

```typescript
await client.connect();

if (client.isAuthenticated) {
  const accounts = await client.getAccounts();
} else {
  await client.register({ scopes: [Scopes.AVATARS_ALL] });
}
```

---

## Token Management

### Automatic Refresh

When an API call receives a `401 invalid_token` response, the SDK automatically:

1. Sends a refresh request using the stored refresh token.
2. Stores the new token pair.
3. Retries the original request with the new access token.

A refresh lock prevents concurrent refresh attempts. If the refresh token is also expired, the SDK emits a `token_expired` event and rejects the request.

### Manual Refresh

```typescript
const result = await client.refresh();
// result.token, result.refreshToken, result.expiresIn
```

### Pre-supplied Tokens

```typescript
const client = new VRCSLClient({
  appName: "My App",
  token: "vrcsl_at_...",
  refreshToken: "vrcsl_rt_...",
});

await client.connect();
// Ready to use immediately.
```

---

## API Proxy

Proxy VRChat API requests through VRCSL. The SDK injects the authorization header and routes through the appropriate transport automatically.

### Single Request

```typescript
client.api(
  userId: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown
): Promise<ApiResponse>
```

```typescript
interface ApiResponse {
  status: number;
  data: unknown;
}
```

**Examples:**

```typescript
// Read a user profile.
const user = await client.api("usr_xxx", "GET", "/users/usr_yyy");

// Switch avatar.
await client.api("usr_xxx", "PUT", "/avatars/avtr_yyy/select", {});

// Search users.
const results = await client.api("usr_xxx", "GET", "/users?search=keyword&n=10");
```

---

## Batch API

Send multiple VRChat API requests in a single call. Each request is identified by a unique `requestId`.

```typescript
client.batch(requests: BatchRequest[]): Promise<BatchResponse[]>
```

```typescript
interface BatchRequest {
  requestId: string;
  userId: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

interface BatchResponse {
  requestId: string;
  status: number;
  data: unknown;
}
```

**Example:**

```typescript
const results = await client.batch([
  { requestId: "1", userId: "usr_xxx", method: "GET", path: "/users/usr_yyy" },
  { requestId: "2", userId: "usr_xxx", method: "GET", path: "/worlds/wrld_zzz" },
]);

for (const res of results) {
  console.log(res.requestId, res.status, res.data);
}
```

### Transport Behavior

| Transport | Single API | Batch API |
|-----------|-----------|-----------|
| HTTP | `POST /api` | `POST /api/batch` |
| WebSocket | `api_request` message with `requestId` | Multiple `api_request` messages, correlated by `requestId` |

---

## Event System

VRCSL provides a real-time event pipeline combining VRChat pipeline events and VRCSL internal events.

### Subscribing

```typescript
await client.subscribe(
  accountIds: string[],
  events?: string[]          // omit to receive all permitted events
): Promise<SubscribeResult>
```

```typescript
interface SubscribeResult {
  subscribedAccounts: string[];
  subscribedEvents: string[];
}
```

**Example:**

```typescript
await client.subscribe(["usr_xxx"], ["friend-online", "friend-offline"]);

client.on("friend-online", (event) => {
  console.log(event.data.user.displayName, "came online");
});

client.on("friend-offline", (event) => {
  console.log(event.data.user.displayName, "went offline");
});
```

### Wildcard Listener

```typescript
await client.subscribe(["usr_xxx"]);

client.on("*", (event) => {
  console.log(event.eventType, event.data);
});
```

### Unsubscribing

```typescript
await client.unsubscribe();
```

### Event Payload

```typescript
interface EventPayload {
  userId: string;
  eventType: string;
  source: "vrchat" | "vrcsl";
  timestamp: string;
  data: unknown;
}
```

### Listener Methods

```typescript
client.on(event: string, listener: (data: EventPayload) => void): void
client.off(event: string, listener: (data: EventPayload) => void): void
client.once(event: string, listener: (data: EventPayload) => void): void
```

### SDK Lifecycle Events

These events are emitted by the client itself, not from the VRCSL pipeline.

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{}` | Connection established. |
| `disconnected` | `{ reason: string }` | Connection lost. |
| `reconnecting` | `{ attempt: number }` | Reconnect attempt starting. |
| `reconnected` | `{}` | Successfully reconnected. |
| `reconnect_failed` | `{ attempts: number }` | All reconnect attempts exhausted. |
| `token_refreshed` | `{ expiresIn: number }` | Access token was auto-refreshed. |
| `token_expired` | `{}` | Both access and refresh tokens expired. |
| `transport_fallback` | `{ from: string, to: string }` | Transport changed (e.g., WS to HTTP). |
| `error` | `VRCSLError` | Non-fatal error. |

### Pipeline Events

All VRChat and VRCSL pipeline events are forwarded through the event emitter. The event name matches the `eventType` field.

**VRChat events:** `friend-online`, `friend-offline`, `friend-add`, `friend-delete`, `friend-update`, `friend-location`, `user-update`, `user-location`, `notification`, `content-refresh`.

**VRCSL events:** `session-refreshed`, `session-expired`, `account-online`, `account-offline`, `token-revoked`.

---

## DeepLink Helpers

Static utilities for generating `vrcsl://` protocol URLs. These do not require an authenticated client instance.

```typescript
import { DeepLink } from "vrcsl.js";
```

| Method | Description |
|--------|-------------|
| `DeepLink.switchAvatar(avatarId, accountIdx?)` | Generate a switch-avatar deeplink. |
| `DeepLink.joinWorld(worldId, instanceId?, accountIdx?)` | Generate a join-world deeplink. |
| `DeepLink.addFriend(userId, accountIdx?)` | Generate an add-friend deeplink. |
| `DeepLink.open()` | Generate an open-VRCSL deeplink. |

**Examples:**

```typescript
DeepLink.switchAvatar("avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
// "vrcsl://switchavatar?avatarId=avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

DeepLink.switchAvatar("avtr_xxx", 0);
// "vrcsl://switchavatar?avatarId=avtr_xxx&accountIdx=0"

DeepLink.joinWorld("wrld_xxx", "12345~private(usr_xxx)");
// "vrcsl://joinworld?worldId=wrld_xxx&instanceId=12345~private(usr_xxx)"

DeepLink.addFriend("usr_yyy");
// "vrcsl://addfriend?userId=usr_yyy"

DeepLink.open();
// "vrcsl://open"
```

---

## Scope Constants

Type-safe scope constants are exported as the `Scopes` object. Use these when requesting permissions during registration.

```typescript
import { Scopes } from "vrcsl.js";
```

| Constant | Value |
|----------|-------|
| `Scopes.USERS_GET` | `vrchat.users.get` |
| `Scopes.USERS_SEARCH` | `vrchat.users.search` |
| `Scopes.USERS_ALL` | `vrchat.users.*` |
| `Scopes.FRIENDS_LIST` | `vrchat.friends.list` |
| `Scopes.FRIENDS_STATUS` | `vrchat.friends.status` |
| `Scopes.FRIENDS_ALL` | `vrchat.friends.*` |
| `Scopes.AVATARS_GET` | `vrchat.avatars.get` |
| `Scopes.AVATARS_SELECT` | `vrchat.avatars.select` |
| `Scopes.AVATARS_LIST` | `vrchat.avatars.list` |
| `Scopes.AVATARS_ALL` | `vrchat.avatars.*` |
| `Scopes.WORLDS_GET` | `vrchat.worlds.get` |
| `Scopes.WORLDS_LIST` | `vrchat.worlds.list` |
| `Scopes.WORLDS_ALL` | `vrchat.worlds.*` |
| `Scopes.INSTANCES_GET` | `vrchat.instances.get` |
| `Scopes.INSTANCES_CREATE` | `vrchat.instances.create` |
| `Scopes.INSTANCES_ALL` | `vrchat.instances.*` |
| `Scopes.INVITES_SEND` | `vrchat.invites.send` |
| `Scopes.INVITES_LIST` | `vrchat.invites.list` |
| `Scopes.INVITES_ALL` | `vrchat.invites.*` |
| `Scopes.FAVORITES_ALL` | `vrchat.favorites.*` |
| `Scopes.GROUPS_ALL` | `vrchat.groups.*` |
| `Scopes.NOTIFICATIONS_ALL` | `vrchat.notifications.*` |
| `Scopes.PLAYERMOD_ALL` | `vrchat.playermod.*` |
| `Scopes.FILES_ALL` | `vrchat.files.*` |
| `Scopes.PIPELINE_ALL` | `vrchat.pipeline.*` |
| `Scopes.PIPELINE_FRIEND_ONLINE` | `vrchat.pipeline.friend-online` |
| `Scopes.PIPELINE_FRIEND_OFFLINE` | `vrchat.pipeline.friend-offline` |
| `Scopes.PIPELINE_FRIEND_ADD` | `vrchat.pipeline.friend-add` |
| `Scopes.PIPELINE_FRIEND_DELETE` | `vrchat.pipeline.friend-delete` |
| `Scopes.PIPELINE_FRIEND_UPDATE` | `vrchat.pipeline.friend-update` |
| `Scopes.PIPELINE_FRIEND_LOCATION` | `vrchat.pipeline.friend-location` |
| `Scopes.PIPELINE_USER_UPDATE` | `vrchat.pipeline.user-update` |
| `Scopes.PIPELINE_USER_LOCATION` | `vrchat.pipeline.user-location` |
| `Scopes.PIPELINE_NOTIFICATION` | `vrchat.pipeline.notification` |
| `Scopes.PIPELINE_CONTENT_REFRESH` | `vrchat.pipeline.content-refresh` |
| `Scopes.VRCSL_EVENTS_ALL` | `vrcsl.events.*` |
| `Scopes.VRCSL_EVENTS_SESSION` | `vrcsl.events.session` |
| `Scopes.VRCSL_EVENTS_ACCOUNT` | `vrcsl.events.account` |
| `Scopes.VRCSL_EVENTS_TOKEN` | `vrcsl.events.token` |
| `Scopes.VRCHAT_ALL` | `vrchat.*` |

> `Scopes.VRCHAT_ALL` grants unrestricted access and triggers a warning in the VRCSL consent dialog.

---

## Error Handling

All SDK errors are instances of `VRCSLError`.

```typescript
import { VRCSLError } from "vrcsl.js";
```

```typescript
class VRCSLError extends Error {
  code: string;
  message: string;
  status: number | null;
}
```

### Error Codes

**Server errors (returned by VRCSL):**

| Code | Status | Description |
|------|--------|-------------|
| `invalid_token` | 401 | Token is invalid or expired. |
| `consent_denied` | 403 | User denied registration request. |
| `scope_denied` | 403 | Token lacks required scope. |
| `account_denied` | 403 | Token lacks access to requested account. |
| `rate_limited` | 429 | Rate limit exceeded. |
| `invalid_request` | 400 | Malformed request body. |
| `internal_error` | 500 | VRCSL internal error. |
| `vrchat_error` | 502 | VRChat API returned an error. |

**SDK errors (client-side):**

| Code | Description |
|------|-------------|
| `connection_failed` | Cannot connect to VRCSL. |
| `connection_timeout` | Connection attempt timed out. |
| `request_timeout` | API request timed out. |
| `not_connected` | API called before connecting. |
| `not_authenticated` | API called without a token. |
| `refresh_failed` | Token refresh failed (both tokens invalid). |
| `ws_closed` | WebSocket closed unexpectedly. |
| `sse_error` | SSE connection error. |

### Usage

```typescript
try {
  await client.api("usr_xxx", "GET", "/avatars/avtr_yyy");
} catch (err) {
  if (err instanceof VRCSLError) {
    switch (err.code) {
      case "scope_denied":
        console.error("Missing permission:", err.message);
        break;
      case "rate_limited":
        console.error("Too many requests, slow down");
        break;
      default:
        console.error(`VRCSL Error [${err.code}]:`, err.message);
    }
  }
}
```

---

## Token Storage

The SDK persists tokens using pluggable adapters. The default adapter is selected automatically based on the runtime environment.

### Default Selection

| Environment | Adapter | Persistence |
|-------------|---------|-------------|
| Browser | `LocalStorageStore` | Survives page reloads. |
| Node.js / Bun | `JsonFileStore` | JSON file on disk (`./vrcsl-tokens.json`). |
| `tokenStore: false` | `MemoryStore` (internal) | Session only. |

### TokenStore Interface

```typescript
interface TokenStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}
```

The SDK stores two keys: `vrcsl_token` (access token) and `vrcsl_refresh_token` (refresh token).

### Built-in Adapters

**LocalStorageStore** -- Uses `window.localStorage`. Default in browser environments.

**JsonFileStore** -- Persists to a JSON file with atomic writes (write-to-temp + rename). On Linux, files are created with mode `0o600`. Accepts a custom file path:

```typescript
import { JsonFileStore } from "vrcsl.js";

const client = new VRCSLClient({
  appName: "My App",
  tokenStore: new JsonFileStore("/home/myapp/.config/vrcsl-tokens.json"),
});
```

**MemoryStore** -- In-memory only, tokens are lost when the process exits.

```typescript
import { MemoryStore } from "vrcsl.js";

const client = new VRCSLClient({
  appName: "My App",
  tokenStore: new MemoryStore(),
});
```

### Custom Adapter

```typescript
const client = new VRCSLClient({
  appName: "My App",
  tokenStore: {
    get: (key) => myDB.get(key),
    set: (key, value) => myDB.set(key, value),
    remove: (key) => myDB.delete(key),
  },
});
```

### Disabling Persistence

```typescript
const client = new VRCSLClient({
  appName: "My App",
  tokenStore: false,
});
```

---

## Logging

By default, the SDK produces no console output (`logLevel: "silent"`).

### Log Levels

| Level | Output |
|-------|--------|
| `debug` | Transport messages, request/response bodies, token operations. |
| `info` | Connection state changes, registration, refresh, subscriptions. |
| `warn` | Reconnect attempts, transport fallback, rate limit warnings. |
| `error` | Connection failures, request failures, refresh failures. |
| `silent` | No output. |

### Enabling Logs

```typescript
const client = new VRCSLClient({
  appName: "My App",
  logLevel: "debug",
});
```

### Custom Logger

```typescript
interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const client = new VRCSLClient({
  appName: "My App",
  logLevel: "info",
  logger: myCustomLogger,
});
```

---

## Browser Usage

### UMD Global

When loaded via `<script>` tag, the SDK exposes `window.VRCSL`:

```typescript
window.VRCSL = {
  Client: VRCSLClient,
  Scopes: Scopes,
  DeepLink: DeepLink,
  VRCSLError: VRCSLError,
  version: string,
};
```

### CORS Note

Browsers enforce CORS restrictions on HTTP requests to `127.0.0.1`. The WebSocket transport bypasses this limitation. For browser-based applications, the default `"auto"` transport mode (WebSocket-first) is recommended.

---

## TypeScript Types

All public types are exported from the package entry point.

```typescript
// Core
export { VRCSLClient } from "./client";
export type { VRCSLClientOptions } from "./client";

// Results
export type {
  RegisterResult,
  RefreshResult,
  AccountInfo,
  ApiResponse,
  BatchRequest,
  BatchResponse,
  SubscribeResult,
  EventPayload,
} from "./types";

// Error
export { VRCSLError } from "./error";

// Token Storage
export type { TokenStore } from "./token-store";
export { LocalStorageStore, MemoryStore, JsonFileStore } from "./token-store";

// Constants
export { Scopes } from "./scopes";

// DeepLink
export { DeepLink } from "./deeplink";

// Logger
export type { Logger } from "./logger";

// Events
export type { VRCSLEvent, PipelineEvent, LifecycleEvent } from "./events";
```

### Event Type Unions

```typescript
type PipelineEvent =
  | "friend-online" | "friend-offline" | "friend-add"
  | "friend-delete" | "friend-update" | "friend-location"
  | "user-update" | "user-location" | "notification"
  | "notification-v2" | "see-notification" | "hide-notification"
  | "content-refresh" | "session-refreshed" | "session-expired"
  | "account-online" | "account-offline"
  | "token-revoked" | "token-expired";

type LifecycleEvent =
  | "connected" | "disconnected" | "reconnecting"
  | "reconnected" | "reconnect_failed" | "token_refreshed"
  | "token_expired" | "transport_fallback" | "error";

type VRCSLEvent = PipelineEvent | LifecycleEvent | "*";
```

---

## Compatibility

| Environment | HTTP | WebSocket | SSE | UMD Global |
|-------------|------|-----------|-----|------------|
| Chrome / Edge (last 2 versions) | Native fetch | Native WebSocket | Native EventSource | Yes |
| Firefox (last 2 versions) | Native fetch | Native WebSocket | Native EventSource | Yes |
| Safari (last 2 versions) | Native fetch | Native WebSocket | Native EventSource | Yes |
| Node.js 18+ | Native fetch | `ws` package | Fetch stream parser | N/A |
| Node.js 22+ | Native fetch | Native WebSocket | Fetch stream parser | N/A |
| Bun 1.0+ | Native fetch | Native WebSocket | Fetch stream parser | N/A |

The `ws` package is conditionally imported only in Node.js environments where native `WebSocket` is not available (Node.js < 22). Browsers and Bun use native WebSocket with zero additional dependencies.

---

## License

This project is licensed under the terms specified in the [LICENSE](https://github.com/TheArmagan/VRCSecureLogin/blob/main/LICENSE) file.
