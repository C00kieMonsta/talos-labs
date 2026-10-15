import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_008 } from "../../src/rules/macos/tl-mac-008";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_008, [
  { name: "pass when on", state: HARDENED, status: "pass", keys: ["autoInstallOs"], kinds: ["enum"] },
  { name: "pass when unset", state: FRESH_INSTALL, status: "pass", keys: ["autoInstallOs"], kinds: ["enum"] },
  {
    name: "fail when off",
    state: patchSection(HARDENED, "updates", { autoInstallOs: false }),
    status: "fail",
    keys: ["autoInstallOs"],
    kinds: ["enum"],
  },
]);
