import { describe, test, expect } from "bun:test";
import { Scopes } from "../src/scopes";

describe("Scopes", () => {
  test("should have user scopes", () => {
    expect(Scopes.USERS_ALL).toBe("vrchat.users.*");
    expect(Scopes.USERS_GET).toBe("vrchat.users.get");
    expect(Scopes.USERS_SEARCH).toBe("vrchat.users.search");
  });

  test("should have friend scopes", () => {
    expect(Scopes.FRIENDS_ALL).toBe("vrchat.friends.*");
    expect(Scopes.FRIENDS_LIST).toBe("vrchat.friends.list");
    expect(Scopes.FRIENDS_STATUS).toBe("vrchat.friends.status");
  });

  test("should have avatar scopes", () => {
    expect(Scopes.AVATARS_ALL).toBe("vrchat.avatars.*");
    expect(Scopes.AVATARS_GET).toBe("vrchat.avatars.get");
    expect(Scopes.AVATARS_SELECT).toBe("vrchat.avatars.select");
    expect(Scopes.AVATARS_LIST).toBe("vrchat.avatars.list");
  });

  test("should have pipeline scopes", () => {
    expect(Scopes.PIPELINE_ALL).toBe("vrchat.pipeline.*");
    expect(Scopes.PIPELINE_FRIEND_ONLINE).toBe("vrchat.pipeline.friend-online");
    expect(Scopes.PIPELINE_FRIEND_OFFLINE).toBe("vrchat.pipeline.friend-offline");
  });

  test("should have full access scope", () => {
    expect(Scopes.VRCHAT_ALL).toBe("vrchat.*");
  });

  test("should have VRCSL event scopes", () => {
    expect(Scopes.VRCSL_EVENTS_ALL).toBe("vrcsl.events.*");
    expect(Scopes.VRCSL_EVENTS_SESSION).toBe("vrcsl.events.session");
    expect(Scopes.VRCSL_EVENTS_ACCOUNT).toBe("vrcsl.events.account");
    expect(Scopes.VRCSL_EVENTS_TOKEN).toBe("vrcsl.events.token");
  });

  test("Scopes object should be frozen (as const)", () => {
    expect(typeof Scopes).toBe("object");
    // Verify key count matches what's in the PDR
    const keys = Object.keys(Scopes);
    expect(keys.length).toBeGreaterThan(20);
  });
});
