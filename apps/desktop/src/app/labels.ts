import type {
  AiAvailability,
  ExplainerProfile,
  Category,
  ExplainerFailure,
  FixEffort,
  FixSideEffect,
  Grade,
  LicenseInvalidReason,
  ProbeId,
  SectionKey,
  SettingsPane,
  Severity,
  UnknownReason,
} from "@talos/core";
import type { ScanError } from "../scan/machine";
import type { ConnectProvider } from "../scan/ai-connect";
import type { ExplainerProvider } from "../settings";

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
  good: "Your Mac is in good shape.",
  fair: "Your Mac is mostly protected.",
  poor: "Your Mac has gaps worth closing.",
  at_risk: "Your Mac is exposed.",
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
  needs_sign_in: "Your AI signed me out. Sign in again from Settings.",
  limit_reached: "Your AI allowance is used up for now. It comes back on its own.",
  provider_unavailable: "Your AI didn't answer. Try again in a little while.",
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

/** "17 October": the day a check was left alone. No year, no time. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(date);
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

/** The word and the button for each AI availability state in Settings. The action button is Apple-only; provider rows have their own buttons. */
export const AI_AVAILABILITY_LABELS: Readonly<Record<AiAvailability, { word: string; action: string | null }>> = {
  available: { word: "Ready", action: null },
  model_not_ready: { word: "Model downloading", action: null },
  apple_intelligence_not_enabled: { word: "Needs Apple Intelligence", action: "Open Apple Intelligence settings" },
  device_not_eligible: { word: "This Mac can't run it", action: null },
  helper_unavailable: { word: "Not available right now", action: "Try again" },
  not_connected: { word: "Not connected", action: null },
  connecting: { word: "Connecting", action: null },
  needs_sign_in: { word: "Needs sign-in", action: null },
  limit_reached: { word: "Limit reached", action: null },
  plan_not_eligible: { word: "Plan doesn't include this", action: null },
  provider_unavailable: { word: "Didn't answer", action: null },
  not_offered: { word: "Not available yet", action: null },
  off: { word: "Off", action: null },
};

/** The Settings pill word: a connected subscription reads "Connected", everything else as the table. */
export function aiPillWord(provider: ExplainerProvider, state: AiAvailability): string {
  if (state === "available") return provider === "chatgpt" || provider === "claude_plan" ? "Connected" : "Ready";
  return AI_AVAILABILITY_LABELS[state].word;
}

export const PROVIDER_NAMES: Readonly<Record<ExplainerProvider, string>> = {
  apple: "On this Mac",
  chatgpt: "ChatGPT",
  claude_plan: "Claude",
  claude: "Claude API key",
  ollama: "Local Ollama",
};

/** The plans a subscription route needs. */
export const PROVIDER_PLANS: Readonly<Record<ConnectProvider, string>> = {
  chatgpt: "Plus or Pro",
  claude_plan: "Pro or Max",
};

/** Under every AI text. Every provider is named and nothing is verified. */
export const AI_BADGES: Readonly<Record<ExplainerProvider, string>> = {
  apple: "Written on this Mac by Apple Intelligence. Not verified.",
  chatgpt: "Written by ChatGPT. Not verified.",
  claude_plan: "Written by Claude. Not verified.",
  claude: "Written by Claude. Not verified.",
  ollama: "Written by a local model. Not verified.",
};

export function aiBadge(provider: ExplainerProvider): string {
  return AI_BADGES[provider];
}

/** The expert sidebar row that opens the chat in the guided shell; the chat's own strings are CHAT in guided/copy.ts. */
export const CHAT_LABEL = "Chat";

export type AppleAiState = "device_not_eligible" | "apple_intelligence_not_enabled" | "model_not_ready" | "helper_unavailable";

/** The v0.2 lines for the Apple Intelligence states; they do not depend on the provider. */
export const AI_UNAVAILABLE_COPY: Readonly<Record<AppleAiState, string>> = {
  device_not_eligible: "AI explanations need Apple Intelligence, which this Mac can't run. Everything else works without it.",
  apple_intelligence_not_enabled: "Turn on Apple Intelligence to get explanations written for you on this Mac.",
  model_not_ready: "Apple Intelligence is still downloading its model. This finishes on its own; keep the Mac on Wi-Fi and plugged in.",
  helper_unavailable: "AI explanations aren't available right now.",
};

export const AI_OPEN_APPLE_SETTINGS = "Open Apple Intelligence settings";

export interface ProviderLines {
  readonly probing: string;
  /** The Overview card: the order is what it explains. */
  readonly notConnected: string;
  /** The finding and Ask cards, where there is no order. */
  readonly notConnectedFinding: string;
  readonly connecting: string;
  readonly needsSignIn: string;
  readonly limitReached: string;
  limitReachedAt(until: string): string;
  readonly planNotEligible: string;
  readonly providerUnavailable: string;
  readonly notOffered: string;
}

/** The AiCard and Explain panel lines for a provider's states, with its name filled in. */
export function providerLines(provider: ExplainerProvider): ProviderLines {
  const name = PROVIDER_NAMES[provider];
  const plans = provider === "chatgpt" || provider === "claude_plan" ? PROVIDER_PLANS[provider] : null;
  return {
    probing: provider === "apple" ? "Checking whether Apple Intelligence is available" : provider === "chatgpt" || provider === "claude_plan" ? `Checking whether ${name} is connected` : "Checking your AI",
    notConnected: "Get the order explained by the AI you already use.",
    notConnectedFinding: "Get this explained by the AI you already use.",
    connecting: `Waiting for you to sign in to ${name} in your browser.`,
    needsSignIn: `${name} signed me out.`,
    limitReached: `Your ${name} allowance is used up for now. It comes back on its own.`,
    limitReachedAt: (until) => `Your ${name} allowance is used up for now. It comes back at ${formatTime(until)}.`,
    planNotEligible: plans === null ? `That ${name} account's plan doesn't include this.` : `That ${name} account's plan doesn't include this. ${plans} is needed.`,
    providerUnavailable: `${name} didn't answer.`,
    notOffered: `${name} isn't available in this version yet.`,
  };
}

export const AI_ACTIONS = {
  connect: "Connect my AI",
  cancel: "Cancel",
  signInAgain: "Sign in again",
  chooseAnother: "Choose another",
  tryAgain: "Try again",
} as const;

/** The Settings "Your AI" section. */
export const YOUR_AI = {
  title: "Your AI",
  switch: "Explain things with my AI",
  sentence: "Talos Labs sends your AI a short summary of the check-up: which things passed or failed, and how you use your Mac. Never file names, paths, passwords or your computer's name.",
  change: "Change",
  disconnect: "Disconnect",
  disconnectFailed: "The sign-in couldn't be cleared. Try again.",
  claudeCodeLine: "Claude Code",
  chatgptClientLine: "ChatGPT client id",
  none: "None",
  notFetched: "not fetched",
  /** Under the Claude pill: one claude -p spawn per turn (DESIGN-CHAT section 6). */
  claudeSlow: "Claude takes a few seconds to start each answer, sometimes ten.",
} as const;

export type PermissionStatus = "granted" | "not_granted" | "not_determined" | "unknown";

export const PERMISSION_STATUS_LABELS: Readonly<Record<PermissionStatus, string>> = {
  granted: "Granted",
  not_granted: "Not granted",
  not_determined: "Not asked yet",
  unknown: "Could not tell",
};

export const PRIVACY_SENTENCE = "Nothing leaves this Mac. AI explanations are written here by Apple Intelligence.";
export const PRIVACY_SENTENCE_REMOTE =
  "Your check-up and your fixes never leave this Mac. With ChatGPT or Claude connected, Talos Labs sends them a short summary of the results and nothing else.";

/** The About sentence: the v0.2 line for On this Mac, the two-part statement for every other provider. */
export function privacySentence(provider: ExplainerProvider): string {
  return provider === "apple" ? PRIVACY_SENTENCE : PRIVACY_SENTENCE_REMOTE;
}

/** The sidebar row and the toolbar back label that lead to the guided check-up. */
export const CHECKUP_LABEL = "Check-up";
export const CHECKUP_SETTINGS = {
  title: "Check-up",
  autoScan: "Check my Mac when I open Talos Labs",
  home: "Start on the guided check-up",
  sentence: "With these off, Talos Labs opens on the Overview and waits for you.",
  chatHome: "Start with the chat when my AI is connected",
  chatHomeSentence: "Off shows the step-by-step check-up first. The chat stays one tap away.",
} as const;

/** The badge under a watch suggestion that came from the fixed rules, not a model. */
export const DECIDED_BY_APP = "Decided by the app itself";

/** Plain area names for the watch window's "I couldn't check" hover title, one per probe. */
export const WATCH_PROBE_LABELS: Readonly<Record<ProbeId, string>> = {
  "probe.platform_integrity": "system protection",
  "probe.firewall": "the firewall",
  "probe.malware_protection": "built-in malware protection",
  "probe.remote_access": "remote access",
  "probe.file_sharing": "file sharing",
  "probe.listeners": "network services",
  "probe.accounts": "user accounts",
  "probe.persistence": "background programs",
  "probe.persistence_signatures": "background program signatures",
  "probe.network_config": "network settings",
  "probe.hosts": "website address overrides",
  "probe.profiles": "profiles",
  "probe.system_extensions": "system extensions",
  "probe.backup": "backups",
  "probe.lockdown_mode": "Lockdown Mode",
  "probe.sudo_config": "administrator settings",
  "probe.ssh_keys": "login keys",
  "probe.host_metrics": "load and disk space",
  "probe.updates": "software updates",
  "probe.scheduled_jobs": "scheduled jobs",
  "probe.logins": "remote logins",
};
