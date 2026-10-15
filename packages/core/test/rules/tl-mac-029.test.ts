import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_029 } from "../../src/rules/macos/tl-mac-029";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_029, [
  {
    name: "pass when every key has a passphrase",
    state: HARDENED,
    status: "pass",
    keys: ["keyCount", "unprotectedCount", "unrecognisedCount"],
    kinds: ["number", "number", "number"],
  },
  {
    name: "fail with two unprotected keys",
    state: DEV_MACHINE,
    status: "fail",
    keys: ["keyCount", "unprotectedCount", "unrecognisedCount", "keyPath", "keyPath"],
    kinds: ["number", "number", "number", "path", "path"],
  },
  {
    name: "an unrecognised header is not a failure",
    state: patchSection(HARDENED, "ssh", {
      keys: [{ path: "/Users/sam/.ssh/odd", format: "unknown", encrypted: null, mode: "600" }],
    }),
    status: "pass",
    keys: ["keyCount", "unprotectedCount", "unrecognisedCount"],
  },
  { name: "not applicable with no keys", state: FRESH_INSTALL, status: "not_applicable", keys: [] },
]);
