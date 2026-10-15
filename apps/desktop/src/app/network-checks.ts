import type { RuleStatus, ScanReport, SectionKey, UnknownReason } from "@talos/core";

/** Sections read from the kernel socket table. remoteAccess and fileSharing reuse the listeners result. */
export const SOCKET_TABLE_SECTIONS: readonly SectionKey[] = ["listeners", "remoteAccess", "fileSharing"];

/**
 * True when the listeners collector saw an empty socket table. The only producer of
 * permission_denied for that section is the empty-table case macOS gives unsigned builds.
 */
export function socketTableHidden(report: ScanReport): boolean {
  const listeners = report.sections.listeners;
  return listeners.status === "unavailable" && listeners.reason === "permission_denied";
}

/** True when this finding is unknown only because the socket table was hidden. */
export function hiddenBySocketTable(
  report: ScanReport,
  finding: { readonly status: RuleStatus; readonly unknownReason: UnknownReason | null; readonly requires: readonly SectionKey[] },
): boolean {
  return (
    socketTableHidden(report) &&
    finding.status === "unknown" &&
    finding.unknownReason === "permission_denied" &&
    finding.requires.some((key) => SOCKET_TABLE_SECTIONS.includes(key))
  );
}
