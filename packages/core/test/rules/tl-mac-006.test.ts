import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_006 } from "../../src/rules/macos/tl-mac-006";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_006, [
  {
    name: "pass when XProtect is present with a version",
    state: HARDENED,
    status: "pass",
    keys: ["engine", "present", "version"],
    kinds: ["enum", "bool", "version"],
  },
  {
    name: "fail when the engine is absent",
    state: patchSection(HARDENED, "malwareProtection", { engine: "none", present: false, version: null }),
    status: "fail",
    keys: ["engine", "present"],
    kinds: ["enum", "bool"],
  },
  {
    name: "fail when present but the version could not be read",
    state: patchSection(HARDENED, "malwareProtection", { version: null }),
    status: "fail",
    keys: ["engine", "present"],
  },
  {
    name: "a version that does not look like a version stays local as text",
    state: patchSection(HARDENED, "malwareProtection", { version: "not a version!" }),
    status: "pass",
    keys: ["engine", "present", "version"],
    kinds: ["enum", "bool", "text"],
  },
]);
