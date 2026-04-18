import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { VRCSLClient } from "../src/client";
import { VRCSLError } from "../src/error";
import { MemoryStore } from "../src/token-store";

describe("VRCSLClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("should start in disconnected state", () => {
    const client = new VRCSLClient({
      appName: "Test",
      tokenStore: false,
    });
    expect(client.state).toBe("disconnected");
    expect(client.activeTransport).toBeNull();
    expect(client.isAuthenticated).toBe(false);
  });

  test("connect with HTTP transport mode", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      tokenStore: false,
    });

    await client.connect();
    expect(client.state).toBe("connected");
    expect(client.activeTransport).toBe("http");
  });

  test("connect with auto mode establishes a transport", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      transport: "auto",
      tokenStore: false,
      connectionTimeout: 500,
    });

    await client.connect();
    expect(client.state).toBe("connected");
    // In auto mode, should connect via WS or fall back to HTTP
    expect(["ws", "http"]).toContain(client.activeTransport!);
  });

  test("disconnect resets state", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      tokenStore: false,
    });

    await client.connect();
    await client.disconnect();
    expect(client.state).toBe("disconnected");
    expect(client.activeTransport).toBeNull();
  });

  test("register stores tokens", async () => {
    const mockResponse = {
      token: "vrcsl_at_test",
      refreshToken: "vrcsl_rt_test",
      expiresIn: 3600,
      grantedScopes: ["vrchat.avatars.*"],
      grantedAccounts: [{ userId: "usr_xxx", displayName: "Test" }],
    };

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 })
    ) as unknown as typeof fetch;

    const store = new MemoryStore();
    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      tokenStore: store,
      scopes: ["vrchat.avatars.*"],
    });

    await client.connect();
    const result = await client.register();

    expect(result.token).toBe("vrcsl_at_test");
    expect(client.isAuthenticated).toBe(true);
    expect(store.get("vrcsl_token")).toBe("vrcsl_at_test");
    expect(store.get("vrcsl_refresh_token")).toBe("vrcsl_rt_test");
  });

  test("isAuthenticated with pre-supplied token", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_pre",
      tokenStore: false,
    });

    await client.connect();
    expect(client.isAuthenticated).toBe(true);
  });

  test("throws not_connected when calling api before connect", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      tokenStore: false,
    });

    try {
      await client.api("usr_xxx", "GET", "/test");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(VRCSLError);
      expect((err as VRCSLError).code).toBe("not_connected");
    }
  });

  test("throws not_authenticated when calling api without token", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      tokenStore: false,
    });

    await client.connect();

    try {
      await client.api("usr_xxx", "GET", "/test");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(VRCSLError);
      expect((err as VRCSLError).code).toBe("not_authenticated");
    }
  });

  test("api call with pre-supplied token", async () => {
    const mockResponse = { status: 200, data: { id: "avtr_xxx" } };

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 })
    ) as unknown as typeof fetch;

    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_test",
      tokenStore: false,
    });

    await client.connect();
    const result = await client.api("usr_xxx", "GET", "/avatars/avtr_xxx");
    expect(result.status).toBe(200);
  });

  test("auto-refresh on 401", async () => {
    let callCount = 0;

    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      const url = typeof _url === "string" ? _url : "";
      callCount++;

      // First API call → 401
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: "invalid_token", message: "Token expired" }),
          { status: 401 }
        );
      }

      // Refresh call
      if (url.includes("/refresh")) {
        return new Response(
          JSON.stringify({
            token: "vrcsl_at_new",
            refreshToken: "vrcsl_rt_new",
            expiresIn: 3600,
          }),
          { status: 200 }
        );
      }

      // Retry API call
      return new Response(
        JSON.stringify({ status: 200, data: { success: true } }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_expired",
      refreshToken: "vrcsl_rt_valid",
      tokenStore: false,
    });

    await client.connect();
    const result = await client.api("usr_xxx", "GET", "/test");
    expect(result.data).toEqual({ success: true });
    expect(callCount).toBe(3); // 401 + refresh + retry
  });

  test("refresh emits token_expired when refresh fails", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_test",
      refreshToken: "vrcsl_rt_expired",
      tokenStore: false,
    });

    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ error: "invalid_token", message: "Refresh token expired" }),
        { status: 401 }
      )
    ) as unknown as typeof fetch;

    await client.connect();

    let tokenExpiredEmitted = false;
    client.on("token_expired", () => {
      tokenExpiredEmitted = true;
    });

    try {
      await client.refresh();
    } catch {
      // Expected
    }

    expect(tokenExpiredEmitted).toBe(true);
  });

  test("emits connected event on connect", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      tokenStore: false,
    });

    let connected = false;
    client.on("connected", () => {
      connected = true;
    });

    await client.connect();
    expect(connected).toBe(true);
  });

  test("emits disconnected event on disconnect", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      tokenStore: false,
    });

    await client.connect();

    let disconnected = false;
    client.on("disconnected", () => {
      disconnected = true;
    });

    await client.disconnect();
    expect(disconnected).toBe(true);
  });

  test("batch calls work via HTTP", async () => {
    const mockResponse = {
      responses: [
        { requestId: "1", status: 200, data: { name: "User" } },
        { requestId: "2", status: 200, data: { name: "World" } },
      ],
    };

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 })
    ) as unknown as typeof fetch;

    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_test",
      tokenStore: false,
    });

    await client.connect();
    const results = await client.batch([
      { requestId: "1", userId: "usr_xxx", method: "GET", path: "/users/usr_yyy" },
      { requestId: "2", userId: "usr_xxx", method: "GET", path: "/worlds/wrld_zzz" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].requestId).toBe("1");
  });
});
