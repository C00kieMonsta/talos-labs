import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_022 } from "../../src/rules/macos/tl-mac-022";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_022, [
  {
    name: "pass when File Sharing is off",
    state: HARDENED,
    status: "pass",
    keys: ["enabled", "shareCount", "guestShareCount"],
    kinds: ["bool", "number", "number"],
  },
  {
    name: "fail when a share is open to Everyone and sharing is on",
    state: DEV_MACHINE,
    status: "fail",
    keys: ["enabled", "shareCount", "guestShareCount", "sharePath"],
    kinds: ["bool", "number", "number", "path"],
  },
  {
    name: "pass when sharing is on but no share is open to Everyone",
    state: patchSection(HARDENED, "fileSharing", { enabled: true, shares: [{ path: "/Users/sam/Public", guestAccess: false }] }),
    status: "pass",
    keys: ["enabled", "shareCount", "guestShareCount"],
  },
  {
    name: "pass when a share is open to Everyone but sharing is off",
    state: patchSection(HARDENED, "fileSharing", { enabled: false, shares: [{ path: "/Users/sam/Public", guestAccess: true }] }),
    status: "pass",
    keys: ["enabled", "shareCount", "guestShareCount", "sharePath"],
  },
]);

describe("TL-MAC-022 text matches what the rule reads", () => {
  it("cites 2.13.2 only and sends the user to the folder's Everyone setting", () => {
    expect(TL_MAC_022.cis).toBe("2.13.2");
    expect(TL_MAC_022.fix.settingsPane).toBe("sharing");
    expect(TL_MAC_022.fix.steps[0]).toContain("Everyone to No Access");
  });

  it("says the Users & Groups guest switch is not read", () => {
    expect(TL_MAC_022.fix.steps.some((step) => step.includes("does not read that switch"))).toBe(true);
    expect(TL_MAC_022.fix.settingsPath).not.toContain("Users & Groups");
  });
});
