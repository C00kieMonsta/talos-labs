import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_002 } from "../../src/rules/macos/tl-mac-002";
import { describeRule } from "../helpers";

describeRule(TL_MAC_002, [
  { name: "pass when the firewall is on", state: HARDENED, status: "pass", keys: ["enabled"], kinds: ["bool"] },
  { name: "fail when the firewall is off", state: DEV_MACHINE, status: "fail", keys: ["enabled"], kinds: ["bool"] },
]);
