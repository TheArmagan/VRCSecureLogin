import { describe, test, expect, beforeEach } from "bun:test";
import { MemoryStore } from "../src/token-store";

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  test("get returns null for missing key", () => {
    expect(store.get("missing")).toBeNull();
  });

  test("set and get", () => {
    store.set("key", "value");
    expect(store.get("key")).toBe("value");
  });

  test("set overwrites existing value", () => {
    store.set("key", "value1");
    store.set("key", "value2");
    expect(store.get("key")).toBe("value2");
  });

  test("remove deletes key", () => {
    store.set("key", "value");
    store.remove("key");
    expect(store.get("key")).toBeNull();
  });

  test("remove non-existent key is no-op", () => {
    store.remove("missing");
    expect(store.get("missing")).toBeNull();
  });
});
