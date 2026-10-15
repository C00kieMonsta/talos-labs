import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_012 } from "../../src/rules/macos/tl-mac-012";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_012, [
  {
    name: "pass when the password is required immediately",
    state: HARDENED,
    status: "pass",
    keys: ["requirePassword", "delaySeconds"],
    kinds: ["bool", "number"],
  },
  {
    name: "pass with a 5 second delay",
    state: patchSection(HARDENED, "screenLock", { delaySeconds: 5 }),
    status: "pass",
  },
  {
    name: "fail with a 6 second delay",
    state: patchSection(HARDENED, "screenLock", { delaySeconds: 6 }),
    status: "fail",
    keys: ["requirePassword", "delaySeconds"],
    kinds: ["bool", "number"],
  },
  {
    name: "fail when no password is required",
    state: patchSection(HARDENED, "screenLock", { requirePassword: false, delaySeconds: null }),
    status: "fail",
    keys: ["requirePassword"],
    kinds: ["bool"],
  },
]);
