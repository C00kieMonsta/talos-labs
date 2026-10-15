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
    name: "fail when the disk is unreachable but the last known backup is 8 days old",
    state: patchSection(HARDENED, "backup", { lastBackupAt: "2026-10-07T09:30:00.000Z", destinationReachable: false }),
    status: "fail",
    keys: ["hasBackup", "destinationReachable", "hoursSinceBackup"],
  },
  {
    name: "fail when configured and reachable but never backed up",
    state: patchSection(HARDENED, "backup", { lastBackupAt: null, destinationReachable: true }),
    status: "fail",
    keys: ["hasBackup", "destinationReachable"],
    kinds: ["bool", "bool"],
  },
  {
    name: "fail when never backed up and reachability is unknown",
    state: patchSection(HARDENED, "backup", { lastBackupAt: null, destinationReachable: null }),
    status: "fail",
    keys: ["hasBackup"],
  },
  {
    name: "unknown (indeterminate) when the disk is unreachable and no backup time is known",
    state: patchSection(HARDENED, "backup", { lastBackupAt: null, destinationReachable: false }),
    status: "unknown",
    reason: "indeterminate",
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

describe("TL-MAC-027 explanation", () => {
  it("gives the reason a stale backup matters and says nothing about the check's own mechanics", () => {
    expect(TL_MAC_027.explanation).not.toMatch(/\b(this check|the check|could not tell|Time Machine's own records)\b/i);
    expect(TL_MAC_027.explanation).toMatch(/closes that gap\.$/);
  });
});
