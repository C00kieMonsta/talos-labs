import type { SystemState } from "../domain/system-state";

const NOT_SUPPORTED = {
  status: "unavailable",
  reason: "not_supported_on_os",
  detail: "collector: windows",
} as const;

/**
 * What a first Windows collector could fill without new code paths:
 * BitLocker, Defender Firewall, SmartScreen and Defender. Every other
 * section is not_supported_on_os.
 *
 * Expected with the v0.1 catalog: 31 not_applicable, score null, grade null,
 * complete true.
 */
export const WINDOWS_MINIMAL: SystemState = {
  schemaVersion: 1,
  collectedAt: "2026-10-15T09:30:00.000Z",
  host: {
    os: "windows",
    osVersion: "11.0.26100",
    osBuild: "26100.4351",
    arch: "x86_64",
    collectorVersion: "0.1.0",
  },
  sections: {
    diskEncryption: {
      status: "ok",
      data: { systemVolumeEncrypted: true, method: "bitlocker" },
    },
    firewall: {
      status: "ok",
      data: { enabled: true, stealthMode: null, blockAllIncoming: null },
    },
    platformIntegrity: {
      status: "ok",
      data: { execPolicyEnabled: true, systemProtectionEnabled: null },
    },
    malwareProtection: {
      status: "ok",
      data: { engine: "defender", present: true, version: "1.431.100.0" },
    },
    updates: NOT_SUPPORTED,
    screenLock: NOT_SUPPORTED,
    accounts: NOT_SUPPORTED,
    passwordPolicy: NOT_SUPPORTED,
    listeners: NOT_SUPPORTED,
    remoteAccess: NOT_SUPPORTED,
    fileSharing: NOT_SUPPORTED,
    persistence: NOT_SUPPORTED,
    loginItems: NOT_SUPPORTED,
    backup: NOT_SUPPORTED,
    browsers: NOT_SUPPORTED,
    ssh: NOT_SUPPORTED,
    dotfiles: NOT_SUPPORTED,
  },
};
