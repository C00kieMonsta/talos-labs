/**
 * SystemState is the read-only snapshot a collector produces.
 *
 * Values are booleans, enums, counts, versions, ports, process names and
 * config-file paths. Never file contents, command output, secret values or
 * user document names. Fields marked "display-only" are shown in the UI and
 * persisted locally; they are structurally excluded from the explainer payload.
 *
 * Every section is a Section<T>, so a collector failure is data, not an
 * exception. Names are OS-neutral; a Windows or Linux collector fills the same
 * shape and uses null or "not_supported_on_os" where a concept does not exist.
 */

export type Os = "macos" | "windows" | "linux";
export type Arch = "arm64" | "x86_64";

/** Why a section could not be collected. Written by our code, never copied from output. */
export type UnavailableReason =
  | "needs_full_disk_access"
  | "needs_automation_permission"
  | "needs_admin"
  | "permission_denied"
  | "tool_missing"
  | "timeout"
  | "parse_error"
  | "not_supported_on_os"
  | "collector_error";

export interface SectionOk<T> {
  readonly status: "ok";
  readonly data: T;
}

export interface SectionUnavailable {
  readonly status: "unavailable";
  readonly reason: UnavailableReason;
  /** Fixed label chosen by the collector ("parser: netstat"), never command output. */
  readonly detail: string | null;
}

export type Section<T> = SectionOk<T> | SectionUnavailable;

export function isSectionOk<T>(section: Section<T>): section is SectionOk<T> {
  return section.status === "ok";
}

/** A setting that may be absent. "unset" means the rule applies the documented OS default. */
export type Tri = boolean | "unset";

export interface Host {
  readonly os: Os;
  readonly osVersion: string;
  readonly osBuild: string | null;
  readonly arch: Arch;
  readonly collectorVersion: string;
}

export type DiskEncryptionMethod = "filevault" | "bitlocker" | "luks" | "none" | "unknown";

export interface DiskEncryption {
  readonly systemVolumeEncrypted: boolean;
  readonly method: DiskEncryptionMethod;
}

export interface Firewall {
  readonly enabled: boolean;
  /** null when the OS has no such setting. */
  readonly stealthMode: boolean | null;
  readonly blockAllIncoming: boolean | null;
}

export interface PlatformIntegrity {
  /** Gatekeeper on macOS, SmartScreen on Windows. null when absent. */
  readonly execPolicyEnabled: boolean | null;
  /** System Integrity Protection on macOS. null on other platforms. */
  readonly systemProtectionEnabled: boolean | null;
}

export type MalwareEngine = "xprotect" | "defender" | "none";

export interface MalwareProtection {
  readonly engine: MalwareEngine;
  readonly present: boolean;
  /** Must match /^[0-9][0-9A-Za-z.-]{0,31}$/ to reach the explainer. */
  readonly version: string | null;
}

export interface Updates {
  /** macOS: LastUpdatesAvailable. null when the key is missing (never checked). */
  readonly pendingCount: number | null;
  /** ISO 8601. macOS: LastSuccessfulDate. */
  readonly lastCheckAt: string | null;
  readonly lastResultCode: number | null;
  /** macOS: AutomaticCheckEnabled. Missing key means on. */
  readonly automaticCheck: Tri;
  readonly automaticDownload: Tri;
  readonly autoInstallOs: Tri;
  /**
   * macOS: folds ConfigDataInstall and CriticalUpdateInstall.
   * Any key false gives false; both keys missing gives "unset"; otherwise true.
   */
  readonly autoInstallSecurityResponses: Tri;
  /** macOS: com.apple.commerce AutoUpdate. */
  readonly appStoreAutoUpdate: Tri;
}

export interface ScreenLock {
  /** false when sysadminctl reports "screenLock is off". */
  readonly requirePassword: boolean;
  /** 0 means immediately. null when requirePassword is false. */
  readonly delaySeconds: number | null;
  /** "unset" when the screensaver domain is missing (OS default, 20 minutes). */
  readonly screensaverIdleSeconds: number | "unset";
}

export interface Accounts {
  readonly currentUserIsAdmin: boolean;
  /** Admin group members excluding root and "_"-prefixed service accounts. */
  readonly humanAdminCount: number;
  readonly guestEnabled: Tri;
  readonly autoLoginEnabled: boolean;
}

export interface PasswordPolicy {
  /**
   * macOS: N from the first policyAttributePassword content matching `.{N,}`
   * under policyCategoryPasswordContent. null when no such policy is set.
   */
  readonly minLength: number | null;
  readonly maxFailedAttempts: number | null;
}

export type ListenerBind = "all" | "loopback" | "link_local" | "specific";

export interface Listener {
  readonly protocol: "tcp" | "udp";
  readonly port: number;
  readonly bind: ListenerBind;
  /** Display-only. Truncated by the OS (16 chars on macOS). */
  readonly processName: string | null;
  readonly pid: number | null;
}

export interface Listeners {
  readonly entries: readonly Listener[];
  /** false when process names could not be resolved for every entry. */
  readonly processNamesComplete: boolean;
}

export interface ServiceState {
  /**
   * macOS: from `launchctl print-disabled system`. "=> enabled" gives true;
   * "=> disabled" or absent (the plist ships Disabled) gives false; null when
   * the output did not parse. Rules then decide on listeningPort alone.
   */
  readonly serviceLoaded: boolean | null;
  /** Port bound on a non-loopback interface, or null. */
  readonly listeningPort: number | null;
}

export interface RemoteAccess {
  readonly ssh: ServiceState;
  /** Screen Sharing on macOS, RDP on Windows. */
  readonly screenSharing: ServiceState;
  /** Apple Remote Desktop. null on other platforms. */
  readonly remoteManagement: ServiceState | null;
}

export interface Share {
  /** Display-only. May contain the home directory name. The user-authored `name:` line is never collected. */
  readonly path: string;
  readonly guestAccess: boolean;
}

export interface FileSharing {
  /** true when a non-loopback TCP listener on 445 exists. `sharing -l` lists share points whether or not File Sharing is on. */
  readonly enabled: boolean;
  /** Configured share points, present even when enabled is false. */
  readonly shares: readonly Share[];
}

export type LaunchItemScope = "user_agent" | "system_agent" | "system_daemon";

export interface LaunchItem {
  readonly scope: LaunchItemScope;
  /** Display-only. */
  readonly plistPath: string;
  /** Display-only. */
  readonly label: string;
  /** Display-only. First of Program or ProgramArguments only; arguments are never collected. */
  readonly program: string | null;
  /** null when program is null. */
  readonly programExists: boolean | null;
  readonly runAtLoad: boolean;
}

export interface Persistence {
  /** Third-party items only. Apple-signed items under /System are out of scope. */
  readonly items: readonly LaunchItem[];
}

export interface LoginItems {
  readonly count: number;
  /** Display-only. */
  readonly names: readonly string[];
}

export type BackupMethod = "time_machine" | "windows_backup" | "none";

export interface Backup {
  readonly method: BackupMethod;
  readonly configured: boolean;
  readonly destinationCount: number;
  /** null when not configured. */
  readonly destinationReachable: boolean | null;
  /** ISO 8601. */
  readonly lastBackupAt: string | null;
}

export type BrowserId = "chrome" | "brave" | "edge" | "arc" | "firefox";

export interface BrowserExtension {
  /** Display-only. */
  readonly id: string;
  /** Display-only. */
  readonly name: string;
  /** Display-only. */
  readonly version: string;
  /** Display-only. Manifest permission names. */
  readonly permissions: readonly string[];
  /** true for all_urls or a wildcard host pattern. */
  readonly broadHostAccess: boolean;
}

export interface BrowserReport {
  readonly browser: BrowserId;
  /** Per-browser, so a TCC denial on Chrome does not hide Firefox. */
  readonly extensions: Section<readonly BrowserExtension[]>;
}

export interface Browsers {
  /** Browsers that are not installed are omitted. */
  readonly installed: readonly BrowserReport[];
}

export type SshKeyFormat = "openssh" | "pem" | "pkcs8" | "unknown";

export interface SshKey {
  /** Display-only. Always under the user's .ssh directory. Contents are never read into state. */
  readonly path: string;
  readonly format: SshKeyFormat;
  /** null when the header is not recognised. */
  readonly encrypted: boolean | null;
  /** Octal string such as "600". null on Windows. */
  readonly mode: string | null;
}

export interface Ssh {
  readonly dirExists: boolean;
  readonly dirMode: string | null;
  readonly keys: readonly SshKey[];
}

export type SecretPattern =
  | "aws_access_key_id"
  | "aws_secret_access_key"
  | "github_token"
  | "npm_token"
  | "netrc_password"
  | "private_key_block"
  | "llm_api_key"
  | "slack_token"
  | "docker_auth"
  | "generic_secret_assignment";

export interface SecretHit {
  /** Display-only. Config file path, never a user document. */
  readonly path: string;
  readonly pattern: SecretPattern;
  readonly line: number;
}

export interface Dotfiles {
  /** Display-only. */
  readonly scanned: readonly string[];
  /** Display-only. */
  readonly unreadable: readonly string[];
  /** The matched value is never collected. */
  readonly hits: readonly SecretHit[];
}

export interface SystemStateSections {
  readonly diskEncryption: Section<DiskEncryption>;
  readonly firewall: Section<Firewall>;
  readonly platformIntegrity: Section<PlatformIntegrity>;
  readonly malwareProtection: Section<MalwareProtection>;
  readonly updates: Section<Updates>;
  readonly screenLock: Section<ScreenLock>;
  readonly accounts: Section<Accounts>;
  readonly passwordPolicy: Section<PasswordPolicy>;
  readonly listeners: Section<Listeners>;
  readonly remoteAccess: Section<RemoteAccess>;
  readonly fileSharing: Section<FileSharing>;
  readonly persistence: Section<Persistence>;
  readonly loginItems: Section<LoginItems>;
  readonly backup: Section<Backup>;
  readonly browsers: Section<Browsers>;
  readonly ssh: Section<Ssh>;
  readonly dotfiles: Section<Dotfiles>;
}

export type SectionKey = keyof SystemStateSections;

/** Stable order used by progress UI, fixtures and the Rust contract test. */
export const SECTION_KEYS: readonly SectionKey[] = [
  "diskEncryption",
  "firewall",
  "platformIntegrity",
  "malwareProtection",
  "updates",
  "screenLock",
  "accounts",
  "passwordPolicy",
  "listeners",
  "remoteAccess",
  "fileSharing",
  "persistence",
  "loginItems",
  "backup",
  "browsers",
  "ssh",
  "dotfiles",
];

export interface SystemState {
  readonly schemaVersion: 1;
  /** ISO 8601. */
  readonly collectedAt: string;
  readonly host: Host;
  readonly sections: SystemStateSections;
}
