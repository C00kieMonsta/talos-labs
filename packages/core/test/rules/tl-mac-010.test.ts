import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_010 } from "../../src/rules/macos/tl-mac-010";
import { describeRule } from "../helpers";

describeRule(TL_MAC_010, [
  { name: "pass when nothing is pending", state: HARDENED, status: "pass", keys: ["pendingCount"], kinds: ["number"] },
  { name: "fail when an update is waiting", state: DEV_MACHINE, status: "fail", keys: ["pendingCount"], kinds: ["number"] },
  {
    name: "unknown (indeterminate) when the Mac has never checked",
    state: FRESH_INSTALL,
    status: "unknown",
    reason: "indeterminate",
    keys: [],
  },
]);
