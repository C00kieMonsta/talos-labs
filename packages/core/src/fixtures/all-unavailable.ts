import type { SystemState } from "../domain/system-state";

/**
 * Every section unavailable, with all nine UnavailableReason values covered
 * so an engine test can assert that each rule's unknownReason is the reason
 * of its first required section.
 *
 * Expected with the v0.3 catalog: 36 unknown. Score null, grade null,
 * deducted 0, complete false.
 */
export const ALL_UNAVAILABLE: SystemState = {
  schemaVersion: 1,
  collectedAt: "2026-10-15T09:30:00.000Z",
  host: {
    os: "macos",
    osVersion: "27.0.1",
    osBuild: "26A434",
    arch: "arm64",
    collectorVersion: "0.1.0",
  },
  sections: {
    diskEncryption: { status: "unavailable", reason: "tool_missing", detail: "bin: fdesetup" },
    firewall: { status: "unavailable", reason: "timeout", detail: "bin: socketfilterfw" },
    platformIntegrity: { status: "unavailable", reason: "parse_error", detail: "parser: spctl" },
    malwareProtection: { status: "unavailable", reason: "collector_error", detail: null },
    updates: { status: "unavailable", reason: "permission_denied", detail: "read: com.apple.SoftwareUpdate" },
    screenLock: { status: "unavailable", reason: "parse_error", detail: "parser: sysadminctl" },
    accounts: { status: "unavailable", reason: "needs_admin", detail: "bin: dscl" },
    passwordPolicy: { status: "unavailable", reason: "tool_missing", detail: "bin: pwpolicy" },
    listeners: { status: "unavailable", reason: "timeout", detail: "bin: netstat" },
    remoteAccess: { status: "unavailable", reason: "parse_error", detail: "parser: launchctl" },
    fileSharing: { status: "unavailable", reason: "collector_error", detail: null },
    persistence: { status: "unavailable", reason: "permission_denied", detail: "read_dir: LaunchDaemons" },
    loginItems: { status: "unavailable", reason: "needs_automation_permission", detail: "osascript: -1743" },
    backup: { status: "unavailable", reason: "timeout", detail: "bin: tmutil" },
    browsers: { status: "unavailable", reason: "needs_full_disk_access", detail: "read_dir: Application Support" },
    ssh: { status: "unavailable", reason: "permission_denied", detail: "read_dir: .ssh" },
    dotfiles: { status: "unavailable", reason: "not_supported_on_os", detail: "fixture: covers every reason" },
  },
};
