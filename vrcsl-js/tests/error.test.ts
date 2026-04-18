import { describe, test, expect } from "bun:test";
import { VRCSLError } from "../src/error";

describe("VRCSLError", () => {
  test("should create error with code and message", () => {
    const err = new VRCSLError("invalid_token", "Token is invalid");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VRCSLError);
    expect(err.code).toBe("invalid_token");
    expect(err.message).toBe("Token is invalid");
    expect(err.status).toBeNull();
    expect(err.name).toBe("VRCSLError");
  });

  test("should create error with status code", () => {
    const err = new VRCSLError("scope_denied", "Missing scope", 403);
    expect(err.code).toBe("scope_denied");
    expect(err.message).toBe("Missing scope");
    expect(err.status).toBe(403);
  });

  test("should create SDK error without status", () => {
    const err = new VRCSLError("connection_failed", "Cannot connect");
    expect(err.status).toBeNull();
  });
});
