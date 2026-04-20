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

    // Mock successful accounts response for token validation during connect
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ accounts: [] }), { status: 200 })
    ) as unknown as typeof fetch;

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

      // Validation call during connect → 401
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: "invalid_token", message: "Token expired" }),
          { status: 401 }
        );
      }

      // Refresh call (during connect validation or auto-refresh)
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

      // Any other call (accounts validation after refresh, API calls)
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
    // connect: 1 (accounts → 401) + 2 (refresh → ok) = 2 calls
    expect(client.isAuthenticated).toBe(true);

    const result = await client.api("usr_xxx", "GET", "/test");
    expect(result.data).toEqual({ success: true });
    // + 3 (api call → ok) = 3 total
    expect(callCount).toBe(3);
  });

  test("refresh emits token_expired when refresh fails", async () => {
    // Mock successful accounts response for connect validation
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ accounts: [] }), { status: 200 })
    ) as unknown as typeof fetch;

    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_test",
      refreshToken: "vrcsl_rt_expired",
      tokenStore: false,
    });

    await client.connect();

    // Now mock all requests to return 401
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ error: "invalid_token", message: "Refresh token expired" }),
        { status: 401 }
      )
    ) as unknown as typeof fetch;

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

  test("createVRChatFetch proxies request through /api", async () => {
    let forwardedBody: unknown = null;

    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      const targetUrl = typeof url === "string" ? url : "";

      if (targetUrl.includes("/accounts")) {
        return new Response(JSON.stringify({ accounts: [] }), { status: 200 });
      }

      if (targetUrl.includes("/api")) {
        forwardedBody = JSON.parse(String(init?.body ?? "{}"));
        return new Response(
          JSON.stringify({ status: 200, data: { ok: true, source: "vrcsl" } }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }) as unknown as typeof fetch;

    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_test",
      tokenStore: false,
    });

    await client.connect();

    const vrchatFetch = client.createVRChatFetch("usr_xxx");
    const response = await vrchatFetch("https://api.vrchat.cloud/api/1/users/usr_yyy?foo=bar", {
      method: "POST",
      body: JSON.stringify({ ping: true }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, source: "vrcsl" });
    expect(forwardedBody).toEqual({
      userId: "usr_xxx",
      method: "POST",
      path: "/api/1/users/usr_yyy?foo=bar",
      body: { ping: true },
    });
  });

  test("createVRChatConfig returns configuration-compatible object", async () => {
    const client = new VRCSLClient({
      appName: "Test",
      tokenStore: false,
    });

    const config = client.createVRChatConfig("usr_xxx", {
      extra: { userAgent: "My Tool" },
    });

    expect(config.basePath).toBe("https://api.vrchat.cloud/api/1");
    expect(typeof config.fetchApi).toBe("function");
    expect(config.userAgent).toBe("My Tool");
  });

  test("register caches granted accounts to client.accounts", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          token: "vrcsl_at_test",
          refreshToken: "vrcsl_rt_test",
          expiresIn: 3600,
          grantedScopes: ["vrchat.users.get"],
          grantedAccounts: [
            { userId: "usr_a", displayName: "A" },
            { userId: "usr_b", displayName: "B" },
          ],
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      tokenStore: false,
    });

    await client.connect();
    await client.register();

    expect(client.accounts).toHaveLength(2);
    expect(client.accounts[0].userId).toBe("usr_a");
    expect(client.accounts[1].userId).toBe("usr_b");
  });

  test("getAccounts refreshes client.accounts cache", async () => {
    globalThis.fetch = mock(async (url: string) => {
      const targetUrl = typeof url === "string" ? url : "";

      if (targetUrl.includes("/accounts")) {
        return new Response(
          JSON.stringify({
            accounts: [{ userId: "usr_x", displayName: "X" }],
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }) as unknown as typeof fetch;

    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_test",
      tokenStore: false,
    });

    await client.connect();
    await client.getAccounts();

    expect(client.accounts).toEqual([{ userId: "usr_x", displayName: "X" }]);
  });

  test("vrchat(account) caches sdk instance by account userId", async () => {
    globalThis.fetch = mock(async (url: string) => {
      const targetUrl = typeof url === "string" ? url : "";
      if (targetUrl.includes("/accounts")) {
        return new Response(
          JSON.stringify({
            accounts: [
              { userId: "usr_a", displayName: "A" },
              { userId: "usr_b", displayName: "B" },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }) as unknown as typeof fetch;

    const client = new VRCSLClient({
      appName: "Test",
      transport: "http",
      token: "vrcsl_at_test",
      tokenStore: false,
    });

    const created: Array<{ userId: string }> = [];
    (client as unknown as {
      createVrchatClient: (userId: string) => Promise<{ userId: string }>;
    }).createVrchatClient = async (userId: string) => {
      const instance = { userId };
      created.push(instance);
      return instance;
    };

    await client.connect();
    await client.getAccounts();

    const byIndex = await client.vrchat(0);
    const byUserId = await client.vrchat("usr_a");
    const second = await client.vrchat(1);

    expect(byIndex).toBe(byUserId);
    expect((byIndex as unknown as { userId: string }).userId).toBe("usr_a");
    expect((second as unknown as { userId: string }).userId).toBe("usr_b");
    expect(created).toHaveLength(2);
  });
});
