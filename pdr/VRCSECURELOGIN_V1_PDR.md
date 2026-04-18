# VRCSecureLogin — Project Design Record (v1)

> **Codename**: VRCSL  
> **Version**: 1.0  
> **Status**: Draft  
> **Date**: 2026-04-18  
> **Platforms**: Windows, Linux

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Project Purpose & Goals](#2-project-purpose--goals)
3. [Architecture Overview](#3-architecture-overview)
4. [Technology Stack](#4-technology-stack)
5. [Security Model](#5-security-model)
6. [Account Management](#6-account-management)
7. [Third-Party App Registration Flow](#7-third-party-app-registration-flow)
8. [Scope System](#8-scope-system)
9. [Token Management](#9-token-management)
10. [API Design](#10-api-design)
11. [Pipeline & Event System](#11-pipeline--event-system)
12. [Data Storage](#12-data-storage)
13. [UI/UX Design](#13-uiux-design)
14. [Update Mechanism](#14-update-mechanism)
15. [Audit Logging](#15-audit-logging)
16. [Threat Model](#16-threat-model)
17. [Project Structure](#17-project-structure)

---

## 1. Problem Statement

VRChat does not provide a standard OAuth 2.0 system. Every third-party application or website that needs VRChat authentication must emulate VRChat's proprietary login flow, requiring users to hand over raw credentials (username, password, 2FA codes) directly to each service. This creates severe security risks:

- **Credential exposure**: Users share plaintext credentials with every third-party app.
- **No scoped access**: Third-party apps receive full account access with no way to limit permissions.
- **No revocation**: Users cannot revoke a single app's access without changing their password.
- **Session management burden**: Each app must independently maintain VRChat sessions, leading to frequent re-authentication prompts.

---

## 2. Project Purpose & Goals

VRCSecureLogin (VRCSL) is a local desktop application that acts as a **secure credential vault and API proxy** for VRChat accounts. It provides an OAuth-like consent layer for third-party apps without requiring VRChat to implement one.

### Core Goals

1. **Secure credential storage** — Store VRChat credentials using OS-level keychain (DPAPI on Windows, libsecret on Linux) so credentials never exist in plaintext on disk.
2. **Multi-account support** — Users can register and manage multiple VRChat accounts simultaneously.
3. **Session keep-alive** — Actively maintain VRChat sessions by refreshing cookies/tokens as needed.
4. **Scoped API proxy** — Third-party apps request access through VRCSL with specific permission scopes. VRCSL proxies VRChat API requests on their behalf.
5. **User consent** — Every third-party app registration requires explicit user approval via a topmost consent dialog.
6. **Local-only access** — All APIs bind exclusively to `127.0.0.1`; no external network access.
7. **Revocable tokens** — Users can view, edit, and revoke third-party app permissions at any time through the VRCSL UI.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     VRCSL (Electron)                    │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐│
│  │ Renderer  │  │ Preload  │  │      Main Process      ││
│  │ (Svelte)  │◄─┤ (Bridge) ├─►│                        ││
│  │ Settings  │  └──────────┘  │  ┌──────────────────┐  ││
│  │ Consent   │                │  │ Account Manager   │  ││
│  │ Dashboard │                │  │ (VRChat Sessions) │  ││
│  └──────────┘                │  └────────┬─────────┘  ││
│                               │           │             ││
│                               │  ┌────────▼─────────┐  ││
│                               │  │  VRChat API       │  ││
│                               │  │  Client (vrchat)  │  ││
│                               │  └────────┬─────────┘  ││
│                               │           │             ││
│                               │  ┌────────▼─────────┐  ││
│                               │  │  Local API Server │  ││
│                               │  │  HTTP  :7642      │  ││
│                               │  │  WS    :7642/ws   │  ││
│                               │  │  DeepLink vrcsl://│  ││
│                               │  └──────────────────┘  ││
│                               └────────────────────────┘│
└─────────────────────────────────────────────────────────┘
         │                              │
         │ (127.0.0.1 only)             │ (HTTPS)
         ▼                              ▼
┌─────────────────┐            ┌─────────────────┐
│  Third-Party    │            │   VRChat API     │
│  Apps / Sites   │            │   api.vrchat.com │
└─────────────────┘            └─────────────────┘
```

### Process Architecture

- **Main Process** (Node.js): Hosts the Account Manager, VRChat API client, local API server (HTTP + WebSocket), DeepLink handler, credential vault access, token management, audit logging, and auto-updater.
- **Renderer Process** (Svelte): Provides the UI for account management, third-party app permissions dashboard, consent dialogs, settings, and audit log viewer.
- **Preload Bridge**: Exposes a strict, minimal IPC API between renderer and main process using `contextBridge`.

---

## 4. Technology Stack

| Layer | Technology |
|---|---|
| Framework | Electron 41+ |
| Build Tool | electron-vite |
| Frontend | Svelte 5 (runes mode), TailwindCSS 4, shadcn-svelte |
| UI Components | shadcn-svelte (built on Bits UI primitives) |
| State Management | Svelte 5 runes (`$state`, `$derived`, `$effect`) |
| Language | TypeScript (strict) |
| VRChat SDK | `vrchat` npm package (v2.21+) |
| Credential Storage | OS Keychain via `keytar` (DPAPI / libsecret) |
| Data Storage | AES-256-GCM encrypted JSON files |
| HTTP Server | Node.js `http` module (bound to 127.0.0.1) |
| WebSocket Server | `ws` library |
| DeepLink | Electron protocol handler (`vrcsl://`) |
| Auto-Update | GitHub Releases (tag format: `vVERSION`) |
| Packaging | electron-builder |

---

## 5. Security Model

### 5.1 Credential Storage

- VRChat credentials (username, password) are stored in the **OS keychain**:
  - **Windows**: Windows Credential Manager (DPAPI)
  - **Linux**: libsecret (GNOME Keyring / KWallet)
- Credentials are **never written to disk** in plaintext. They are retrieved from the keychain only when needed for VRChat authentication and held in memory only for the duration of the API call.
- VRChat session cookies (`auth`, `twoFactorAuth`) are stored in AES-256-GCM encrypted JSON files with a key derived from the OS keychain.

### 5.2 Local-Only API Binding

- The HTTP and WebSocket servers **MUST** bind exclusively to `127.0.0.1:7642`.
- The server startup **MUST** verify the bind address is `127.0.0.1` before accepting connections.
- Reject any connection from non-loopback addresses as an additional safeguard.

### 5.3 Client Verification (Process Verification)

When a native third-party app connects and requests registration:

1. **Process identification**: VRCSL inspects the connecting client's process ID (PID) using OS APIs to determine the executable path and, where available, its code signature.
   - **Windows**: Use `GetExtendedTcpTable` / `GetTcpTable2` to map the TCP connection to a PID, then `QueryFullProcessImageNameW` to get the process path.
   - **Linux**: Parse `/proc/net/tcp` and `/proc/{pid}/exe` to resolve the process.
2. **Signature check** (Windows): If the connecting process is signed, verify the Authenticode signature and record the signer identity.
3. **Consent dialog**: Display a topmost consent window showing the app name, process path, signature status, requested scopes, and account selection.
4. **Binding**: Once approved, the token is bound to the app's verified identity (process path + optional signature hash). Subsequent connections from the same app skip the consent dialog if the token is still valid and the process identity matches.

> **Note**: Web-based clients (connecting via WebSocket from browsers) cannot be process-verified. For these clients, security relies on the user consent dialog and the CORS-safe WebSocket protocol. The origin header is logged for audit purposes.

### 5.4 Rate Limiting

- Per-token rate limiting is enforced on all API endpoints.
- Default: **60 requests per minute** per token (configurable in settings).
- Burst: **10 requests per second** max.
- Rate limit violations are logged in the audit log and return HTTP `429 Too Many Requests`.

### 5.5 Input Validation & Sanitization

- All incoming API parameters are validated against strict schemas before processing.
- `userId` parameters are validated against the set of accounts the token has been granted access to.
- Scope parameters are validated against the token's granted scope set.
- Request body size is capped at **1 MB**.

### 5.6 Memory Safety

- Credentials fetched from the keychain are zeroed from memory after use where possible.
- Auth cookies are kept in memory only for active sessions.

---

## 6. Account Management

### 6.1 Adding an Account

1. User provides VRChat username/email and password in the VRCSL UI.
2. VRCSL stores credentials in the OS keychain under a namespaced key (e.g., `vrcsl/account/{accountId}`).
3. VRCSL attempts login via the `vrchat` SDK.
4. If 2FA is required, VRCSL displays a dialog in the UI prompting the user for their TOTP code or email verification code.
5. On success, session cookies are encrypted and persisted to the data store.

### 6.2 Session Keep-Alive

- VRCSL periodically checks session validity (configurable interval, default: **every 5 minutes**).
- If a session is expiring or expired, VRCSL silently re-authenticates using stored credentials.
- If re-authentication requires 2FA, the user is prompted via a notification/dialog.
- Session state (online/offline/re-auth needed) is visible in the UI dashboard.

### 6.3 Account Removal

- Removing an account deletes credentials from the OS keychain, removes encrypted session data, and revokes all tokens associated with that account.
- Third-party apps with access to the removed account are notified (if connected via WebSocket) or receive `403 Forbidden` on next request.

---

## 7. Third-Party App Registration Flow

```
Third-Party App                    VRCSL                         User
      │                              │                              │
      │  POST /register              │                              │
      │  {appName, scopes, ...}      │                              │
      │─────────────────────────────►│                              │
      │                              │  Process verification        │
      │                              │  (PID → path → signature)    │
      │                              │                              │
      │                              │  Show topmost consent dialog │
      │                              │─────────────────────────────►│
      │                              │                              │
      │                              │  User reviews:               │
      │                              │  - App name & path           │
      │                              │  - Signature status          │
      │                              │  - Requested scopes          │
      │                              │  - Selects VRChat accounts   │
      │                              │                              │
      │                              │  Approve / Deny              │
      │                              │◄─────────────────────────────│
      │                              │                              │
      │  {token, refreshToken,       │                              │
      │   expiresIn, grantedScopes,  │                              │
      │   grantedAccounts}           │                              │
      │◄─────────────────────────────│                              │
```

### Registration Request Body

```json
{
  "appName": "My VRChat Tool",
  "appDescription": "A tool that manages avatars",
  "scopes": ["vrchat.avatars.*", "vrchat.users.get"],
  "callbackUrl": "http://localhost:3000/callback"  // optional, for web apps
}
```

### Registration Response (on approval)

```json
{
  "token": "vrcsl_at_...",
  "refreshToken": "vrcsl_rt_...",
  "expiresIn": 3600,
  "grantedScopes": ["vrchat.avatars.*", "vrchat.users.get"],
  "grantedAccounts": ["usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"]
}
```

---

## 8. Scope System

VRCSL implements a **full VRChat API proxy scope system**, mapping scopes to VRChat API endpoint categories. Scopes follow a hierarchical dot notation with wildcard support.

### Scope Format

```
vrchat.<category>.<action>
```

### Scope Categories

| Scope Pattern | Description | VRChat API Endpoints |
|---|---|---|
| `vrchat.users.*` | Full user access | All `/users/` endpoints |
| `vrchat.users.get` | Read user profiles | `GET /users/{userId}` |
| `vrchat.users.search` | Search users | `GET /users` |
| `vrchat.friends.*` | Full friends access | All `/auth/user/friends` endpoints |
| `vrchat.friends.list` | List friends | `GET /auth/user/friends` |
| `vrchat.friends.status` | Friend status | `GET /users/{userId}/friendStatus` |
| `vrchat.avatars.*` | Full avatar access | All `/avatars/` endpoints |
| `vrchat.avatars.get` | Read avatar info | `GET /avatars/{avatarId}` |
| `vrchat.avatars.select` | Switch avatar | `PUT /users/{userId}/avatar` |
| `vrchat.avatars.list` | List avatars | `GET /avatars` |
| `vrchat.worlds.*` | Full world access | All `/worlds/` endpoints |
| `vrchat.worlds.get` | Read world info | `GET /worlds/{worldId}` |
| `vrchat.worlds.list` | List worlds | `GET /worlds` |
| `vrchat.instances.*` | Full instance access | All `/instances/` endpoints |
| `vrchat.instances.get` | Get instance info | `GET /instances/{instanceId}` |
| `vrchat.instances.create` | Create instance | `POST /instances` |
| `vrchat.invites.*` | Full invite access | All invite endpoints |
| `vrchat.invites.send` | Send invites | `POST /invite/{userId}` |
| `vrchat.invites.list` | List invites | `GET /messages` |
| `vrchat.favorites.*` | Full favorites access | All `/favorites/` endpoints |
| `vrchat.groups.*` | Full group access | All `/groups/` endpoints |
| `vrchat.notifications.*` | Full notification access | All `/notifications/` endpoints |
| `vrchat.playermod.*` | Player moderation | All `/auth/user/playermoderations` endpoints |
| `vrchat.files.*` | File access | All `/files/` endpoints |
| `vrchat.pipeline.*` | All pipeline event subscriptions | All VRChat + VRCSL events |
| `vrchat.pipeline.friend-online` | Friend online events | `friend-online` |
| `vrchat.pipeline.friend-offline` | Friend offline events | `friend-offline` |
| `vrchat.pipeline.friend-add` | Friend added events | `friend-add` |
| `vrchat.pipeline.friend-delete` | Friend removed events | `friend-delete` |
| `vrchat.pipeline.friend-update` | Friend profile update events | `friend-update` |
| `vrchat.pipeline.friend-location` | Friend location change events | `friend-location` |
| `vrchat.pipeline.user-update` | Current user update events | `user-update` |
| `vrchat.pipeline.user-location` | Current user location events | `user-location` |
| `vrchat.pipeline.notification` | Notification events | `notification`, `notification-v2` |
| `vrchat.pipeline.content-refresh` | Content refresh events | `content-refresh` |
| `vrcsl.events.*` | All VRCSL internal events | session, token, account events |
| `vrcsl.events.session` | Session state change events | `session-refreshed`, `session-expired` |
| `vrcsl.events.account` | Account state change events | `account-online`, `account-offline` |
| `vrcsl.events.token` | Token lifecycle events | `token-revoked`, `token-expired` |
| `vrchat.*` | Full unrestricted API + pipeline access | All VRChat API endpoints + events |

### Scope Resolution

- `vrchat.avatars.*` grants access to all endpoints under `vrchat.avatars`.
- `vrchat.*` grants unrestricted access (displayed with a **red warning** in the consent dialog).
- Scopes are evaluated from most specific to least specific.
- If a requested scope is not recognized, registration is rejected.

---

## 9. Token Management

### 9.1 Token Format

Tokens are cryptographically random, opaque strings with a recognizable prefix:

- **Access Token**: `vrcsl_at_<32 random bytes hex>` (total ~72 chars)
- **Refresh Token**: `vrcsl_rt_<32 random bytes hex>` (total ~72 chars)

Tokens are generated using `crypto.randomBytes(32)`.

### 9.2 Token Lifecycle

| Property | Value |
|---|---|
| Access Token TTL | **1 hour** (default, configurable) |
| Refresh Token TTL | **30 days** (default, configurable) |
| Refresh grants new access token | Yes |
| Refresh grants new refresh token | Yes (rotation) |
| Old refresh token invalidated on use | Yes |

### 9.3 Token Storage (Server-Side)

Tokens are stored in the encrypted data store with the following metadata:

```json
{
  "tokenHash": "<SHA-256 hash of the token>",
  "appName": "My VRChat Tool",
  "appProcessPath": "C:\\Tools\\MyVRCTool.exe",
  "appSignatureHash": "<SHA-256 of code signature, if available>",
  "grantedScopes": ["vrchat.avatars.*"],
  "grantedAccountIds": ["usr_xxx"],
  "createdAt": "2026-04-18T12:00:00Z",
  "expiresAt": "2026-04-18T13:00:00Z",
  "lastUsedAt": "2026-04-18T12:30:00Z",
  "refreshTokenHash": "<SHA-256 hash>",
  "refreshExpiresAt": "2026-05-18T12:00:00Z",
  "rateLimit": { "rpm": 60, "burst": 10 }
}
```

> **Note**: Only the **hash** of tokens is stored, never the plaintext. The plaintext token is returned to the app only once, at registration time and at refresh time.

### 9.4 Token Validation Flow

1. Extract token from `Authorization: Bearer vrcsl_at_...` header.
2. Compute `SHA-256(token)`.
3. Look up token hash in the data store.
4. Verify token is not expired.
5. Verify requesting process identity matches stored app identity (for native apps).
6. Verify requested scope is within granted scopes.
7. Verify requested `userId` is within granted accounts.
8. Check rate limit.
9. Proxy request to VRChat API using the account's active session.

---

## 10. API Design

All APIs bind to `127.0.0.1:7642`. The same Hono-like HTTP server handles both REST and WebSocket upgrade requests.

### 10.1 HTTP API

#### Common Headers

| Header | Description |
|---|---|
| `Authorization` | `Bearer vrcsl_at_...` — Required for all endpoints except `/register` |
| `Content-Type` | `application/json` |

#### Endpoints

##### `POST /register`

Register a new third-party app. Triggers consent dialog.

**Request:**
```json
{
  "appName": "My VRChat Tool",
  "appDescription": "Manages avatars across accounts",
  "scopes": ["vrchat.avatars.*", "vrchat.users.get"]
}
```

**Response (200 — approved):**
```json
{
  "token": "vrcsl_at_...",
  "refreshToken": "vrcsl_rt_...",
  "expiresIn": 3600,
  "grantedScopes": ["vrchat.avatars.*", "vrchat.users.get"],
  "grantedAccounts": [
    { "userId": "usr_xxx", "displayName": "Player1" }
  ]
}
```

**Response (403 — denied):**
```json
{
  "error": "consent_denied",
  "message": "User denied the registration request."
}
```

##### `POST /refresh`

Refresh an expired access token.

**Request:**
```json
{
  "refreshToken": "vrcsl_rt_..."
}
```

**Response (200):**
```json
{
  "token": "vrcsl_at_...",
  "refreshToken": "vrcsl_rt_...",
  "expiresIn": 3600
}
```

##### `GET /accounts`

List VRChat accounts the token has access to.

**Response (200):**
```json
{
  "accounts": [
    {
      "userId": "usr_xxx",
      "displayName": "Player1",
      "status": "online",
      "avatarThumbnailUrl": "https://..."
    }
  ]
}
```

##### `POST /api`

Proxy a VRChat API request.

**Request:**
```json
{
  "userId": "usr_xxx",
  "method": "GET",
  "path": "/avatars/{avatarId}",
  "body": null
}
```

**Response (200):**
```json
{
  "status": 200,
  "data": { /* VRChat API response */ }
}
```

**Response (403 — scope violation):**
```json
{
  "error": "scope_denied",
  "message": "Token does not have scope 'vrchat.avatars.get'."
}
```

##### `POST /api/batch`

Proxy multiple VRChat API requests in a single call (same rate limit applies per individual request).

**Request:**
```json
{
  "requests": [
    { "requestId": "1", "userId": "usr_xxx", "method": "GET", "path": "/users/usr_yyy" },
    { "requestId": "2", "userId": "usr_xxx", "method": "GET", "path": "/worlds/wrld_zzz" }
  ]
}
```

**Response (200):**
```json
{
  "responses": [
    { "requestId": "1", "status": 200, "data": { /* ... */ } },
    { "requestId": "2", "status": 200, "data": { /* ... */ } }
  ]
}
```

#### Error Response Format

All errors follow a consistent format:

```json
{
  "error": "error_code",
  "message": "Human-readable error description."
}
```

| Error Code | HTTP Status | Description |
|---|---|---|
| `invalid_token` | 401 | Token is invalid or expired |
| `consent_denied` | 403 | User denied registration |
| `scope_denied` | 403 | Token lacks required scope |
| `account_denied` | 403 | Token does not have access to the requested account |
| `rate_limited` | 429 | Rate limit exceeded |
| `invalid_request` | 400 | Malformed request body |
| `internal_error` | 500 | Internal server error |
| `vrchat_error` | 502 | VRChat API returned an error |

---

### 10.2 WebSocket API

WebSocket endpoint: `ws://127.0.0.1:7642/ws`

The WebSocket API serves the same purpose as the HTTP API but is designed for **web-based clients** to avoid CORS issues. It uses a `requestId`-based request/response protocol.

#### Connection

1. Client connects to `ws://127.0.0.1:7642/ws`.
2. Client must send an `auth` message as the first message:

```json
{
  "requestId": "auth-1",
  "type": "auth",
  "body": {
    "token": "vrcsl_at_..."
  }
}
```

3. Server responds:

```json
{
  "requestId": "auth-1",
  "type": "auth_response",
  "body": {
    "success": true,
    "accounts": [
      { "userId": "usr_xxx", "displayName": "Player1" }
    ]
  }
}
```

#### Message Format

**Request (client → server):**
```json
{
  "requestId": "unique-id",
  "type": "api_request",
  "userId": "usr_xxx",
  "body": {
    "method": "GET",
    "path": "/avatars/{avatarId}"
  }
}
```

**Response (server → client):**
```json
{
  "requestId": "unique-id",
  "type": "api_response",
  "userId": "usr_xxx",
  "body": {
    "status": 200,
    "data": { /* VRChat API response */ }
  }
}
```

**Error (server → client):**
```json
{
  "requestId": "unique-id",
  "type": "error",
  "body": {
    "error": "scope_denied",
    "message": "Token does not have scope 'vrchat.avatars.get'."
  }
}
```

#### WebSocket-Specific Message Types

| Type | Direction | Description |
|---|---|---|
| `auth` | client → server | Authenticate with token (must be first message) |
| `auth_response` | server → client | Authentication result |
| `api_request` | client → server | Proxy a VRChat API request |
| `api_response` | server → client | VRChat API response |
| `register` | client → server | Register a new app (triggers consent) |
| `register_response` | server → client | Registration result with tokens |
| `subscribe` | client → server | Subscribe to pipeline events |
| `subscribe_response` | server → client | Subscription confirmation |
| `unsubscribe` | client → server | Unsubscribe from pipeline events |
| `unsubscribe_response` | server → client | Unsubscription confirmation |
| `event` | server → client | Pipeline event push |
| `error` | server → client | Error message |
| `ping` | client → server | Keep-alive ping |
| `pong` | server → client | Keep-alive pong response |

#### WebSocket Registration (for web apps)

Web apps that don't have a token yet can send a `register` message:

```json
{
  "requestId": "reg-1",
  "type": "register",
  "body": {
    "appName": "My Web Tool",
    "appDescription": "Avatar browser",
    "scopes": ["vrchat.avatars.*"],
    "origin": "https://mytool.example.com"
  }
}
```

The consent dialog will show the `origin` header value for web-based clients. On approval, the server responds with the same token payload as the HTTP `/register` endpoint.

#### WebSocket Pipeline Subscription

Authenticated WebSocket clients can subscribe to real-time pipeline events:

**Subscribe:**
```json
{
  "requestId": "sub-1",
  "type": "subscribe",
  "body": {
    "accountIds": ["usr_xxx"],
    "events": ["friend-online", "friend-offline", "user-update"]
  }
}
```

- `accountIds` (required): Array of VRChat user IDs to receive events for. Must be within the token's granted accounts.
- `events` (optional): Array of event type filters. If omitted, all events the token's scopes permit are delivered.

**Subscribe response:**
```json
{
  "requestId": "sub-1",
  "type": "subscribe_response",
  "body": {
    "success": true,
    "subscribedAccounts": ["usr_xxx"],
    "subscribedEvents": ["friend-online", "friend-offline", "user-update"]
  }
}
```

**Event push (server → client):**
```json
{
  "type": "event",
  "userId": "usr_xxx",
  "body": {
    "eventType": "friend-online",
    "source": "vrchat",
    "timestamp": "2026-04-18T12:00:00.000Z",
    "data": {
      "userId": "usr_yyy",
      "user": { "displayName": "FriendName", "status": "active" }
    }
  }
}
```

**Unsubscribe:**
```json
{
  "requestId": "unsub-1",
  "type": "unsubscribe",
  "body": {}
}
```

Unsubscribing stops all event delivery on this connection. The client can re-subscribe at any time.

---

### 10.3 DeepLink API

Protocol: `vrcsl://`

DeepLinks are designed for **end-user convenience** (e.g., one-click avatar switching from a website or desktop shortcut). They do **not** require a token — they trigger interactive UI flows.

#### DeepLink Format

```
vrcsl://<action>?<params>
```

#### Supported DeepLinks

| DeepLink | Description | Parameters |
|---|---|---|
| `vrcsl://switchavatar` | Switch avatar on an account | `avatarId` (required), `accountIdx` (optional) |
| `vrcsl://joinworld` | Join a world instance | `worldId` (required), `instanceId` (optional), `accountIdx` (optional) |
| `vrcsl://addfriend` | Send friend request | `userId` (required), `accountIdx` (optional) |
| `vrcsl://open` | Open VRCSL and focus the main window | — |

#### `accountIdx` Behavior

- If `accountIdx` is provided: The action is executed on the account at that index (0-based). If the index is invalid, an error dialog is shown.
- If `accountIdx` is omitted and the user has **one account**: The action executes on that account.
- If `accountIdx` is omitted and the user has **multiple accounts**: A topmost account picker dialog is displayed.

#### Example

```
vrcsl://switchavatar?avatarId=avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
vrcsl://switchavatar?avatarId=avtr_xxx&accountIdx=0
vrcsl://joinworld?worldId=wrld_xxx&instanceId=12345~private(usr_xxx)
```

#### DeepLink Security

- DeepLinks **do not expose credentials** or session data.
- All DeepLink actions require user interaction (confirmation dialog) before execution.
- DeepLinks cannot be used to register third-party apps or obtain tokens.
- URL parameters are strictly validated; invalid parameters result in an error dialog.

---

## 11. Pipeline & Event System

VRCSL provides a real-time event pipeline that combines **VRChat pipeline events** (forwarded from VRChat's WebSocket) and **VRCSL internal events** (session changes, token lifecycle, account status). Third-party apps can subscribe to these events via WebSocket or consume them over HTTP using Server-Sent Events (SSE).

### 11.1 Architecture

```
┌──────────────────────────┐
│   VRChat WebSocket       │
│   pipeline.vrchat.cloud  │
└──────────┬───────────────┘
           │ (per-account connection)
           ▼
┌──────────────────────────┐      ┌──────────────────────────┐
│   Pipeline Manager       │◄─────│   Account Manager        │
│   (Main Process)         │      │   (VRCSL internal events)│
└──────────┬───────────────┘      └──────────────────────────┘
           │
           │ scope-filtered, account-filtered
           ▼
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌────────┐  ┌─────────┐
│ WS     │  │ SSE     │
│ /ws    │  │ /events │
└────────┘  └─────────┘
```

### 11.2 VRChat Pipeline Connection

- VRCSL maintains one WebSocket connection per active VRChat account to VRChat's pipeline server (`pipeline.vrchat.cloud`).
- These connections are managed by the Account Manager as part of session keep-alive.
- Incoming VRChat events are parsed, tagged with the source `accountId`, and forwarded to the Pipeline Manager.

### 11.3 VRCSL Internal Events

In addition to VRChat events, VRCSL emits its own events:

| Event Type | Source | Description |
|---|---|---|
| `session-refreshed` | `vrcsl` | Account session was successfully refreshed |
| `session-expired` | `vrcsl` | Account session expired, re-auth needed |
| `account-online` | `vrcsl` | Account came online |
| `account-offline` | `vrcsl` | Account went offline |
| `token-revoked` | `vrcsl` | A third-party app token was revoked by the user |
| `token-expired` | `vrcsl` | A third-party app token expired |

### 11.4 VRChat Pipeline Events

All known VRChat pipeline events are forwarded (subject to scope filtering):

| Event Type | Scope Required | Description |
|---|---|---|
| `friend-online` | `vrchat.pipeline.friend-online` | A friend came online |
| `friend-offline` | `vrchat.pipeline.friend-offline` | A friend went offline |
| `friend-add` | `vrchat.pipeline.friend-add` | A friend was added |
| `friend-delete` | `vrchat.pipeline.friend-delete` | A friend was removed |
| `friend-update` | `vrchat.pipeline.friend-update` | A friend's profile changed |
| `friend-location` | `vrchat.pipeline.friend-location` | A friend changed location/world |
| `user-update` | `vrchat.pipeline.user-update` | Current user's profile was updated |
| `user-location` | `vrchat.pipeline.user-location` | Current user's location changed |
| `notification` | `vrchat.pipeline.notification` | New notification received |
| `notification-v2` | `vrchat.pipeline.notification` | New notification v2 received |
| `see-notification` | `vrchat.pipeline.notification` | Notification was seen |
| `hide-notification` | `vrchat.pipeline.notification` | Notification was hidden |
| `content-refresh` | `vrchat.pipeline.content-refresh` | Content refresh signal |

The wildcard scope `vrchat.pipeline.*` grants access to all VRChat pipeline events. The wildcard `vrchat.*` also includes all pipeline events.

### 11.5 Event Delivery via SSE (HTTP)

#### `GET /events`

Server-Sent Events endpoint for HTTP-based clients. Requires token authentication.

**Request:**
```
GET /events?accountIds=usr_xxx,usr_yyy&events=friend-online,friend-offline HTTP/1.1
Host: 127.0.0.1:7642
Authorization: Bearer vrcsl_at_...
Accept: text/event-stream
```

**Query Parameters:**

| Parameter | Required | Description |
|---|---|---|
| `accountIds` | Yes | Comma-separated VRChat user IDs to receive events for. Must be within granted accounts. |
| `events` | No | Comma-separated event type filter. If omitted, all scope-permitted events are sent. |

**Response (200, `text/event-stream`):**
```
event: friend-online
data: {"userId":"usr_xxx","eventType":"friend-online","source":"vrchat","timestamp":"2026-04-18T12:00:00.000Z","data":{"userId":"usr_yyy","user":{"displayName":"FriendName"}}}

event: session-refreshed
data: {"userId":"usr_xxx","eventType":"session-refreshed","source":"vrcsl","timestamp":"2026-04-18T12:05:00.000Z","data":{}}

```

- Each SSE message uses the `event` field set to the event type and the `data` field containing the JSON payload.
- The connection remains open and events are streamed as they occur.
- No reconnection buffer. If the connection drops, events during the disconnection period are lost.
- Standard SSE `retry` field is sent to suggest a reconnection interval (default: 3000ms).
- Rate limiting applies to the initial connection request only, not to individual events.

### 11.6 Event Delivery via WebSocket

WebSocket event subscription is documented in [Section 10.2 — WebSocket Pipeline Subscription](#102-websocket-api). The same event format and filtering rules apply.

### 11.7 Event Format (Unified)

All events, regardless of delivery mechanism (SSE or WebSocket), follow the same structure:

```json
{
  "userId": "usr_xxx",
  "eventType": "friend-online",
  "source": "vrchat",
  "timestamp": "2026-04-18T12:00:00.000Z",
  "data": { /* event-specific payload */ }
}
```

| Field | Type | Description |
|---|---|---|
| `userId` | `string` | The VRCSL account that produced this event |
| `eventType` | `string` | The event type identifier |
| `source` | `"vrchat"` \| `"vrcsl"` | Whether the event originates from VRChat's pipeline or VRCSL internally |
| `timestamp` | `string` (ISO 8601) | When the event was received/generated |
| `data` | `object` | Event-specific payload (varies per event type) |

### 11.8 Scope Filtering

- When a client subscribes (via WebSocket `subscribe` or HTTP `/events`), VRCSL computes the intersection of:
  1. The token's granted scopes.
  2. The client's requested event filter (if any).
  3. The client's requested account IDs vs. the token's granted account IDs.
- Only events that pass all three checks are delivered.
- If the token does not have any pipeline scopes, subscription is rejected with `scope_denied`.

---

## 12. Data Storage

### 12.1 Storage Location

```
{app.getPath('userData')}/
├── config.enc.json          # App settings (encrypted)
├── accounts.enc.json        # Account metadata & encrypted sessions (encrypted)
├── tokens.enc.json          # Third-party app tokens (encrypted)
├── audit.log                # Audit log (plaintext, rotated)
└── audit.log.1              # Rotated audit log
```

### 12.2 Encryption Scheme

- **Algorithm**: AES-256-GCM
- **Key Derivation**: A 256-bit encryption key is generated randomly on first launch and stored in the OS keychain under `vrcsl/master-key`.
- **Per-file IV**: Each encrypted file uses a unique 96-bit IV, prepended to the ciphertext.
- **Authentication tag**: The 128-bit GCM auth tag is appended to the ciphertext.
- **File format**: `<IV (12 bytes)><ciphertext><auth tag (16 bytes)>`

### 12.3 Data Schemas

#### `accounts.enc.json` (decrypted structure)

```json
{
  "accounts": [
    {
      "id": "acc_local_uuid",
      "vrchatUserId": "usr_xxx",
      "displayName": "Player1",
      "keychainKey": "vrcsl/account/acc_local_uuid",
      "sessionData": {
        "authCookie": "authcookie_xxx",
        "twoFactorAuthCookie": "2fa_xxx",
        "lastRefreshed": "2026-04-18T12:00:00Z",
        "expiresAt": "2026-04-19T12:00:00Z"
      },
      "addedAt": "2026-04-18T10:00:00Z"
    }
  ]
}
```

#### `tokens.enc.json` (decrypted structure)

```json
{
  "registrations": [
    {
      "id": "reg_uuid",
      "appName": "My VRChat Tool",
      "appDescription": "Manages avatars",
      "appProcessPath": "C:\\Tools\\MyVRCTool.exe",
      "appSignatureHash": "sha256:abc123...",
      "tokenHash": "sha256:...",
      "refreshTokenHash": "sha256:...",
      "grantedScopes": ["vrchat.avatars.*"],
      "grantedAccountIds": ["acc_local_uuid"],
      "createdAt": "2026-04-18T12:00:00Z",
      "expiresAt": "2026-04-18T13:00:00Z",
      "refreshExpiresAt": "2026-05-18T12:00:00Z",
      "lastUsedAt": "2026-04-18T12:30:00Z",
      "rateLimit": { "rpm": 60, "burst": 10 }
    }
  ]
}
```

#### `config.enc.json` (decrypted structure)

```json
{
  "settings": {
    "apiPort": 7642,
    "sessionCheckIntervalMs": 300000,
    "defaultTokenTTLSeconds": 3600,
    "defaultRefreshTokenTTLDays": 30,
    "defaultRateLimit": { "rpm": 60, "burst": 10 },
    "minimizeToTray": true,
    "auditLogMaxSizeMB": 50,
    "auditLogMaxFiles": 5,
    "autoUpdate": true
  }
}
```

---

## 13. UI/UX Design

### 13.0 Frontend Stack & State Management

**UI Component Library**: All UI is built with **shadcn-svelte** components (Button, Dialog, Card, Tabs, Table, Badge, Alert, Input, Switch, ScrollArea, Sonner, etc.) styled with **TailwindCSS 4**. Components are installed via the `shadcn-svelte` CLI and live in `src/renderer/src/components/ui/`.

**State Management**: The renderer uses **Svelte 5 runes** exclusively for client-side state — no legacy Svelte stores (`writable`, `readable`, `derived`) are used.

| Rune | Usage |
|---|---|
| `$state` | Local component state (form inputs, UI toggles, loading flags) |
| `$state.raw` | Large read-heavy data from IPC (account lists, audit log entries, registration lists) |
| `$derived` | Computed values (filtered lists, status counts, scope display strings) |
| `$effect` | Side effects (IPC subscriptions, polling timers, event listener setup/teardown) |
| `$bindable` | Two-way binding for reusable form components (inputs, toggles) |

**Global reactive state** shared across components is managed via **module-level `$state`** in dedicated `.svelte.ts` files:

```
renderer/src/
├── state/
│   ├── accounts.svelte.ts    # $state<AccountInfo[]> — synced from main via IPC
│   ├── registrations.svelte.ts # $state<AppRegistration[]> — connected apps
│   ├── settings.svelte.ts    # $state<AppSettings> — app settings
│   └── consent.svelte.ts     # $state<ConsentRequest | null> — pending consent
```

Each state module exports reactive state variables and async functions that call the IPC bridge to fetch/mutate data. Components import and read these directly — mutations go through the exported functions which call `window.vrcsl.*` IPC methods and update the `$state` on success.

**shadcn-svelte components used:**

| Component | Used For |
|---|---|
| `Button` | All actions (add account, approve/deny, revoke, save settings) |
| `Card` | Account cards, app registration cards |
| `Dialog` | Add account form, 2FA prompt, permission editor |
| `AlertDialog` | Destructive confirmations (remove account, revoke token) |
| `Tabs` | Main window navigation (Accounts / Connected Apps / Audit Log / Settings) |
| `Table` | Audit log entries, scope listings |
| `Badge` | Account status (online/offline/re-auth), scope tags |
| `Alert` | Warnings (full access scope, session errors) |
| `Input` | Username, password, 2FA code, port, TTL fields |
| `Input OTP` | 2FA code entry (6-digit TOTP / email codes) |
| `Switch` | Boolean settings (minimize to tray, auto-update) |
| `ScrollArea` | Scrollable audit log, long scope lists |
| `Separator` | Visual dividers between sections |
| `Sonner` | Toast notifications (session refreshed, token revoked, update available) |
| `Checkbox` | Account selection in consent dialog, scope toggles in permission editor |
| `RadioGroup` | DeepLink account picker |
| `Skeleton` | Loading states while fetching data from main process |
| `DropdownMenu` | Account card actions (remove, re-auth), tray-like quick actions |
| `Tooltip` | Scope descriptions, signature status info |

### 13.1 Main Window

The main window serves as the dashboard and settings interface. It minimizes to the system tray instead of closing. Navigation uses shadcn-svelte `Tabs` at the top of the window.

**Sections (Tabs):**

1. **Accounts** — List of registered VRChat accounts rendered as shadcn `Card` components with `Badge` status indicators (online/offline/re-auth needed). Add/remove accounts. Per-account session status.
2. **Connected Apps** — List of registered third-party apps as `Card` components with their granted scopes (`Badge` tags), accounts, last used time, and token expiry. Edit scopes, edit account access, revoke tokens.
3. **Audit Log** — Filterable `Table` of all API requests from third-party apps. Shows timestamp, app name, endpoint, account used, and result.
4. **Settings** — API port (`Input`), rate limits, token TTL defaults, session check interval, tray behavior (`Switch`), auto-update preferences (`Switch`).

### 13.2 Consent Dialog

A **topmost, always-on-top** `BrowserWindow` (separate from the main window) that appears when a third-party app requests registration. The main window cannot be interacted with while this dialog is open (modal behavior relative to the app). The dialog content is a dedicated Svelte component rendered with shadcn-svelte components.

**Content:**

- App name and description (shadcn `Card` header)
- Process path and signature status `Badge` (for native apps) or origin (for web apps)
- List of requested scopes with human-readable descriptions (shadcn `Table` with `Tooltip` for details)
- **Red warning `Alert`** if `vrchat.*` (full access) is requested
- `Checkbox` list of VRChat accounts to share (all unchecked by default)
- `Button` **Approve** (primary) / **Deny** (destructive variant)

### 13.3 DeepLink Account Picker

A **topmost** `BrowserWindow` dialog that appears when a DeepLink action is triggered without an `accountIdx` and the user has multiple accounts.

**Content:**

- Action description (e.g., "Switch to avatar avtr_xxx")
- `RadioGroup` list of VRChat accounts
- `Button` **Confirm** / **Cancel**

### 13.4 System Tray

- Tray icon with a context menu:
  - **Open Dashboard** — Focus/show main window
  - **Accounts** — Submenu showing online status of each account
  - **Quit** — Fully exit VRCSL

---

## 14. Update Mechanism

- On startup and periodically (every 6 hours), VRCSL checks the GitHub repository's releases API for a new release.
- Release tags follow the format `vVERSION` (e.g., `v1.0.0`, `v1.2.3`).
- The current version is read from `package.json`.
- If a newer version is found:
  1. A non-intrusive notification is shown to the user.
  2. User can choose to download and install the update or dismiss.
  3. The update is downloaded from the GitHub release assets.
  4. On confirmation, the app restarts and applies the update.
- **Update integrity**: Downloaded assets are verified against the release's checksum (SHA-256) published in the release notes.

---

## 15. Audit Logging

### 15.1 Logged Events

| Event Type | Details Logged |
|---|---|
| `app.registered` | App name, process path, granted scopes, granted accounts |
| `app.denied` | App name, process path, requested scopes |
| `app.revoked` | App name, revoked by user |
| `app.scopes_modified` | App name, old scopes, new scopes |
| `api.request` | App name, endpoint, method, userId, status code, response time |
| `api.rate_limited` | App name, token hash (first 8 chars), endpoint |
| `api.scope_denied` | App name, attempted scope, endpoint |
| `api.account_denied` | App name, attempted userId |
| `pipeline.subscribed` | App name, subscribed accounts, subscribed event types |
| `pipeline.unsubscribed` | App name |
| `pipeline.sse_connected` | App name, subscribed accounts, subscribed event types |
| `pipeline.sse_disconnected` | App name, duration |
| `account.added` | VRChat userId, displayName |
| `account.removed` | VRChat userId |
| `account.session_refreshed` | VRChat userId |
| `account.auth_failed` | VRChat userId, reason |
| `token.refreshed` | App name, token hash (first 8 chars) |
| `token.expired` | App name |
| `deeplink.executed` | Action, parameters, account used |
| `security.process_mismatch` | App name, expected path, actual path |

### 15.2 Log Format

```
[2026-04-18T12:00:00.000Z] [api.request] appName="My Tool" method=GET path="/avatars/avtr_xxx" userId="usr_xxx" status=200 duration=142ms
```

### 15.3 Log Rotation

- Max file size: **50 MB** (configurable)
- Max rotated files: **5** (configurable)
- Rotation: When the current log exceeds max size, it is renamed to `audit.log.1`, previous `.1` becomes `.2`, etc.

---

## 16. Threat Model

### 16.1 Threats & Mitigations

| Threat | Severity | Mitigation |
|---|---|---|
| **Malicious local app reads credentials from disk** | Critical | Credentials stored in OS keychain (DPAPI/libsecret), not on disk. Data files encrypted with AES-256-GCM. |
| **Malicious local app impersonates a trusted app** | High | Process verification (PID → path → signature) binds tokens to specific executables. Consent dialog shows process identity. |
| **Malicious local app floods the API** | Medium | Per-token rate limiting (60 RPM / 10 burst). Rate limit violations logged. |
| **Token theft (e.g., another process reads memory)** | High | Tokens are short-lived (1h). Process identity binding prevents use from a different process. Refresh tokens rotate on use. |
| **Man-in-the-middle on localhost** | Low | APIs bind to 127.0.0.1 only. Local loopback traffic does not traverse the network. |
| **Malicious website triggers DeepLink** | Medium | All DeepLink actions require explicit user confirmation via a topmost dialog. No silent actions. |
| **Encrypted data file tampered with** | Medium | AES-256-GCM provides authenticated encryption. Tampering is detected and the file is rejected. |
| **User tricked into approving malicious app** | Medium | Consent dialog shows full process path, signature status, and requested scopes. Red warning for full access. |
| **Stale sessions leak after account removal** | Medium | Account removal cascades: revokes all associated tokens, deletes keychain entries, and wipes session data. |
| **External network access to API** | Critical | Server binds to 127.0.0.1 exclusively. Connection source address is verified. |
| **Replay attack with stolen refresh token** | Medium | Refresh token rotation: each refresh invalidates the old token. If a stolen token is used, the legitimate user's next refresh fails, signaling compromise. |
| **Pipeline event leaking data across scopes** | High | Events are filtered through scope intersection before delivery. Only events matching the token's granted pipeline scopes and granted accounts are forwarded. |
| **SSE/WS connection exhaustion** | Medium | Maximum concurrent pipeline subscriptions per token (default: 3). Idle connections are closed after 5 minutes of no activity. |

### 16.2 Out of Scope

- Protecting against a fully compromised local OS (kernel-level rootkit, memory dumpers with admin privileges).
- VRChat API changes or rate limiting imposed by VRChat.
- User's VRChat account security (weak password, compromised email).

---

## 17. Project Structure

```
electron-app/
├── src/
│   ├── main/
│   │   ├── index.ts                  # App entry point, window creation, tray setup
│   │   └── lib/
│   │       ├── account-manager.ts    # VRChat account CRUD, session keep-alive
│   │       ├── vrchat-client.ts      # VRChat API wrapper using `vrchat` SDK
│   │       ├── credential-store.ts   # OS keychain interaction (keytar)
│   │       ├── data-store.ts         # Encrypted JSON file read/write
│   │       ├── token-manager.ts      # Token creation, validation, refresh, revocation
│   │       ├── scope-resolver.ts     # Scope matching & validation
│   │       ├── rate-limiter.ts       # Per-token rate limiting
│   │       ├── api-server.ts         # HTTP + WebSocket server (127.0.0.1:7642)
│   │       ├── pipeline-manager.ts   # VRChat pipeline connections + event routing
│   │       ├── sse-handler.ts        # SSE /events endpoint handler
│   │       ├── deeplink-handler.ts   # vrcsl:// protocol handler
│   │       ├── process-verifier.ts   # PID → path → signature verification
│   │       ├── audit-logger.ts       # Audit log writer with rotation
│   │       ├── auto-updater.ts       # GitHub release checker & updater
│   │       └── ipc-handlers.ts       # IPC handlers for renderer communication
│   ├── preload/
│   │   ├── index.ts                  # contextBridge API exposure
│   │   └── index.d.ts               # Type declarations for preload API
│   └── renderer/
│       └── src/
│           ├── main.ts               # Svelte app entry
│           ├── App.svelte            # Root component with tab navigation
│           ├── layout.css            # Global layout styles
│           ├── state/                # Svelte 5 rune-based global state
│           │   ├── accounts.svelte.ts    # Reactive account list + IPC sync
│           │   ├── registrations.svelte.ts# Reactive connected apps + IPC sync
│           │   ├── settings.svelte.ts    # Reactive settings + IPC sync
│           │   └── consent.svelte.ts     # Reactive consent request state
│           ├── components/
│           │   ├── AccountList.svelte        # Account management tab
│           │   ├── AccountCard.svelte        # Single account Card display
│           │   ├── AddAccountDialog.svelte   # Dialog: add account form + OTP input
│           │   ├── ConnectedApps.svelte      # Connected apps tab
│           │   ├── AppPermissionEditor.svelte# Dialog: edit scopes/accounts for an app
│           │   ├── ConsentDialog.svelte      # Topmost consent window content
│           │   ├── DeepLinkPicker.svelte     # Account picker RadioGroup for DeepLinks
│           │   ├── AuditLog.svelte           # Audit log Table with filters
│           │   ├── Settings.svelte           # Settings panel (Input, Switch)
│           │   └── TrayMenu.svelte           # (N/A — tray is main-process only)
│           └── components/ui/               # shadcn-svelte installed components
├── resources/                        # App icons, assets
├── build/                            # Build configuration
├── electron-builder.yml              # Packaging configuration
├── electron.vite.config.ts           # Vite configuration
├── package.json
└── tsconfig.json
```

---

## Appendix A: VRChat API Scope-to-Endpoint Mapping Reference

The scope resolver maps each incoming VRChat API request path and method to the required scope. The mapping follows this pattern:

```
HTTP Method + /api/1/{category}/...  →  vrchat.{category}.{action}
```

**Action mapping rules:**
- `GET` on a collection → `.list` (e.g., `GET /avatars` → `vrchat.avatars.list`)
- `GET` on a single resource → `.get` (e.g., `GET /avatars/{id}` → `vrchat.avatars.get`)
- `POST` (create) → `.create`
- `PUT` (update) → `.update`
- `DELETE` → `.delete`
- Custom actions are mapped explicitly (e.g., `PUT /users/{id}/avatar` → `vrchat.avatars.select`)

The full mapping table is maintained in `scope-resolver.ts` and should be updated when the VRChat API adds new endpoints.

---

## Appendix B: IPC API (Preload Bridge)

The preload script exposes a strictly typed API to the renderer via `contextBridge.exposeInMainWorld`:

```typescript
interface VRCSLBridge {
  // Accounts
  getAccounts(): Promise<AccountInfo[]>
  addAccount(credentials: { username: string; password: string }): Promise<AddAccountResult>
  submitTwoFactor(accountId: string, code: string): Promise<TwoFactorResult>
  removeAccount(accountId: string): Promise<void>

  // Connected Apps
  getRegistrations(): Promise<AppRegistration[]>
  updateRegistration(regId: string, changes: RegistrationUpdate): Promise<void>
  revokeRegistration(regId: string): Promise<void>

  // Audit Log
  getAuditLog(filter?: AuditLogFilter): Promise<AuditLogEntry[]>

  // Settings
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<void>

  // Consent Dialog (used by consent window)
  getConsentRequest(): Promise<ConsentRequest>
  respondToConsent(response: ConsentResponse): Promise<void>

  // Events
  onAccountStatusChanged(callback: (accountId: string, status: string) => void): void
  onConsentRequested(callback: (request: ConsentRequest) => void): void
  onUpdateAvailable(callback: (version: string) => void): void
}
```

---

*End of PDR v1*