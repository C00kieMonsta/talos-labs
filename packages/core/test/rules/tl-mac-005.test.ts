import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_005 } from "../../src/rules/macos/tl-mac-005";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_005, [
  { name: "pass when SIP is on", state: HARDENED, status: "pass", keys: ["systemProtectionEnabled"], kinds: ["bool"] },
  {
    name: "fail when SIP is off",
    state: patchSection(HARDENED, "platformIntegrity", { systemProtectionEnabled: false }),
    status: "fail",
    keys: ["systemProtectionEnabled"],
    kinds: ["bool"],
  },
  {
    name: "not applicable when the OS has no SIP",
    state: patchSection(HARDENED, "platformIntegrity", { systemProtectionEnabled: null }),
    status: "not_applicable",
    keys: [],
  },
]);
