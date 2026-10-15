import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_003 } from "../../src/rules/macos/tl-mac-003";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_003, [
  { name: "pass when stealth mode is on", state: HARDENED, status: "pass", keys: ["stealthMode"], kinds: ["bool"] },
  { name: "fail when stealth mode is off", state: DEV_MACHINE, status: "fail", keys: ["stealthMode"], kinds: ["bool"] },
  {
    name: "not applicable when the OS has no stealth mode",
    state: patchSection(HARDENED, "firewall", { stealthMode: null }),
    status: "not_applicable",
    keys: [],
  },
]);
