import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_016 } from "../../src/rules/macos/tl-mac-016";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_016, [
  { name: "pass when automatic login is off", state: HARDENED, status: "pass", keys: ["autoLoginEnabled"], kinds: ["bool"] },
  {
    name: "fail when automatic login is on",
    state: patchSection(HARDENED, "accounts", { autoLoginEnabled: true }),
    status: "fail",
    keys: ["autoLoginEnabled"],
    kinds: ["bool"],
  },
]);
