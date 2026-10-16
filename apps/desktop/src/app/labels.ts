import type {
  AiAvailability,
  ExplainerProfile,
  Category,
  ExplainerFailure,
  FixEffort,
  FixSideEffect,
  Grade,
  LicenseInvalidReason,
  SectionKey,
  SettingsPane,
  Severity,
  UnknownReason,
} from "@talos/core";
import type { ScanError } from "../scan/machine";

/** Shown while a section is being read. */
export const SECTION_PROGRESS_LABELS: Readonly<Record<SectionKey, string>> = {
  diskEncryption: "Checking disk encryption",
  firewall: "Checking your firewall",
  platformIntegrity: "Checking app and system protection",
  malwareProtection: "Checking built-in malware protection",
  updates: "Checking software updates",
  screenLock: "Checking the screen lock",
  accounts: "Checking user accounts",
  passwordPolicy: "Checking the password policy",
  listeners: "Checking open network ports",
  remoteAccess: "Checking remote access",
  fileSharing: "Checking file sharing",
  persistence: "Checking background programs",
  loginItems: "Checking login items",
  backup: "Checking backups",
  browsers: "Checking browser extensions",
  ssh: "Checking SSH keys",
  dotfiles: "Checking shell config files",
};

export const SECTION_LABELS: Readonly<Record<SectionKey, string>> = {
  diskEncryption: "Disk encryption",
  firewall: "Firewall",
  platformIntegrity: "App and system protection",
  malwareProtection: "Malware protection",
  updates: "Software updates",
  screenLock: "Screen lock",
  accounts: "User accounts",
  passwordPolicy: "Password policy",
  listeners: "Open network ports",
  remoteAccess: "Remote access",
  fileSharing: "File sharing",
  persistence: "Background programs",
  loginItems: "Login items",
  backup: "Backups",
  browsers: "Browser extensions",
  ssh: "SSH keys",
  dotfiles: "Shell config files",
};

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  encryption: "Encryption",
  network: "Network",
  platform: "Platform",
  updates: "Updates",
  access_control: "Access control",
  remote_access: "Remote access",
  sharing: "Sharing",
  persistence: "Background programs",
  backup: "Backup",
  browser: "Browser",
  developer: "Developer",
};

export const CATEGORY_ORDER: readonly Category[] = [
  "encryption",
  "network",
  "platform",
  "updates",
  "access_control",
  "remote_access",
  "sharing",
  "persistence",
  "backup",
  "browser",
  "developer",
];

export const GRADE_LABELS: Readonly<Record<Grade, string>> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  at_risk: "At risk",
};

export const GRADE_SUMMARY: Readonly<Record<Grade, string>> = {
  good: "Your Mac is in good shape. Keep it that way.",
  fair: "Your Mac is mostly protected. A few fixes would make it solid.",
  poor: "Your Mac has gaps worth closing. Start with the fixes below.",
  at_risk: "Your Mac is exposed. The fixes below make the biggest difference.",
};

export const UNKNOWN_REASON_LABELS: Readonly<Record<UnknownReason, string>> = {
  needs_full_disk_access: "Needs Full Disk Access",
  needs_automation_permission: "Needs permission to control System Events",
  needs_admin: "Needs an administrator account",
  permission_denied: "Permission was denied",
  tool_missing: "A system tool is missing",
  timeout: "Took too long to read",
  parse_error: "The result could not be read",
  not_supported_on_os: "Not supported on this system",
  collector_error: "Something went wrong while reading",
  rule_error: "This check hit an error",
  indeterminate: "Not enough information to decide",
};

/** Short label for a network check the kernel withheld from an unsigned build. */
export const SOCKET_TABLE_LABEL = "Not available in this build";

/** Shown in place of the permission_denied label when the socket table was hidden. */
export const SOCKET_TABLE_COPY =
  "This copy of Talos Labs is not signed, so macOS hides the list of network services from it. There is no permission to grant. Signed releases do not have this limit.";

/** The pane that grants the permission a reason names, if any. */
export function paneForReason(reason: UnknownReason | null): SettingsPane | null {
  if (reason === "needs_full_disk_access") return "full_disk_access";
  if (reason === "needs_automation_permission") return "automation";
  return null;
}

export const PERMISSION_COPY: Readonly<Record<"full_disk_access" | "automation", { title: string; body: string }>> = {
  full_disk_access: {
    title: "Full Disk Access",
    body: "Talos Labs needs Full Disk Access to read browser extension folders. Open Privacy & Security, find Full Disk Access, and switch on Talos Labs. Then run the check-up again.",
  },
  automation: {
    title: "Automation",
    body: "Talos Labs needs permission to ask System Events for your login items. Open Privacy & Security, choose Automation, and allow Talos Labs to control System Events. Then run the check-up again.",
  },
};

/**
 * Plain words for enum evidence values. Keyed by value only: "none" and "unknown" mean the same
 * under every key. Tri settings ("true", "false", "unset") read as Yes and No to match bool rows;
 * "unset" means macOS is on its default, which for these settings is the protective state.
 */
export const EVIDENCE_VALUE_LABELS: Readonly<Record<string, string>> = {
  true: "Yes",
  false: "No",
  unset: "Not set (macOS default)",
  none: "None",
  unknown: "Unknown",
  filevault: "FileVault",
  bitlocker: "BitLocker",
  luks: "LUKS",
  xprotect: "XProtect",
  defender: "Microsoft Defender",
  time_machine: "Time Machine",
  windows_backup: "Windows Backup",
  chrome: "Chrome",
  brave: "Brave",
  edge: "Edge",
  arc: "Arc",
  firefox: "Firefox",
  aws_access_key_id: "AWS access key id",
  aws_secret_access_key: "AWS secret access key",
  github_token: "GitHub token",
  npm_token: "npm token",
  netrc_password: ".netrc password",
  private_key_block: "Private key block",
  llm_api_key: "AI API key",
  slack_token: "Slack token",
  docker_auth: "Docker login",
  generic_secret_assignment: "Secret assignment",
};

export const EFFORT_LABELS: Readonly<Record<FixEffort, string>> = {
  two_minutes: "About two minutes",
  ten_minutes: "About ten minutes",
  half_hour: "About half an hour",
};

export const SIDE_EFFECT_LABELS: Readonly<Record<FixSideEffect, string>> = {
  none: "No side effects",
  restart: "Needs a restart",
  reauth: "You will need to sign in again",
  workflow: "May change how you work",
};

export const EXPLAINER_FAILURE_LABELS: Readonly<Record<ExplainerFailure, string>> = {
  not_configured: "No AI provider is set up. Choose one in Settings.",
  no_api_key: "No API key is saved. Add one in Settings.",
  network: "Could not reach the AI provider. Check your connection.",
  auth: "The AI provider rejected the API key.",
  timeout: "The AI provider took too long to answer.",
  rejected_output: "The answer did not pass our checks, so it was not shown.",
  refused: "The AI provider declined to answer.",
  unknown: "Something went wrong with the AI provider.",
  unavailable: "Apple Intelligence isn't available right now. Try again in a moment.",
  too_long: "This check-up is too long for the on-device model to read in one go.",
  cancelled: "The explanation was stopped before it finished.",
  busy: "Another explanation is still being written. Wait for it to finish.",
};

export const SCAN_ERROR_LABELS: Readonly<Record<ScanError, string>> = {
  collector_crashed: "The check-up stopped unexpectedly.",
  timeout: "The check-up took too long and was stopped.",
  schema_mismatch: "The check-up returned data this version cannot read.",
  cancelled: "You cancelled the check-up.",
};

export const LICENSE_INVALID_LABELS: Readonly<Record<LicenseInvalidReason, string>> = {
  format: "That does not look like a licence key.",
  signature: "The key is not signed by Talos Labs.",
  product: "The key is for a different product.",
  version: "The key format is newer than this app understands.",
  build_too_new: "The key does not cover this version of the app.",
  revoked: "The key has been revoked.",
};

export const URGENCY_LABELS = {
  today: "Today",
  this_week: "This week",
  when_convenient: "When convenient",
} as const;

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { timeStyle: "short" }).format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export const PROFILE_ROLE_LABELS: Readonly<Record<ExplainerProfile["role"], string>> = {
  individual: "For myself",
  freelancer: "As a freelancer",
  small_business: "In a small business",
};

export const PROFILE_TECHNICAL_LABELS: Readonly<Record<ExplainerProfile["technical"], string>> = {
  low: "Not very",
  medium: "Somewhat",
  high: "Very",
};

/** One line for the collapsed About you section, e.g. "Freelancer, somewhat technical, client data, laptop leaves home". */
export function summariseProfile(profile: ExplainerProfile): string {
  const role = { individual: "Personal use", freelancer: "Freelancer", small_business: "Small business" }[profile.role];
  const technical = { low: "not very technical", medium: "somewhat technical", high: "very technical" }[profile.technical];
  const data = profile.handlesClientData ? "client data" : "no client data";
  const laptop = profile.laptopLeavesHome ? "laptop leaves home" : "stays at home";
  return `${role}, ${technical}, ${data}, ${laptop}`;
}

/** The word and the button for each AI availability state in Settings. */
export const AI_AVAILABILITY_LABELS: Readonly<Record<AiAvailability, { word: string; action: string | null }>> = {
  available: { word: "Ready", action: null },
  model_not_ready: { word: "Model downloading", action: null },
  apple_intelligence_not_enabled: { word: "Needs Apple Intelligence", action: "Open Apple Intelligence settings" },
  device_not_eligible: { word: "This Mac can't run it", action: null },
  helper_unavailable: { word: "Not available right now", action: "Try again" },
  off: { word: "Off", action: null },
};

export type PermissionStatus = "granted" | "not_granted" | "not_determined" | "unknown";

export const PERMISSION_STATUS_LABELS: Readonly<Record<PermissionStatus, string>> = {
  granted: "Granted",
  not_granted: "Not granted",
  not_determined: "Not asked yet",
  unknown: "Could not tell",
};

export const PRIVACY_SENTENCE = "Nothing leaves this Mac. AI explanations are written here by Apple Intelligence.";
