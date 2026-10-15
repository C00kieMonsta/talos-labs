import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_001 } from "../../src/rules/macos/tl-mac-001";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_001, [
  {
    name: "pass when the system volume is encrypted",
    state: HARDENED,
    status: "pass",
    keys: ["systemVolumeEncrypted", "method"],
    kinds: ["bool", "enum"],
  },
  {
    name: "fail when the system volume is not encrypted",
    state: DEV_MACHINE,
    status: "fail",
    keys: ["systemVolumeEncrypted", "method"],
    kinds: ["bool", "enum"],
  },
  {
    name: "fail with method none",
    state: patchSection(HARDENED, "diskEncryption", { systemVolumeEncrypted: false, method: "none" }),
    status: "fail",
    keys: ["systemVolumeEncrypted", "method"],
  },
]);
