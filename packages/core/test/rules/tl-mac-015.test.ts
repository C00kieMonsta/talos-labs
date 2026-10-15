import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_015 } from "../../src/rules/macos/tl-mac-015";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_015, [
  { name: "pass when guest is off", state: HARDENED, status: "pass", keys: ["guestEnabled"], kinds: ["enum"] },
  { name: "pass when guest is unset", state: FRESH_INSTALL, status: "pass", keys: ["guestEnabled"], kinds: ["enum"] },
  {
    name: "fail when guest is on",
    state: patchSection(HARDENED, "accounts", { guestEnabled: true }),
    status: "fail",
    keys: ["guestEnabled"],
    kinds: ["enum"],
  },
]);
