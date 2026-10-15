import type { SystemState } from "../domain/system-state";

/**
 * A Mac straight out of the box with one admin account and nothing changed.
 * Every defaults key is "unset", Software Update has never run (pendingCount
 * null), no password policy, no SSH folder, no third-party browser.
 *
 * Expected with the v0.1 catalog: fail 001, 002, 003, 014, 026; review 017;
 * unknown 010 (indeterminate); not applicable 027, 028, 029, 030; the other
 * 20 pass. Deducted 36, score 59 after the critical cap (64 uncapped), grade
 * poor, cappedByCritical true, complete false.
 */
export const FRESH_INSTALL: SystemState = {
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
    diskEncryption: {
      status: "ok",
      data: { systemVolumeEncrypted: false, method: "none" },
    },
    firewall: {
      status: "ok",
      data: { enabled: false, stealthMode: false, blockAllIncoming: false },
    },
    platformIntegrity: {
      status: "ok",
      data: { execPolicyEnabled: true, systemProtectionEnabled: true },
    },
    malwareProtection: {
      status: "ok",
      data: { engine: "xprotect", present: true, version: "5311" },
    },
    updates: {
      status: "ok",
      data: {
        pendingCount: null,
        lastCheckAt: null,
        lastResultCode: null,
        automaticCheck: "unset",
        automaticDownload: "unset",
        autoInstallOs: "unset",
        autoInstallSecurityResponses: "unset",
        appStoreAutoUpdate: "unset",
      },
    },
    screenLock: {
      status: "ok",
      data: { requirePassword: true, delaySeconds: 0, screensaverIdleSeconds: "unset" },
    },
    accounts: {
      status: "ok",
      data: {
        currentUserIsAdmin: true,
        humanAdminCount: 1,
        guestEnabled: "unset",
        autoLoginEnabled: false,
      },
    },
    passwordPolicy: {
      status: "ok",
      data: { minLength: null, maxFailedAttempts: null },
    },
    listeners: {
      status: "ok",
      data: {
        entries: [
          { protocol: "tcp", port: 5000, bind: "all", processName: "ControlCenter", pid: 410 },
          { protocol: "tcp", port: 7000, bind: "all", processName: "ControlCenter", pid: 410 },
          { protocol: "tcp", port: 49200, bind: "all", processName: "rapportd", pid: 522 },
        ],
        processNamesComplete: true,
      },
    },
    remoteAccess: {
      status: "ok",
      data: {
        ssh: { serviceLoaded: false, listeningPort: null },
        screenSharing: { serviceLoaded: false, listeningPort: null },
        remoteManagement: { serviceLoaded: false, listeningPort: null },
      },
    },
    fileSharing: {
      status: "ok",
      data: { enabled: false, shares: [] },
    },
    persistence: {
      status: "ok",
      data: { items: [] },
    },
    loginItems: {
      status: "ok",
      data: { count: 0, names: [] },
    },
    backup: {
      status: "ok",
      data: {
        method: "time_machine",
        configured: false,
        destinationCount: 0,
        destinationReachable: null,
        lastBackupAt: null,
      },
    },
    browsers: {
      status: "ok",
      data: { installed: [] },
    },
    ssh: {
      status: "ok",
      data: { dirExists: false, dirMode: null, keys: [] },
    },
    dotfiles: {
      status: "ok",
      data: { scanned: [], unreadable: [], hits: [] },
    },
  },
};
