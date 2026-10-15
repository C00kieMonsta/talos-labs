import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_011 } from "../../src/rules/macos/tl-mac-011";
import { describeRule } from "../helpers";

describeRule(TL_MAC_011, [
  { name: "pass when on", state: HARDENED, status: "pass", keys: ["appStoreAutoUpdate"], kinds: ["enum"] },
  { name: "pass when unset", state: FRESH_INSTALL, status: "pass", keys: ["appStoreAutoUpdate"] },
  { name: "fail when off", state: DEV_MACHINE, status: "fail", keys: ["appStoreAutoUpdate"], kinds: ["enum"] },
]);
