import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_017 } from "../../src/rules/macos/tl-mac-017";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_017, [
  {
    name: "pass when the policy requires 15 characters",
    state: HARDENED,
    status: "pass",
    keys: ["policySet", "minLength"],
    kinds: ["bool", "number"],
  },
  { name: "pass above 15", state: patchSection(HARDENED, "passwordPolicy", { minLength: 20 }), status: "pass" },
  {
    name: "review with the stock 4-character policy",
    state: DEV_MACHINE,
    status: "review",
    keys: ["policySet", "minLength"],
    kinds: ["bool", "number"],
  },
  { name: "review at 14", state: patchSection(HARDENED, "passwordPolicy", { minLength: 14 }), status: "review" },
  {
    name: "review when no policy is set",
    state: FRESH_INSTALL,
    status: "review",
    keys: ["policySet"],
    kinds: ["bool"],
  },
]);
