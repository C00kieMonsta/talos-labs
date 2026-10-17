import type { SystemState } from "../domain/system-state";

/**
 * A fully hardened Mac. Every rule passes. Standard user, encrypted keys,
 * Time Machine backed up two hours before collection, Firefox only.
 *
 * Expected with the v0.3 catalog: 36 pass. Deducted 0, score 100, grade good,
 * complete true.
 */
export const HARDENED: SystemState = {
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
      data: { systemVolumeEncrypted: true, method: "filevault" },
    },
    firewall: {
      status: "ok",
      data: { enabled: true, stealthMode: true, blockAllIncoming: false },
    },
    platformIntegrity: {
      status: "ok",
      data: {
        execPolicyEnabled: true,
        systemProtectionEnabled: true,
        apps: { status: "ok", data: { bundleCount: 12, checkedCount: 12, flagged: [] } },
        inserts: { status: "ok", data: { dyldInsertSet: false, loginHookSet: false, launchdConfPresent: false } },
      },
    },
    malwareProtection: {
      status: "ok",
      data: { engine: "xprotect", present: true, version: "5311" },
    },
    updates: {
      status: "ok",
      data: {
        pendingCount: 0,
        lastCheckAt: "2026-10-15T06:00:00.000Z",
        lastResultCode: 2,
        automaticCheck: true,
        automaticDownload: true,
        autoInstallOs: true,
        autoInstallSecurityResponses: true,
        appStoreAutoUpdate: true,
      },
    },
    screenLock: {
      status: "ok",
      data: { requirePassword: true, delaySeconds: 0, screensaverIdleSeconds: 600 },
    },
    accounts: {
      status: "ok",
      data: {
        currentUserIsAdmin: false,
        humanAdminCount: 1,
        guestEnabled: false,
        autoLoginEnabled: false,
      },
    },
    passwordPolicy: {
      status: "ok",
      data: { minLength: 15, maxFailedAttempts: 10 },
    },
    listeners: {
      status: "ok",
      data: {
        entries: [
          { protocol: "tcp", port: 5000, bind: "all", processName: "ControlCenter", pid: 498 },
          { protocol: "tcp", port: 7000, bind: "all", processName: "ControlCenter", pid: 498 },
          { protocol: "tcp", port: 49312, bind: "all", processName: "rapportd", pid: 601 },
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
        remoteAppleEvents: { serviceLoaded: false, listeningPort: null },
        internetSharing: false,
        airdrop: "contacts_only",
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
        configured: true,
        destinationCount: 1,
        destinationReachable: true,
        lastBackupAt: "2026-10-15T07:30:00.000Z",
      },
    },
    browsers: {
      status: "ok",
      data: {
        installed: [
          {
            browser: "firefox",
            extensions: {
              status: "ok",
              data: [
                {
                  id: "{762f9885-5a13-4abd-9c77-433dcd38b8fd}",
                  name: "Return YouTube Dislike",
                  version: "3.0.0.18",
                  permissions: ["storage"],
                  broadHostAccess: false,
                },
              ],
            },
          },
        ],
      },
    },
    ssh: {
      status: "ok",
      data: {
        dirExists: true,
        dirMode: "700",
        keys: [{ path: "/Users/sam/.ssh/id_ed25519", format: "openssh", encrypted: true, mode: "600" }],
      },
    },
    dotfiles: {
      status: "ok",
      data: {
        scanned: ["/Users/sam/.zshrc", "/Users/sam/.zprofile"],
        unreadable: [],
        hits: [],
      },
    },
  },
};
