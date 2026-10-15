import { describe, expect, it } from "vitest";
import { unknownHeadline } from "../../src/engine/headline";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_004 } from "../../src/rules/macos/tl-mac-004";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_004, [
  { name: "pass when Gatekeeper is on", state: HARDENED, status: "pass", keys: ["execPolicyEnabled"], kinds: ["bool"] },
  {
    name: "fail when Gatekeeper is off",
    state: patchSection(HARDENED, "platformIntegrity", { execPolicyEnabled: false }),
    status: "fail",
    keys: ["execPolicyEnabled"],
    kinds: ["bool"],
  },
  {
    name: "not applicable when the OS has no execution policy",
    state: patchSection(HARDENED, "platformIntegrity", { execPolicyEnabled: null }),
    status: "not_applicable",
    keys: [],
  },
]);

describe("TL-MAC-004 text", () => {
  it("names who does the checking and matches the Allow applications from setting", () => {
    expect(TL_MAC_004.title).toBe("Only apps from known developers can open");
    expect(TL_MAC_004.failTitle).toBe("Apps from unknown developers can open");
    expect(unknownHeadline(TL_MAC_004.title)).toBe("Couldn't check whether only apps from known developers can open");
    for (const text of [TL_MAC_004.title, TL_MAC_004.failTitle]) {
      expect(text).not.toMatch(/\bchecked\b/i);
    }
  });
});
