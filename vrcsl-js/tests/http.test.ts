import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { HTTPTransport } from "../src/transport/http";
import { VRCSLError } from "../src/error";

const defaultOpts = {
  host: "127.0.0.1",
  port: 7642,
  connectionTimeout: 3000,
  requestTimeout: 15000,
};

describe("HTTPTransport", () => {
  let transport: HTTPTransport;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    transport = new HTTPTransport(defaultOpts);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("register sends POST /register", async () => {
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

    const result = await transport.register({
      appName: "Test",
      scopes: ["vrchat.avatars.*"],
    });

    expect(result.token).toBe("vrcsl_at_test");
    expect(result.refreshToken).toBe("vrcsl_rt_test");
    expect(result.grantedScopes).toEqual(["vrchat.avatars.*"]);
  });

  test("refresh sends POST /refresh", async () => {
    const mockResponse = {
      token: "vrcsl_at_new",
      refreshToken: "vrcsl_rt_new",
      expiresIn: 3600,
    };

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 })
    ) as unknown as typeof fetch;

    const result = await transport.refresh("vrcsl_rt_old");
    expect(result.token).toBe("vrcsl_at_new");
  });

  test("getAccounts sends GET /accounts with auth header", async () => {
    const mockResponse = {
      accounts: [
        { userId: "usr_xxx", displayName: "Player1", status: "online" },
      ],
    };

    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      expect(init.headers).toBeDefined();
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test_token");
      return new Response(JSON.stringify(mockResponse), { status: 200 });
    }) as unknown as typeof fetch;

    const accounts = await transport.getAccounts("test_token");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].userId).toBe("usr_xxx");
  });

  test("api sends POST /api", async () => {
    const mockResponse = { status: 200, data: { id: "avtr_xxx" } };

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 })
    ) as unknown as typeof fetch;

    const result = await transport.api("token", "usr_xxx", "GET", "/avatars/avtr_xxx");
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: "avtr_xxx" });
  });

  test("batch sends POST /api/batch", async () => {
    const mockResponse = {
      responses: [
        { requestId: "1", status: 200, data: {} },
        { requestId: "2", status: 200, data: {} },
      ],
    };

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify(mockResponse), { status: 200 })
    ) as unknown as typeof fetch;

    const results = await transport.batch("token", [
      { requestId: "1", userId: "usr_xxx", method: "GET", path: "/users/usr_yyy" },
      { requestId: "2", userId: "usr_xxx", method: "GET", path: "/worlds/wrld_zzz" },
    ]);
    expect(results).toHaveLength(2);
  });

  test("throws VRCSLError on error response", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({ error: "scope_denied", message: "Missing scope" }),
        { status: 403 }
      )
    ) as unknown as typeof fetch;

    try {
      await transport.api("token", "usr_xxx", "GET", "/avatars/avtr_xxx");
      expect(true).toBe(false); // Should not reach here
    } catch (err) {
      expect(err).toBeInstanceOf(VRCSLError);
      expect((err as VRCSLError).code).toBe("scope_denied");
      expect((err as VRCSLError).status).toBe(403);
    }
  });

  test("throws connection_failed on network error", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    try {
      await transport.api("token", "usr_xxx", "GET", "/test");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(VRCSLError);
      expect((err as VRCSLError).code).toBe("connection_failed");
    }
  });
});
