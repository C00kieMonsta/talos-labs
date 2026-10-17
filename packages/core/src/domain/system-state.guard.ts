import {
  SECTION_KEYS,
  type AirdropMode,
  type Arch,
  type BackupMethod,
  type BrowserId,
  type DiskEncryptionMethod,
  type LaunchItemScope,
  type ListenerBind,
  type MalwareEngine,
  type Os,
  type SecretPattern,
  type SignatureWord,
  type SshKeyFormat,
  type SystemState,
  type UnavailableReason,
} from "./system-state";

/** Hand-written structural check so a collector's JSON is validated before it enters core. */

export class SystemStateGuardError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`SystemState guard: ${path}: ${detail}`);
    this.name = "SystemStateGuardError";
  }
}

const OS_VALUES: readonly Os[] = ["macos", "windows", "linux"];
const ARCH_VALUES: readonly Arch[] = ["arm64", "x86_64"];
export const UNAVAILABLE_REASONS: readonly UnavailableReason[] = [
  "needs_full_disk_access",
  "needs_automation_permission",
  "needs_admin",
  "permission_denied",
  "tool_missing",
  "timeout",
  "parse_error",
  "not_supported_on_os",
  "collector_error",
];
const DISK_METHODS: readonly DiskEncryptionMethod[] = ["filevault", "bitlocker", "luks", "none", "unknown"];
const AIRDROP_MODES: readonly AirdropMode[] = ["everyone", "contacts_only", "off", "unset"];
/** The closed signature words; watch-port.ts re-exports this list for the fishy Details. */
export const SIGNATURE_WORDS: readonly SignatureWord[] = ["apple", "app_store", "developer_id", "adhoc", "unsigned", "invalid"];
const MALWARE_ENGINES: readonly MalwareEngine[] = ["xprotect", "defender", "none"];
const BINDS: readonly ListenerBind[] = ["all", "loopback", "link_local", "specific"];
const PROTOCOLS: readonly string[] = ["tcp", "udp"];
const SCOPES: readonly LaunchItemScope[] = ["user_agent", "system_agent", "system_daemon"];
const BACKUP_METHODS: readonly BackupMethod[] = ["time_machine", "windows_backup", "none"];
const BROWSERS: readonly BrowserId[] = ["chrome", "brave", "edge", "arc", "firefox"];
const SSH_FORMATS: readonly SshKeyFormat[] = ["openssh", "pem", "pkcs8", "unknown"];
const SECRET_PATTERNS: readonly SecretPattern[] = [
  "aws_access_key_id",
  "aws_secret_access_key",
  "github_token",
  "npm_token",
  "netrc_password",
  "private_key_block",
  "llm_api_key",
  "slack_token",
  "docker_auth",
  "generic_secret_assignment",
];

type Check = (value: unknown, path: string) => void;

function fail(path: string, detail: string): never {
  throw new SystemStateGuardError(path, detail);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function bool(value: unknown, path: string): void {
  if (typeof value !== "boolean") {
    fail(path, "expected a boolean");
  }
}

function str(value: unknown, path: string): void {
  if (typeof value !== "string") {
    fail(path, "expected a string");
  }
}

function num(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "expected a finite number");
  }
}

function nullable(check: Check): Check {
  return (value, path) => {
    if (value !== null) {
      check(value, path);
    }
  };
}

function oneOf(allowed: readonly string[], label: string): Check {
  return (value, path) => {
    if (typeof value !== "string" || !allowed.includes(value)) {
      fail(path, `expected one of ${label}`);
    }
  };
}

function tri(value: unknown, path: string): void {
  if (value !== true && value !== false && value !== "unset") {
    fail(path, "expected true, false or \"unset\"");
  }
}

function list(check: Check): Check {
  return (value, path) => {
    if (!Array.isArray(value)) {
      fail(path, "expected an array");
    }
    value.forEach((item, index) => check(item, `${path}[${index}]`));
  };
}

function shape(fields: Readonly<Record<string, Check>>): Check {
  return (value, path) => {
    const obj = record(value, path);
    for (const [key, check] of Object.entries(fields)) {
      if (!(key in obj)) {
        fail(`${path}.${key}`, "missing");
      }
      check(obj[key], `${path}.${key}`);
    }
  };
}

function section(dataCheck: Check): Check {
  return (value, path) => {
    const obj = record(value, path);
    const status = obj["status"];
    if (status === "ok") {
      if (!("data" in obj)) {
        fail(`${path}.data`, "missing");
      }
      dataCheck(obj["data"], `${path}.data`);
      return;
    }
    if (status === "unavailable") {
      oneOf(UNAVAILABLE_REASONS, "UnavailableReason")(obj["reason"], `${path}.reason`);
      nullable(str)(obj["detail"], `${path}.detail`);
      return;
    }
    fail(`${path}.status`, "expected \"ok\" or \"unavailable\"");
  };
}

const serviceState = shape({ serviceLoaded: nullable(bool), listeningPort: nullable(num) });

const browserExtension = shape({
  id: str,
  name: str,
  version: str,
  permissions: list(str),
  broadHostAccess: bool,
});

const SECTION_CHECKS: Readonly<Record<(typeof SECTION_KEYS)[number], Check>> = {
  diskEncryption: section(shape({ systemVolumeEncrypted: bool, method: oneOf(DISK_METHODS, "DiskEncryptionMethod") })),
  firewall: section(shape({ enabled: bool, stealthMode: nullable(bool), blockAllIncoming: nullable(bool) })),
  platformIntegrity: section(
    shape({
      execPolicyEnabled: nullable(bool),
      systemProtectionEnabled: nullable(bool),
      apps: section(
        shape({
          bundleCount: num,
          checkedCount: num,
          flagged: list(shape({ path: str, name: str, signature: oneOf(SIGNATURE_WORDS, "SignatureWord"), quarantined: bool })),
        }),
      ),
      inserts: section(shape({ dyldInsertSet: bool, loginHookSet: bool, launchdConfPresent: bool })),
    }),
  ),
  malwareProtection: section(
    shape({ engine: oneOf(MALWARE_ENGINES, "MalwareEngine"), present: bool, version: nullable(str) }),
  ),
  updates: section(
    shape({
      pendingCount: nullable(num),
      lastCheckAt: nullable(str),
      lastResultCode: nullable(num),
      automaticCheck: tri,
      automaticDownload: tri,
      autoInstallOs: tri,
      autoInstallSecurityResponses: tri,
      appStoreAutoUpdate: tri,
    }),
  ),
  screenLock: section(
    shape({
      requirePassword: bool,
      delaySeconds: nullable(num),
      screensaverIdleSeconds: (value, path) => {
        if (value !== "unset") {
          num(value, path);
        }
      },
    }),
  ),
  accounts: section(
    shape({ currentUserIsAdmin: bool, humanAdminCount: num, guestEnabled: tri, autoLoginEnabled: bool }),
  ),
  passwordPolicy: section(shape({ minLength: nullable(num), maxFailedAttempts: nullable(num) })),
  listeners: section(
    shape({
      entries: list(
        shape({
          protocol: oneOf(PROTOCOLS, "tcp or udp"),
          port: num,
          bind: oneOf(BINDS, "ListenerBind"),
          processName: nullable(str),
          pid: nullable(num),
        }),
      ),
      processNamesComplete: bool,
    }),
  ),
  remoteAccess: section(
    shape({
      ssh: serviceState,
      screenSharing: serviceState,
      remoteManagement: nullable(serviceState),
      remoteAppleEvents: nullable(serviceState),
      internetSharing: tri,
      airdrop: oneOf(AIRDROP_MODES, "AirdropMode"),
    }),
  ),
  fileSharing: section(shape({ enabled: bool, shares: list(shape({ path: str, guestAccess: bool })) })),
  persistence: section(
    shape({
      items: list(
        shape({
          scope: oneOf(SCOPES, "LaunchItemScope"),
          plistPath: str,
          label: str,
          program: nullable(str),
          programExists: nullable(bool),
          runAtLoad: bool,
        }),
      ),
    }),
  ),
  loginItems: section(shape({ count: num, names: list(str) })),
  backup: section(
    shape({
      method: oneOf(BACKUP_METHODS, "BackupMethod"),
      configured: bool,
      destinationCount: num,
      destinationReachable: nullable(bool),
      lastBackupAt: nullable(str),
    }),
  ),
  browsers: section(
    shape({
      installed: list(
        shape({ browser: oneOf(BROWSERS, "BrowserId"), extensions: section(list(browserExtension)) }),
      ),
    }),
  ),
  ssh: section(
    shape({
      dirExists: bool,
      dirMode: nullable(str),
      keys: list(
        shape({
          path: str,
          format: oneOf(SSH_FORMATS, "SshKeyFormat"),
          encrypted: nullable(bool),
          mode: nullable(str),
        }),
      ),
    }),
  ),
  dotfiles: section(
    shape({
      scanned: list(str),
      unreadable: list(str),
      hits: list(shape({ path: str, pattern: oneOf(SECRET_PATTERNS, "SecretPattern"), line: num })),
    }),
  ),
};

const host = shape({
  os: oneOf(OS_VALUES, "Os"),
  osVersion: str,
  osBuild: nullable(str),
  arch: oneOf(ARCH_VALUES, "Arch"),
  collectorVersion: str,
});

/** Throws SystemStateGuardError naming the first bad path. */
export function assertSystemState(value: unknown): asserts value is SystemState {
  const root = record(value, "$");
  if (root["schemaVersion"] !== 1) {
    fail("$.schemaVersion", "expected 1");
  }
  str(root["collectedAt"], "$.collectedAt");
  host(root["host"], "$.host");
  const sections = record(root["sections"], "$.sections");
  for (const key of SECTION_KEYS) {
    if (!(key in sections)) {
      fail(`$.sections.${key}`, "missing");
    }
    SECTION_CHECKS[key](sections[key], `$.sections.${key}`);
  }
}

export function isSystemState(value: unknown): value is SystemState {
  try {
    assertSystemState(value);
    return true;
  } catch (error) {
    if (error instanceof SystemStateGuardError) {
      return false;
    }
    throw error;
  }
}
