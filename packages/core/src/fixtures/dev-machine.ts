import type { SystemState } from "../domain/system-state";

/**
 * The observed dev machine (macOS 27.0.1, arm64). FileVault off, firewall off,
 * guest SMB share with port 445 bound, unencrypted SSH key plus a .pem at 600,
 * pending update, App Store auto-update off, screen lock immediate, admin
 * user, Gatekeeper and SIP on, no Time Machine, the stock 4-character password
 * policy, Chrome extensions blocked by TCC.
 *
 * Expected with the v0.1 catalog: 9 fail, 3 review, 1 unknown, 1 not
 * applicable, 17 pass. Deducted 62, score 38, grade at_risk, complete false.
 */
export const DEV_MACHINE: SystemState = {
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
        pendingCount: 1,
        lastCheckAt: "2026-10-14T22:10:12.000Z",
        lastResultCode: 2,
        automaticCheck: "unset",
        automaticDownload: true,
        autoInstallOs: true,
        autoInstallSecurityResponses: true,
        appStoreAutoUpdate: false,
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
        humanAdminCount: 2,
        guestEnabled: false,
        autoLoginEnabled: false,
      },
    },
    passwordPolicy: {
      status: "ok",
      data: { minLength: 4, maxFailedAttempts: null },
    },
    listeners: {
      status: "ok",
      data: {
        entries: [
          { protocol: "tcp", port: 5000, bind: "all", processName: "ControlCenter", pid: 515 },
          { protocol: "tcp", port: 7000, bind: "all", processName: "ControlCenter", pid: 515 },
          { protocol: "tcp", port: 55627, bind: "all", processName: "rapportd", pid: 612 },
          { protocol: "tcp", port: 445, bind: "all", processName: "launchd", pid: 1 },
          { protocol: "tcp", port: 5432, bind: "loopback", processName: "postgres", pid: 4821 },
          { protocol: "tcp", port: 5173, bind: "loopback", processName: "Code Helper (Plu", pid: 97251 },
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
      data: {
        enabled: true,
        shares: [{ path: "/Users/alice/Public", guestAccess: true }],
      },
    },
    persistence: {
      status: "ok",
      data: {
        items: [
          {
            scope: "system_daemon",
            plistPath: "/Library/LaunchDaemons/com.docker.vmnetd.plist",
            label: "com.docker.vmnetd",
            program: "/Library/PrivilegedHelperTools/com.docker.vmnetd",
            programExists: true,
            runAtLoad: true,
          },
          {
            scope: "user_agent",
            plistPath: "/Users/alice/Library/LaunchAgents/homebrew.mxcl.postgresql@16.plist",
            label: "homebrew.mxcl.postgresql@16",
            program: "/opt/homebrew/opt/postgresql@16/bin/postgres",
            programExists: true,
            runAtLoad: true,
          },
        ],
      },
    },
    loginItems: {
      status: "ok",
      data: { count: 2, names: ["Docker", "Raycast"] },
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
      data: {
        installed: [
          {
            browser: "chrome",
            extensions: {
              status: "unavailable",
              reason: "needs_full_disk_access",
              detail: "read_dir: Application Support/Google/Chrome",
            },
          },
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
        keys: [
          { path: "/Users/alice/.ssh/id_ed25519", format: "openssh", encrypted: false, mode: "600" },
          { path: "/Users/alice/.ssh/aws-eu-west-1.pem", format: "pem", encrypted: false, mode: "600" },
        ],
      },
    },
    dotfiles: {
      status: "ok",
      data: {
        scanned: [
          "/Users/alice/.zshrc",
          "/Users/alice/.zprofile",
          "/Users/alice/.npmrc",
          "/Users/alice/.aws/credentials",
          "/Users/alice/.docker/config.json",
        ],
        unreadable: [],
        hits: [],
      },
    },
  },
};
