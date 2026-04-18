# vrcsl.js — Client SDK Project Design Record

> **Package**: `vrcsl.js`  
> **Version**: 1.0  
> **Status**: Draft  
> **Date**: 2026-04-18  
> **Parent**: [VRCSECURELOGIN_V1_PDR.md](VRCSECURELOGIN_V1_PDR.md)

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Technology Stack](#2-technology-stack)
3. [Package Distribution](#3-package-distribution)
4. [Architecture Overview](#4-architecture-overview)
5. [Transport Layer](#5-transport-layer)
6. [Class API Design](#6-class-api-design)
7. [Registration & Token Management](#7-registration--token-management)
8. [API Proxy Methods](#8-api-proxy-methods)
9. [Event System](#9-event-system)
10. [DeepLink Helpers](#10-deeplink-helpers)
11. [Scope Constants](#11-scope-constants)
12. [Error Handling](#12-error-handling)
13. [Logging](#13-logging)
14. [Token Storage Adapters](#14-token-storage-adapters)
15. [Browser Global (`window.VRCSL`)](#15-browser-global-windowvrcsl)
16. [TypeScript Types](#16-typescript-types)
17. [Project Structure](#17-project-structure)
18. [Testing](#18-testing)
19. [Compatibility Matrix](#19-compatibility-matrix)

---

## 1. Purpose

`vrcsl.js` is the official client SDK for VRCSecureLogin (VRCSL). It provides a single, unified `VRCSLClient` class that communicates with the VRCSL local API server (`127.0.0.1:7642`) from any JavaScript runtime — browsers, Node.js 18+, and Bun 1.0+.

### Goals

1. **Single class interface** — One `VRCSLClient` class covers HTTP, WebSocket, and SSE transports.
2. **Universal runtime** — Works in browsers (last 2 versions), Node.js 18+, and Bun 1.0+ with zero configuration.
3. **Auto transport selection** — Attempts WebSocket first, falls back to HTTP transparently.
4. **Full API coverage** — Registration, token refresh, API proxy, batch API, pipeline events (WS + SSE), and deeplink URL generation.
5. **Minimal dependencies** — Only `ws` for Node.js/Bun WebSocket support. Zero dependencies in browser builds.
6. **`window.VRCSL` global** — UMD build exposes a namespace for `<script>` tag usage.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| Language | TypeScript (strict) |
| Runtime | Bun (development & scripts) |
| Build Tool | tsup |
| Module Formats | ESM, CJS, UMD (IIFE with `VRCSL` global) |
| HTTP Client | `fetch` (native — browser, Node 18+, Bun) |
| WebSocket (Node/Bun) | `ws` package (conditionally imported) |
| WebSocket (Browser) | Native `WebSocket` API |
| SSE (Browser) | Native `EventSource` API |
| SSE (Node/Bun) | Minimal custom parser over `fetch` readable stream |
| Test Framework | Bun's built-in test runner (`bun test`) |
| Type Declarations | Auto-generated `.d.ts` via tsup/tsc |

---

## 3. Package Distribution

### 3.1 npm Package

```
vrcsl.js/
├── dist/
│   ├── index.mjs          # ESM build
│   ├── index.cjs           # CJS build (CommonJS)
│   ├── index.global.js     # UMD/IIFE build (window.VRCSL)
│   ├── index.d.ts          # TypeScript declarations
│   └── index.d.cts         # CTS declarations for CJS
├── package.json
├── README.md
└── LICENSE
```

### 3.2 package.json Exports

```json
{
  "name": "vrcsl.js",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.mjs"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  },
  "browser": "./dist/index.mjs",
  "unpkg": "./dist/index.global.js",
  "jsdelivr": "./dist/index.global.js",
  "files": ["dist"],
  "dependencies": {
    "ws": "^8.0.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "@types/ws": "^8.0.0"
  }
}
```

### 3.3 CDN Usage

Available automatically via npm publish:

```html
<!-- unpkg -->
<script src="https://unpkg.com/vrcsl.js/dist/index.global.js"></script>

<!-- jsdelivr -->
<script src="https://cdn.jsdelivr.net/npm/vrcsl.js/dist/index.global.js"></script>

<script>
  const client = new VRCSL.Client({ appName: "My App" });
</script>
```

### 3.4 tsup Configuration

```typescript
import { defineConfig } from "tsup";

export default defineConfig([
  // ESM + CJS builds
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    splitting: false,
    clean: true,
    target: "es2020",
    external: ["ws"],
    platform: "neutral",
  },
  // UMD/IIFE build for browsers
  {
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "VRCSL",
    outExtension: () => ({ js: ".global.js" }),
    platform: "browser",
    target: "es2020",
    noExternal: [/.*/],
    minify: true,
  },
]);
```

---

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      vrcsl.js SDK                        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                  VRCSLClient                       │  │
│  │                                                    │  │
│  │  register() / api() / batch() / accounts()         │  │
│  │  subscribe() / unsubscribe() / on() / off()        │  │
│  │  connect() / disconnect() / refresh()              │  │
│  └──────────┬───────────────┬────────────────────────┘  │
│             │               │                            │
│    ┌────────▼────────┐  ┌──▼──────────────────────────┐ │
│    │  HTTPTransport   │  │  WSTransport                │ │
│    │  (fetch-based)   │  │  (WebSocket + requestId)    │ │
│    └────────┬────────┘  └──┬──────────────────────────┘ │
│             │               │                            │
│    ┌────────▼────────┐  ┌──▼──────────────────────────┐ │
│    │  SSETransport   │  │  (events via WS subscribe)  │ │
│    │  (/events SSE)  │  │                              │ │
│    └─────────────────┘  └─────────────────────────────┘ │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ TokenStore    │  │ Scopes       │  │ DeepLink     │  │
│  │ (adapter)     │  │ (constants)  │  │ (helpers)    │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────┘
           │
           │  127.0.0.1:7642
           ▼
┌──────────────────────────────────────────────────────────┐
│                    VRCSL (Electron)                       │
│              HTTP :7642  /  WS :7642/ws                  │
│              SSE  :7642/events                           │
└──────────────────────────────────────────────────────────┘
```

### Internal Modules

| Module | Responsibility |
|---|---|
| `VRCSLClient` | Public API surface. Delegates to active transport. Manages token lifecycle. |
| `HTTPTransport` | Sends requests via `fetch` to HTTP endpoints. |
| `WSTransport` | Manages WebSocket connection, `requestId` correlation, auth handshake, event subscriptions. |
| `SSETransport` | Connects to `GET /events` via `EventSource` (browser) or fetch stream (Node/Bun). Used as a fallback event source when WS is unavailable. |
| `TokenStore` | Adapter-based token persistence. Default: `localStorage` (browser), in-memory (Node/Bun). |
| `Scopes` | Exported scope constant enum for type-safe scope requests. |
| `DeepLink` | Static utility for generating `vrcsl://` URLs. |
| `VRCSLError` | Custom error class with `code`, `message`, `status` fields. |

---

## 5. Transport Layer

### 5.1 Transport Selection Strategy

**Default behavior: WS-first with HTTP fallback.**

1. On `client.connect()` (or first API call if not explicitly connected), the SDK attempts to open a WebSocket to `ws://127.0.0.1:7642/ws`.
2. If the WebSocket connection succeeds within the connection timeout (default: 3 seconds), **all subsequent API calls and event subscriptions go through WebSocket**.
3. If the WebSocket connection fails (VRCSL not running, port blocked, etc.), the SDK **falls back to HTTP** for API calls and **SSE** for event subscriptions.
4. If HTTP also fails, the SDK emits an `error` event and rejects pending API calls with a `VRCSLError`.

### 5.2 Override

Users can force a specific transport:

```typescript
const client = new VRCSLClient({
  appName: "My App",
  transport: "http",  // force HTTP-only (no WS)
});

const client = new VRCSLClient({
  appName: "My App",
  transport: "ws",    // force WS-only (no fallback)
});
```

Default: `"auto"` (WS-first, HTTP fallback).

### 5.3 HTTPTransport

All HTTP requests go to `http://127.0.0.1:{port}` using the native `fetch` API.

- `POST /register` — App registration
- `POST /refresh` — Token refresh
- `GET /accounts` — List accounts
- `POST /api` — Single API proxy
- `POST /api/batch` — Batch API proxy
- `GET /events` — SSE event stream (delegated to SSETransport)

The `Authorization: Bearer <token>` header is automatically injected by the client for authenticated requests.

### 5.4 WSTransport

Maintains a persistent WebSocket connection to `ws://127.0.0.1:{port}/ws`.

**Request/response correlation**: Each outgoing message includes a unique `requestId` (UUID v4 or incrementing counter). The transport maintains a pending requests map (`Map<string, { resolve, reject, timeout }>`) and resolves/rejects promises when the matching `requestId` response arrives.

**Connection lifecycle**:
1. `connect()` — Opens WebSocket, sends `auth` message with stored token (if available).
2. API calls — Serialized as WS messages with `requestId`.
3. Events — Delivered as `event` type messages, routed to the event emitter.
4. `disconnect()` — Closes WebSocket cleanly.

**Auto-reconnect**: On unexpected disconnect, the SDK retries at a fixed interval (default: 5 seconds, configurable). Maximum retry attempts configurable (default: 10, `0` for infinite). On successful reconnect, the SDK re-authenticates and re-subscribes to previously active event subscriptions.

**Ping/pong keep-alive**: The SDK sends `ping` messages every 30 seconds. If no `pong` is received within 10 seconds, the connection is considered dead and reconnection is triggered.

### 5.5 SSETransport

Used for event streaming when WebSocket is unavailable (HTTP transport mode).

- **Browser**: Uses native `EventSource` API with `Authorization` header via polyfill pattern (EventSource doesn't support custom headers natively). Falls back to fetch-based SSE stream parsing.
- **Node.js / Bun**: Uses `fetch` with `Accept: text/event-stream`, reads the response body as a readable stream, and parses SSE frames manually.

SSE is only used for event subscriptions. API calls always go through HTTP when in HTTP mode.

**Reconnect**: On disconnect, SSE reconnects at the interval suggested by the server's `retry` field (default: 3 seconds). Configurable via `reconnectInterval`.

---

## 6. Class API Design

### 6.1 Constructor

```typescript
const client = new VRCSLClient(options: VRCSLClientOptions);
```

```typescript
interface VRCSLClientOptions {
  /** Display name shown in VRCSL consent dialog. Required for registration. */
  appName: string;

  /** Description shown in VRCSL consent dialog. */
  appDescription?: string;

  /** VRCSL API port. Default: 7642 */
  port?: number;

  /** VRCSL API host. Default: "127.0.0.1" */
  host?: string;

  /** Transport mode. Default: "auto" */
  transport?: "auto" | "http" | "ws";

  /** Scopes to request during registration. */
  scopes?: string[];

  /** Pre-existing access token (skip registration). */
  token?: string;

  /** Pre-existing refresh token. */
  refreshToken?: string;

  /** Token storage adapter. Default: localStorage (browser) / memory (Node). */
  tokenStore?: TokenStore | false;

  /** WS/SSE reconnect interval in ms. Default: 5000 */
  reconnectInterval?: number;

  /** Max reconnect attempts. Default: 10. 0 = infinite. */
  maxReconnectAttempts?: number;

  /** Connection timeout in ms. Default: 3000 */
  connectionTimeout?: number;

  /** Request timeout in ms (per API call). Default: 15000 */
  requestTimeout?: number;

  /** Log level. Default: "silent" */
  logLevel?: "debug" | "info" | "warn" | "error" | "silent";

  /** Custom logger implementation. */
  logger?: Logger;
}
```

### 6.2 Connection Lifecycle

```typescript
/** Connect to VRCSL. Establishes WS or verifies HTTP connectivity. */
client.connect(): Promise<void>

/** Disconnect. Closes WS, SSE, clears pending requests. */
client.disconnect(): Promise<void>

/** Current connection state. */
client.state: "disconnected" | "connecting" | "connected" | "reconnecting"

/** Whether the client has a valid (non-expired) access token. */
client.isAuthenticated: boolean

/** The currently active transport type. */
client.activeTransport: "ws" | "http" | null
```

### 6.3 Registration

```typescript
/**
 * Register this app with VRCSL. Triggers the consent dialog on the user's machine.
 * Resolves when the user approves. Rejects with VRCSLError (consent_denied) if denied.
 * Stores tokens automatically via the configured TokenStore.
 *
 * If `scopes` not provided here, uses `options.scopes` from constructor.
 */
client.register(options?: {
  scopes?: string[];
  origin?: string;        // for web apps, auto-detected from window.location if omitted
}): Promise<RegisterResult>
```

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

### 6.4 Token Refresh

```typescript
/**
 * Manually refresh the access token. Normally called automatically.
 * Returns new token pair. Updates internal state and TokenStore.
 */
client.refresh(): Promise<RefreshResult>
```

```typescript
interface RefreshResult {
  token: string;
  refreshToken: string;
  expiresIn: number;
}
```

**Auto-refresh behavior**: When an API call receives a `401 invalid_token` response, the SDK:
1. Calls `POST /refresh` (HTTP) or sends a `refresh` WS message using the stored refresh token.
2. On success, stores the new tokens and **retries the original request** with the new access token.
3. On failure (refresh token also expired/invalid), emits a `token_expired` event and rejects the original request with `VRCSLError`.
4. A refresh lock prevents concurrent refresh attempts — subsequent 401s during an active refresh wait for the first refresh to complete.

### 6.5 Accounts

```typescript
/** List VRChat accounts this token has access to. */
client.getAccounts(): Promise<AccountInfo[]>
```

### 6.6 API Proxy

```typescript
/**
 * Proxy a single VRChat API request through VRCSL.
 *
 * @param userId - VRChat user ID of the account to use
 * @param method - HTTP method
 * @param path - VRChat API path (e.g., "/avatars/avtr_xxx")
 * @param body - Optional request body (for POST/PUT)
 */
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

### 6.7 Batch API Proxy

```typescript
/**
 * Proxy multiple VRChat API requests in a single call.
 */
client.batch(
  requests: BatchRequest[]
): Promise<BatchResponse[]>
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

### 6.8 Event Subscription

```typescript
/**
 * Subscribe to VRCSL pipeline events.
 * Uses WS subscribe (if WS active) or SSE /events (if HTTP mode).
 *
 * @param accountIds - VRChat user IDs to receive events for
 * @param events - Optional event type filter. Omit for all permitted events.
 */
client.subscribe(
  accountIds: string[],
  events?: string[]
): Promise<SubscribeResult>

/**
 * Unsubscribe from all pipeline events.
 */
client.unsubscribe(): Promise<void>
```

```typescript
interface SubscribeResult {
  subscribedAccounts: string[];
  subscribedEvents: string[];
}
```

### 6.9 Event Emitter

```typescript
/** Listen to a pipeline event or SDK lifecycle event. */
client.on(event: string, listener: (data: EventPayload) => void): void

/** Remove a listener. */
client.off(event: string, listener: (data: EventPayload) => void): void

/** Listen to an event once. */
client.once(event: string, listener: (data: EventPayload) => void): void
```

```typescript
interface EventPayload {
  userId: string;
  eventType: string;
  source: "vrchat" | "vrcsl";
  timestamp: string;
  data: unknown;
}
```

**SDK Lifecycle Events** (emitted by the client itself, not from VRCSL pipeline):

| Event | Payload | Description |
|---|---|---|
| `connected` | `{}` | WS/HTTP connection established |
| `disconnected` | `{ reason: string }` | Connection lost |
| `reconnecting` | `{ attempt: number }` | Reconnect attempt starting |
| `reconnected` | `{}` | Successfully reconnected |
| `reconnect_failed` | `{ attempts: number }` | All reconnect attempts exhausted |
| `token_refreshed` | `{ expiresIn: number }` | Access token was auto-refreshed |
| `token_expired` | `{}` | Both access and refresh tokens expired |
| `transport_fallback` | `{ from: string, to: string }` | Transport changed (e.g., WS → HTTP) |
| `error` | `VRCSLError` | Non-fatal error (logged, not thrown) |

**Pipeline Events** (forwarded from VRCSL):

All pipeline events from the parent PDR Section 11 are forwarded as-is via the event emitter. The event name matches the `eventType` field:

```typescript
client.on("friend-online", (event) => {
  console.log(event.data.user.displayName, "came online");
});

client.on("session-expired", (event) => {
  console.log("Account", event.userId, "session expired");
});
```

---

## 7. Registration & Token Management

### 7.1 Full Registration Flow

```typescript
const client = new VRCSLClient({
  appName: "My VRChat Tool",
  appDescription: "Manages avatars",
  scopes: [Scopes.AVATARS_ALL, Scopes.USERS_GET],
});

// Connect (attempts WS, falls back to HTTP)
await client.connect();

// Register (triggers consent dialog on user's machine)
const result = await client.register();

// result.token, result.refreshToken are automatically stored
// All subsequent API calls use the stored token
const accounts = await client.getAccounts();
```

### 7.2 Resuming with Stored Tokens

```typescript
const client = new VRCSLClient({
  appName: "My VRChat Tool",
});

await client.connect();

// If TokenStore has valid tokens, client.isAuthenticated === true
if (client.isAuthenticated) {
  const accounts = await client.getAccounts();
} else {
  await client.register({ scopes: [Scopes.AVATARS_ALL] });
}
```

### 7.3 Pre-supplied Tokens

```typescript
const client = new VRCSLClient({
  appName: "My VRChat Tool",
  token: "vrcsl_at_...",
  refreshToken: "vrcsl_rt_...",
});

await client.connect();
// Ready to use immediately
```

### 7.4 Auto-Refresh Sequence

```
Client                             SDK                              VRCSL
  │                                  │                                │
  │  client.api("usr_x", "GET", …)  │                                │
  │─────────────────────────────────►│                                │
  │                                  │  Request with expired token    │
  │                                  │───────────────────────────────►│
  │                                  │                                │
  │                                  │  401 invalid_token             │
  │                                  │◄───────────────────────────────│
  │                                  │                                │
  │                                  │  POST /refresh                 │
  │                                  │───────────────────────────────►│
  │                                  │                                │
  │                                  │  200 {token, refreshToken}     │
  │                                  │◄───────────────────────────────│
  │                                  │                                │
  │                                  │  Retry original request        │
  │                                  │───────────────────────────────►│
  │                                  │                                │
  │                                  │  200 {data}                    │
  │                                  │◄───────────────────────────────│
  │                                  │                                │
  │  Promise resolves with data      │                                │
  │◄─────────────────────────────────│                                │
```

---

## 8. API Proxy Methods

### 8.1 Single Request

```typescript
// GET a user's avatar
const result = await client.api("usr_xxx", "GET", "/avatars/avtr_yyy");
console.log(result.data);

// Switch avatar
await client.api("usr_xxx", "PUT", "/users/usr_xxx/avatar", {
  avatarId: "avtr_yyy",
});

// Search users
const search = await client.api("usr_xxx", "GET", "/users?search=keyword&n=10");
```

### 8.2 Batch Request

```typescript
const results = await client.batch([
  { requestId: "1", userId: "usr_xxx", method: "GET", path: "/users/usr_yyy" },
  { requestId: "2", userId: "usr_xxx", method: "GET", path: "/worlds/wrld_zzz" },
]);

for (const res of results) {
  console.log(res.requestId, res.status, res.data);
}
```

### 8.3 Transport Behavior

| Transport | Single API | Batch API |
|---|---|---|
| **HTTP** | `POST /api` | `POST /api/batch` |
| **WS** | `api_request` message with `requestId` | Multiple `api_request` messages sent in sequence, correlated by `requestId` |

> **Note**: When using WS transport, `batch()` sends individual `api_request` messages (one per batch item) rather than a dedicated batch message type, since the WS protocol in the parent PDR does not define a batch message. Each request gets its own `requestId` and is resolved independently. The SDK collects all responses before resolving the `batch()` promise.

---

## 9. Event System

### 9.1 Subscribing

```typescript
await client.connect();

// Subscribe to friend events for one account
await client.subscribe(["usr_xxx"], ["friend-online", "friend-offline"]);

client.on("friend-online", (event) => {
  console.log(`${event.data.user.displayName} came online`);
});

client.on("friend-offline", (event) => {
  console.log(`${event.data.user.displayName} went offline`);
});
```

### 9.2 All Events (No Filter)

```typescript
// Subscribe to all events the token's scopes permit
await client.subscribe(["usr_xxx"]);

// Catch-all listener
client.on("*", (event) => {
  console.log(event.eventType, event.data);
});
```

### 9.3 Transport-Specific Behavior

| Transport | Mechanism |
|---|---|
| **WS** | Sends `subscribe` message. Events arrive as `event` type messages. |
| **HTTP** | Opens SSE connection to `GET /events?accountIds=...&events=...`. Events arrive as SSE frames. |

### 9.4 Re-subscription on Reconnect

When the SDK reconnects (WS reconnect or SSE reconnect), it automatically re-sends the last `subscribe` request to restore event delivery. The `reconnected` lifecycle event is emitted after re-subscription succeeds.

---

## 10. DeepLink Helpers

Static utilities for generating `vrcsl://` deeplink URLs. These do not require an authenticated client instance.

```typescript
import { DeepLink } from "vrcsl.js";
// or via global: VRCSL.DeepLink

/** Generate a switch-avatar deeplink. */
DeepLink.switchAvatar(avatarId: string, accountIdx?: number): string

/** Generate a join-world deeplink. */
DeepLink.joinWorld(worldId: string, instanceId?: string, accountIdx?: number): string

/** Generate an add-friend deeplink. */
DeepLink.addFriend(userId: string, accountIdx?: number): string

/** Generate an open-VRCSL deeplink. */
DeepLink.open(): string
```

### Examples

```typescript
DeepLink.switchAvatar("avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
// → "vrcsl://switchavatar?avatarId=avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

DeepLink.switchAvatar("avtr_xxx", 0);
// → "vrcsl://switchavatar?avatarId=avtr_xxx&accountIdx=0"

DeepLink.joinWorld("wrld_xxx", "12345~private(usr_xxx)");
// → "vrcsl://joinworld?worldId=wrld_xxx&instanceId=12345~private(usr_xxx)"

DeepLink.addFriend("usr_yyy");
// → "vrcsl://addfriend?userId=usr_yyy"

DeepLink.open();
// → "vrcsl://open"
```

---

## 11. Scope Constants

Exported as `Scopes` object with type-safe constants matching the parent PDR Section 8.

```typescript
import { Scopes } from "vrcsl.js";
// or via global: VRCSL.Scopes
```

```typescript
const Scopes = {
  // Users
  USERS_ALL:       "vrchat.users.*",
  USERS_GET:       "vrchat.users.get",
  USERS_SEARCH:    "vrchat.users.search",

  // Friends
  FRIENDS_ALL:     "vrchat.friends.*",
  FRIENDS_LIST:    "vrchat.friends.list",
  FRIENDS_STATUS:  "vrchat.friends.status",

  // Avatars
  AVATARS_ALL:     "vrchat.avatars.*",
  AVATARS_GET:     "vrchat.avatars.get",
  AVATARS_SELECT:  "vrchat.avatars.select",
  AVATARS_LIST:    "vrchat.avatars.list",

  // Worlds
  WORLDS_ALL:      "vrchat.worlds.*",
  WORLDS_GET:      "vrchat.worlds.get",
  WORLDS_LIST:     "vrchat.worlds.list",

  // Instances
  INSTANCES_ALL:    "vrchat.instances.*",
  INSTANCES_GET:    "vrchat.instances.get",
  INSTANCES_CREATE: "vrchat.instances.create",

  // Invites
  INVITES_ALL:     "vrchat.invites.*",
  INVITES_SEND:    "vrchat.invites.send",
  INVITES_LIST:    "vrchat.invites.list",

  // Favorites
  FAVORITES_ALL:   "vrchat.favorites.*",

  // Groups
  GROUPS_ALL:      "vrchat.groups.*",

  // Notifications
  NOTIFICATIONS_ALL: "vrchat.notifications.*",

  // Player Moderation
  PLAYERMOD_ALL:   "vrchat.playermod.*",

  // Files
  FILES_ALL:       "vrchat.files.*",

  // Pipeline (events)
  PIPELINE_ALL:          "vrchat.pipeline.*",
  PIPELINE_FRIEND_ONLINE:  "vrchat.pipeline.friend-online",
  PIPELINE_FRIEND_OFFLINE: "vrchat.pipeline.friend-offline",
  PIPELINE_FRIEND_ADD:     "vrchat.pipeline.friend-add",
  PIPELINE_FRIEND_DELETE:  "vrchat.pipeline.friend-delete",
  PIPELINE_FRIEND_UPDATE:  "vrchat.pipeline.friend-update",
  PIPELINE_FRIEND_LOCATION:"vrchat.pipeline.friend-location",
  PIPELINE_USER_UPDATE:    "vrchat.pipeline.user-update",
  PIPELINE_USER_LOCATION:  "vrchat.pipeline.user-location",
  PIPELINE_NOTIFICATION:   "vrchat.pipeline.notification",
  PIPELINE_CONTENT_REFRESH:"vrchat.pipeline.content-refresh",

  // VRCSL internal events
  VRCSL_EVENTS_ALL:    "vrcsl.events.*",
  VRCSL_EVENTS_SESSION:"vrcsl.events.session",
  VRCSL_EVENTS_ACCOUNT:"vrcsl.events.account",
  VRCSL_EVENTS_TOKEN:  "vrcsl.events.token",

  // Full access
  VRCHAT_ALL:      "vrchat.*",
} as const;
```

---

## 12. Error Handling

### 12.1 VRCSLError Class

All SDK errors are instances of `VRCSLError`, extending the native `Error` class.

```typescript
class VRCSLError extends Error {
  /** Machine-readable error code from VRCSL API. */
  code: string;

  /** Human-readable error message. */
  message: string;

  /** HTTP status code (if applicable). null for transport/SDK errors. */
  status: number | null;

  constructor(code: string, message: string, status?: number);
}
```

### 12.2 Error Codes

All error codes from the parent PDR, plus SDK-specific codes:

| Code | Status | Source | Description |
|---|---|---|---|
| `invalid_token` | 401 | VRCSL | Token is invalid or expired |
| `consent_denied` | 403 | VRCSL | User denied registration |
| `scope_denied` | 403 | VRCSL | Token lacks required scope |
| `account_denied` | 403 | VRCSL | Token lacks access to requested account |
| `rate_limited` | 429 | VRCSL | Rate limit exceeded |
| `invalid_request` | 400 | VRCSL | Malformed request body |
| `internal_error` | 500 | VRCSL | VRCSL internal error |
| `vrchat_error` | 502 | VRCSL | VRChat API returned an error |
| `connection_failed` | null | SDK | Cannot connect to VRCSL |
| `connection_timeout` | null | SDK | Connection attempt timed out |
| `request_timeout` | null | SDK | API request timed out |
| `not_connected` | null | SDK | API called before connecting |
| `not_authenticated` | null | SDK | API called without a token |
| `refresh_failed` | null | SDK | Token refresh failed (both tokens invalid) |
| `ws_closed` | null | SDK | WebSocket closed unexpectedly |
| `sse_error` | null | SDK | SSE connection error |

### 12.3 Usage

```typescript
import { VRCSLError } from "vrcsl.js";

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

## 13. Logging

### 13.1 Log Levels

| Level | Logs |
|---|---|
| `debug` | All transport messages, request/response bodies, token operations |
| `info` | Connection state changes, registration, refresh, subscribe/unsubscribe |
| `warn` | Reconnect attempts, transport fallback, rate limit warnings |
| `error` | Connection failures, request failures, refresh failures |
| `silent` | Nothing (default) |

### 13.2 Default Logger

The SDK ships a simple console logger. By default, `logLevel` is `"silent"` (no output).

```typescript
const client = new VRCSLClient({
  appName: "My App",
  logLevel: "debug", // Enable debug logging
});
```

### 13.3 Custom Logger

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

## 14. Token Storage Adapters

### 14.1 Interface

```typescript
interface TokenStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}
```

The SDK stores two keys:
- `vrcsl_token` — Access token
- `vrcsl_refresh_token` — Refresh token

### 14.2 Built-in Adapters

**LocalStorageStore** (default in browsers):

```typescript
class LocalStorageStore implements TokenStore {
  get(key: string): string | null {
    return localStorage.getItem(key);
  }
  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  }
  remove(key: string): void {
    localStorage.removeItem(key);
  }
}
```

**JsonFileStore** (default in Node.js/Bun):

Persists tokens to a JSON file on disk. The default path is `vrcsl-tokens.json` in the current working directory, configurable via the `path` constructor option.

```typescript
class JsonFileStore implements TokenStore {
  private filePath: string;

  /**
   * @param path - Absolute or relative path to the JSON file.
   *               Default: "./vrcsl-tokens.json"
   */
  constructor(path?: string);

  async get(key: string): Promise<string | null> {
    // Reads the JSON file, parses it, returns the value for the key.
    // Returns null if the file does not exist or the key is missing.
  }

  async set(key: string, value: string): Promise<void> {
    // Reads existing JSON (or starts with {}), sets the key, writes back atomically.
    // Uses write-to-temp + rename for atomic writes to prevent corruption.
  }

  async remove(key: string): Promise<void> {
    // Reads existing JSON, deletes the key, writes back atomically.
    // If the file becomes empty ({}), it is deleted.
  }
}
```

**File format** (`vrcsl-tokens.json`):
```json
{
  "vrcsl_token": "vrcsl_at_...",
  "vrcsl_refresh_token": "vrcsl_rt_..."
}
```

**Atomic writes**: All writes use a write-to-temp-file + `rename()` pattern to prevent data corruption from crashes or concurrent access. The temp file is written to `{path}.tmp` before being renamed to the target path.

**File permissions** (Linux): Created with mode `0o600` (owner read/write only) to prevent other users from reading tokens.

> **Note**: The JSON file contains plaintext tokens. This is acceptable because VRCSL tokens are short-lived (1h access, 30d refresh) and bound to `127.0.0.1`. For higher security requirements, users should provide a custom `TokenStore` adapter backed by an encrypted store or OS keychain.

**MemoryStore** (fallback, non-persistent):

```typescript
class MemoryStore implements TokenStore {
  private store = new Map<string, string>();
  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.store.set(key, value);
  }
  remove(key: string): void {
    this.store.delete(key);
  }
}
```

### 14.3 Default Adapter Selection

| Environment | Default TokenStore | Persistence |
|---|---|---|
| Browser | `LocalStorageStore` | Persistent (survives page reload) |
| Node.js / Bun | `JsonFileStore` | Persistent (JSON file on disk) |
| `tokenStore: false` | Internal `MemoryStore` | None (session only) |
| `tokenStore: new MemoryStore()` | `MemoryStore` | None (explicit opt-in) |

### 14.5 Custom Adapter

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

### 14.6 Custom JsonFileStore Path

```typescript
import { JsonFileStore } from "vrcsl.js";

const client = new VRCSLClient({
  appName: "My App",
  tokenStore: new JsonFileStore("/home/myapp/.config/vrcsl-tokens.json"),
});
```

### 14.7 Disabling Persistence

```typescript
const client = new VRCSLClient({
  appName: "My App",
  tokenStore: false, // Tokens only kept in memory for session lifetime
});
```

When `tokenStore` is `false`, the SDK uses an internal `MemoryStore` that is not exposed.

---

## 15. Browser Global (`window.VRCSL`)

When loaded via `<script>` tag (UMD build), the SDK exposes `window.VRCSL` as a namespace:

```typescript
window.VRCSL = {
  /** The VRCSLClient class. */
  Client: typeof VRCSLClient,

  /** Scope constants. */
  Scopes: typeof Scopes,

  /** DeepLink URL generators. */
  DeepLink: typeof DeepLink,

  /** Error class. */
  VRCSLError: typeof VRCSLError,

  /** Package version string. */
  version: string,
};
```

### Usage

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

## 16. TypeScript Types

All public types are exported from the package entry point and auto-generated via tsup/tsc.

### Exported Types

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

// Events (string literal union for type-safe .on())
export type { VRCSLEvent, PipelineEvent, LifecycleEvent } from "./events";
```

### Type-Safe Events

```typescript
/** All VRChat pipeline event types. */
type PipelineEvent =
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
type LifecycleEvent =
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
type VRCSLEvent = PipelineEvent | LifecycleEvent | "*";
```

---

## 17. Project Structure

```
vrcsl.js/
├── src/
│   ├── index.ts               # Package entry — re-exports all public API
│   ├── client.ts              # VRCSLClient class
│   ├── types.ts               # Shared TypeScript interfaces
│   ├── error.ts               # VRCSLError class
│   ├── scopes.ts              # Scopes constants object
│   ├── deeplink.ts            # DeepLink static helpers
│   ├── logger.ts              # Logger interface + default console logger
│   ├── events.ts              # Event type definitions + emitter mixin
│   ├── token-store.ts         # TokenStore interface + built-in adapters
│   └── transport/
│       ├── types.ts           # Transport interface definition
│       ├── http.ts            # HTTPTransport (fetch-based)
│       ├── ws.ts              # WSTransport (WebSocket + requestId correlation)
│       └── sse.ts             # SSETransport (EventSource / fetch stream)
├── tests/
│   ├── client.test.ts         # VRCSLClient unit tests
│   ├── http.test.ts           # HTTPTransport tests
│   ├── ws.test.ts             # WSTransport tests
│   ├── sse.test.ts            # SSETransport tests
│   ├── token-store.test.ts    # Token storage adapter tests
│   ├── deeplink.test.ts       # DeepLink URL generation tests
│   ├── scopes.test.ts         # Scope constant tests
│   └── error.test.ts          # VRCSLError tests
├── tsconfig.json
├── tsup.config.ts
├── package.json
├── README.md
├── LICENSE
└── .gitignore
```

---

## 18. Testing

### 18.1 Framework

Bun's built-in test runner (`bun test`). No additional test dependencies.

### 18.2 Strategy

| Test Category | Approach |
|---|---|
| **Unit tests** | Test each module in isolation. Mock `fetch`, `WebSocket`, and `EventSource`. |
| **Transport tests** | Mock server responses. Verify correct message format, `requestId` correlation, auth handshake. |
| **Token refresh tests** | Simulate 401 → refresh → retry flow. Verify request is only retried once. |
| **Reconnect tests** | Simulate WS close → reconnect → re-subscribe flow. |
| **Error tests** | Verify all VRCSL error codes map to `VRCSLError` correctly. |
| **DeepLink tests** | Verify URL generation for all deeplink types. |
| **Token store tests** | Verify get/set/remove for all adapters. |

### 18.3 Mocking

Since the SDK communicates with a local server, tests mock at the transport boundary:

- **fetch**: Replace global `fetch` with a mock that returns controlled responses.
- **WebSocket**: Provide a mock `WebSocket` class that simulates server messages.
- **EventSource**: Provide a mock `EventSource` class for SSE tests.

---

## 19. Compatibility Matrix

| Environment | HTTP | WebSocket | SSE | `window.VRCSL` |
|---|---|---|---|---|
| Chrome / Edge (last 2) | ✅ native fetch | ✅ native WS | ✅ native EventSource | ✅ UMD |
| Firefox (last 2) | ✅ native fetch | ✅ native WS | ✅ native EventSource | ✅ UMD |
| Safari (last 2) | ✅ native fetch | ✅ native WS | ✅ native EventSource | ✅ UMD |
| Node.js 18+ | ✅ native fetch | ✅ `ws` package | ✅ fetch stream parser | ❌ N/A |
| Node.js 22+ | ✅ native fetch | ✅ `ws` or native WS | ✅ fetch stream parser | ❌ N/A |
| Bun 1.0+ | ✅ native fetch | ✅ native WS | ✅ fetch stream parser | ❌ N/A |

### WebSocket Import Strategy (Node.js)

The `ws` package is conditionally imported only in Node.js environments where native `WebSocket` is not available:

```typescript
function getWebSocket(): typeof WebSocket {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket;
  }
  // Node.js < 22 — use ws package
  try {
    return require("ws");
  } catch {
    throw new VRCSLError(
      "connection_failed",
      "WebSocket not available. Install the 'ws' package: npm install ws"
    );
  }
}
```

This allows:
- Browsers: zero dependencies, native `WebSocket`.
- Bun: zero dependencies, native `WebSocket`.
- Node.js 22+: zero dependencies, native `WebSocket`.
- Node.js 18–21: `ws` as the only runtime dependency.

---

*End of vrcsl.js PDR v1*
