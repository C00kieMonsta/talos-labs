import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_026 } from "../../src/rules/macos/tl-mac-026";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_026, [
  {
    name: "pass when configured with a destination",
    state: HARDENED,
    status: "pass",
    keys: ["method", "configured", "destinationCount"],
    kinds: ["enum", "bool", "number"],
  },
  {
    name: "fail when not configured",
    state: DEV_MACHINE,
    status: "fail",
    keys: ["method", "configured", "destinationCount"],
    kinds: ["enum", "bool", "number"],
  },
  {
    name: "fail when configured without a destination",
    state: patchSection(HARDENED, "backup", { configured: true, destinationCount: 0 }),
    status: "fail",
  },
]);
