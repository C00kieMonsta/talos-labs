import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_013 } from "../../src/rules/macos/tl-mac-013";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_013, [
  {
    name: "pass at 10 minutes",
    state: HARDENED,
    status: "pass",
    keys: ["screensaverIdleSeconds"],
    kinds: ["number"],
  },
  {
    name: "pass when unset (OS default of 20 minutes)",
    state: DEV_MACHINE,
    status: "pass",
    keys: ["usesOsDefault"],
    kinds: ["bool"],
  },
  { name: "pass at exactly 20 minutes", state: patchSection(HARDENED, "screenLock", { screensaverIdleSeconds: 1200 }), status: "pass" },
  {
    name: "fail at 21 minutes",
    state: patchSection(HARDENED, "screenLock", { screensaverIdleSeconds: 1260 }),
    status: "fail",
    keys: ["screensaverIdleSeconds"],
    kinds: ["number"],
  },
  {
    name: "fail when the screen saver never starts (0)",
    state: patchSection(HARDENED, "screenLock", { screensaverIdleSeconds: 0 }),
    status: "fail",
    keys: ["screensaverIdleSeconds"],
  },
]);
