import { describe, test, expect } from "bun:test";
import { DeepLink } from "../src/deeplink";

describe("DeepLink", () => {
  test("switchAvatar without accountIdx", () => {
    const url = DeepLink.switchAvatar("avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
    expect(url).toBe("vrcsl://switchavatar?avatarId=avtr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
  });

  test("switchAvatar with accountIdx", () => {
    const url = DeepLink.switchAvatar("avtr_xxx", 0);
    expect(url).toBe("vrcsl://switchavatar?avatarId=avtr_xxx&accountIdx=0");
  });

  test("joinWorld without instanceId", () => {
    const url = DeepLink.joinWorld("wrld_xxx");
    expect(url).toBe("vrcsl://joinworld?worldId=wrld_xxx");
  });

  test("joinWorld with instanceId", () => {
    const url = DeepLink.joinWorld("wrld_xxx", "12345~private(usr_xxx)");
    // URLSearchParams encodes ~ and () per spec
    expect(url).toBe(
      "vrcsl://joinworld?worldId=wrld_xxx&instanceId=12345%7Eprivate%28usr_xxx%29"
    );
  });

  test("joinWorld with instanceId and accountIdx", () => {
    const url = DeepLink.joinWorld("wrld_xxx", "12345", 1);
    expect(url).toBe("vrcsl://joinworld?worldId=wrld_xxx&instanceId=12345&accountIdx=1");
  });

  test("addFriend without accountIdx", () => {
    const url = DeepLink.addFriend("usr_yyy");
    expect(url).toBe("vrcsl://addfriend?userId=usr_yyy");
  });

  test("addFriend with accountIdx", () => {
    const url = DeepLink.addFriend("usr_yyy", 2);
    expect(url).toBe("vrcsl://addfriend?userId=usr_yyy&accountIdx=2");
  });

  test("open", () => {
    expect(DeepLink.open()).toBe("vrcsl://open");
  });
});
