import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_027 } from "../../src/rules/macos/tl-mac-027";
import { describeRule, patchSection, runRule } from "../helpers";

describeRule(TL_MAC_027, [
  {
    name: "pass when the last backup is two hours old",
    state: HARDENED,
    status: "pass",
    keys: ["hasBackup", "destinationReachable", "hoursSinceBackup"],
    kinds: ["bool", "bool", "number"],
  },
  {
    name: "pass at exactly 168 hours",
    state: patchSection(HARDENED, "backup", { lastBackupAt: "2026-10-08T09:30:00.000Z" }),
    status: "pass",
  },
  {
    name: "fail when the last backup is 8 days old",
    state: patchSection(HARDENED, "backup", { lastBackupAt: "2026-10-07T09:30:00.000Z" }),
    status: "fail",
    keys: ["hasBackup", "destinationReachable", "hoursSinceBackup"],
    kinds: ["bool", "bool", "number"],
  },
  {
    name: "fail when configured but never backed up",
    state: patchSection(HARDENED, "backup", { lastBackupAt: null, destinationReachable: false }),
    status: "fail",
    keys: ["hasBackup", "destinationReachable"],
    kinds: ["bool", "bool"],
  },
  { name: "not applicable when backups are not configured", state: DEV_MACHINE, status: "not_applicable", keys: [] },
  {
    name: "unknown (indeterminate) when the timestamp does not parse",
    state: patchSection(HARDENED, "backup", { lastBackupAt: "yesterday" }),
    status: "unknown",
    reason: "indeterminate",
  },
]);

describe("TL-MAC-027 measures against collectedAt, not ctx.now", () => {
  it("gives the same answer on a held state when now moves on", () => {
    const state = patchSection(HARDENED, "backup", { lastBackupAt: "2026-10-09T09:30:00.000Z" });
    const first = runRule(TL_MAC_027, state);
    const later = TL_MAC_027.evaluate(state, { now: "2027-01-01T00:00:00.000Z", os: "macos" });
    expect(first.status).toBe("pass");
    expect(later.status).toBe("pass");
    expect(later.evidence).toEqual(first.evidence);
  });
});
