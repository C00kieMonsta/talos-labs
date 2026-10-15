import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_001 } from "../../src/rules/macos/tl-mac-001";
import { describeRule, patchSection, runRule } from "../helpers";

describeRule(TL_MAC_001, [
  {
    name: "pass when the system volume is encrypted",
    state: HARDENED,
    status: "pass",
    keys: ["systemVolumeEncrypted", "method"],
    kinds: ["bool", "enum"],
  },
  {
    name: "fail when the system volume is not encrypted, with no method row",
    state: DEV_MACHINE,
    status: "fail",
    keys: ["systemVolumeEncrypted"],
    kinds: ["bool"],
  },
  {
    name: "fail with method none",
    state: patchSection(HARDENED, "diskEncryption", { systemVolumeEncrypted: false, method: "none" }),
    status: "fail",
    keys: ["systemVolumeEncrypted"],
  },
]);

describe("TL-MAC-001 evidence never contradicts itself", () => {
  it("drops the method row on fail even when the collector reports filevault for an unencrypted disk", () => {
    const state = patchSection(HARDENED, "diskEncryption", { systemVolumeEncrypted: false, method: "filevault" });
    const result = runRule(TL_MAC_001, state);
    expect(result.status).toBe("fail");
    expect(result.evidence).toEqual([
      { key: "systemVolumeEncrypted", label: "System disk encrypted", value: { kind: "bool", value: false } },
    ]);
  });

  it("keeps the method row on pass", () => {
    const result = runRule(TL_MAC_001, HARDENED);
    expect(result.evidence.map((entry) => entry.key)).toEqual(["systemVolumeEncrypted", "method"]);
  });
});
