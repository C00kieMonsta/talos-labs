import { describe, expect, it } from "vitest";
import type { ScanReport } from "@talos/core";
import { fakeFinding, fakeReport } from "./testing";
import { hiddenBySocketTable, socketTableHidden } from "./network-checks";

const ssh = fakeFinding({ ruleId: "TL-MAC-019", status: "unknown", unknownReason: "permission_denied", requires: ["remoteAccess", "listeners"] });
const dotfiles = fakeFinding({ ruleId: "TL-MAC-031", status: "unknown", unknownReason: "permission_denied", requires: ["dotfiles"] });
const firewall = fakeFinding({ ruleId: "TL-MAC-002", status: "fail", requires: ["firewall"] });

function withListeners(reason: "permission_denied" | "timeout" | null): ScanReport {
  const base = fakeReport([ssh, dotfiles, firewall]);
  const listeners = reason === null ? { status: "ok" as const } : { status: "unavailable" as const, reason };
  return { ...base, sections: { ...base.sections, listeners, remoteAccess: listeners, fileSharing: listeners } };
}

describe("socketTableHidden", () => {
  it("is true only when listeners is unavailable with permission_denied", () => {
    expect(socketTableHidden(withListeners("permission_denied"))).toBe(true);
    expect(socketTableHidden(withListeners("timeout"))).toBe(false);
    expect(socketTableHidden(withListeners(null))).toBe(false);
  });
});

describe("hiddenBySocketTable", () => {
  it("flags unknown findings that need a socket-table section", () => {
    const report = withListeners("permission_denied");
    expect(hiddenBySocketTable(report, ssh)).toBe(true);
  });

  it("keeps the generic reason for permission_denied in other sections", () => {
    const report = withListeners("permission_denied");
    expect(hiddenBySocketTable(report, dotfiles)).toBe(false);
    expect(hiddenBySocketTable(report, firewall)).toBe(false);
  });

  it("is false when the socket table was read", () => {
    expect(hiddenBySocketTable(withListeners(null), ssh)).toBe(false);
    expect(hiddenBySocketTable(withListeners("timeout"), { ...ssh, unknownReason: "timeout" })).toBe(false);
  });
});
