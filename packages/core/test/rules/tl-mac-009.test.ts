import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_009 } from "../../src/rules/macos/tl-mac-009";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_009, [
  { name: "pass when on", state: HARDENED, status: "pass", keys: ["autoInstallSecurityResponses"], kinds: ["enum"] },
  { name: "pass when unset", state: FRESH_INSTALL, status: "pass", keys: ["autoInstallSecurityResponses"] },
  {
    name: "fail when off",
    state: patchSection(HARDENED, "updates", { autoInstallSecurityResponses: false }),
    status: "fail",
    keys: ["autoInstallSecurityResponses"],
    kinds: ["enum"],
  },
]);
