import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_014 } from "../../src/rules/macos/tl-mac-014";
import { describeRule } from "../helpers";

describeRule(TL_MAC_014, [
  {
    name: "pass when the daily account is standard",
    state: HARDENED,
    status: "pass",
    keys: ["currentUserIsAdmin", "humanAdminCount"],
    kinds: ["bool", "number"],
  },
  {
    name: "fail when the daily account is an administrator",
    state: DEV_MACHINE,
    status: "fail",
    keys: ["currentUserIsAdmin", "humanAdminCount"],
    kinds: ["bool", "number"],
  },
]);
