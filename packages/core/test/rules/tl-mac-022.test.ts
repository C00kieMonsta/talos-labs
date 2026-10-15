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
    name: "fail when a share is open to guests and sharing is on",
    state: DEV_MACHINE,
    status: "fail",
    keys: ["enabled", "shareCount", "guestShareCount", "sharePath"],
    kinds: ["bool", "number", "number", "path"],
  },
  {
    name: "pass when sharing is on but no share admits guests",
    state: patchSection(HARDENED, "fileSharing", { enabled: true, shares: [{ path: "/Users/sam/Public", guestAccess: false }] }),
    status: "pass",
    keys: ["enabled", "shareCount", "guestShareCount"],
  },
  {
    name: "pass when a guest share exists but sharing is off",
    state: patchSection(HARDENED, "fileSharing", { enabled: false, shares: [{ path: "/Users/sam/Public", guestAccess: true }] }),
    status: "pass",
    keys: ["enabled", "shareCount", "guestShareCount", "sharePath"],
  },
]);
