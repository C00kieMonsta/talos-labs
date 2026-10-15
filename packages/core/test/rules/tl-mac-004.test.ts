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
