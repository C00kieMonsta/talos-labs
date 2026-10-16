import type { SectionKey, UnavailableReason } from "./system-state";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Points deducted from 100 for each failing rule. info never moves the score. */
export const SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = {
  critical: 20,
  high: 8,
  medium: 4,
  low: 2,
  info: 0,
};

export type Category =
  | "encryption"
  | "network"
  | "platform"
  | "updates"
  | "access_control"
  | "remote_access"
  | "sharing"
  | "persistence"
  | "backup"
  | "browser"
  | "developer";

export type RulePlatform = "MAC" | "WIN" | "LNX" | "ANY";

/** Stable id such as "TL-MAC-001". Never reused once published. */
export type RuleId = `TL-${RulePlatform}-${string}`;

/**
 * pass: the check holds.
 * fail: the check does not hold; costs points.
 * review: an info rule found something worth a look; costs nothing.
 * unknown: the rule could not decide.
 * not_applicable: the rule does not apply to this machine.
 */
export type RuleStatus = "pass" | "fail" | "review" | "unknown" | "not_applicable";

export type UnknownReason = UnavailableReason | "rule_error" | "indeterminate";

export type EvidenceUnit = "count" | "seconds" | "hours" | "days" | "port" | "chars";

/**
 * bool, number, enum and version may reach the explainer.
 * path and text are local-only and never leave the Finding.
 * enum values must come from the rule's evidenceVocabulary.
 */
export type EvidenceValue =
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "number"; readonly value: number; readonly unit: EvidenceUnit | null }
  | { readonly kind: "enum"; readonly value: string }
  | { readonly kind: "version"; readonly value: string }
  | { readonly kind: "path"; readonly value: string }
  | { readonly kind: "text"; readonly value: string };

export interface Evidence {
  /** Catalog-defined key, stable per rule. */
  readonly key: string;
  /** Catalog text shown in the UI. */
  readonly label: string;
  readonly value: EvidenceValue;
}

export type FixEffort = "two_minutes" | "ten_minutes" | "half_hour";

export type FixSideEffect = "none" | "restart" | "reauth" | "workflow";

/** Closed set of System Settings panes the app can open. Mapped to URLs in Rust. */
export type SettingsPane =
  | "filevault"
  | "firewall"
  | "security"
  | "software_update"
  | "lock_screen"
  | "users_groups"
  | "sharing"
  | "login_items"
  | "time_machine"
  | "full_disk_access"
  | "automation"
  | "apple_intelligence";

/**
 * A command shown to the user with a copy button. The app never runs it.
 * args may contain a {path} placeholder, filled from the path-kind evidence
 * entries of the same finding whose key equals appliesTo, never from model
 * output. The UI renders one command per matching entry.
 */
export interface FixCommand {
  readonly program: string;
  readonly args: readonly string[];
  readonly needsAdmin: boolean;
  /** true when the command prompts (ssh-keygen -p, sysadminctl -password -). */
  readonly interactive: boolean;
  /** Evidence key that feeds {path}. null when args hold no placeholder; rendered once. */
  readonly appliesTo: string | null;
}

/** What the webview must pick before an in-app fix can be planned. all_ssh_keys means Rust binds every key itself. */
export type FixApplyChoice = "none" | "share" | "ssh_key" | "all_ssh_keys";

/** How the app can act on this fix. Catalog-owned; the Rust FIX_CATALOG mirrors every in_app entry. */
export type FixApply =
  | {
      readonly kind: "in_app";
      readonly choice: FixApplyChoice;
      /** true when the fix needs a new passphrase typed in the app (029). */
      readonly passphrase: boolean;
      /** true when macOS will raise its administrator dialog. */
      readonly needsPassword: boolean;
      /** Sections re-read after the apply. */
      readonly recheck: readonly SectionKey[];
      /** Sheet title with a question mark, e.g. "Turn the firewall on?" */
      readonly confirmTitle: string;
      /** Verb for the primary button, e.g. "Turn on". The UI adds the ellipsis when a dialog follows. */
      readonly confirmVerb: string;
      /** Extra sentence for the sheet, or null. */
      readonly confirmNote: string | null;
      /** One line, or null when not reversible. */
      readonly reversible: string | null;
    }
  | {
      readonly kind: "deep_link";
      readonly pane: SettingsPane;
      /** Sections polled while the user is away in System Settings. */
      readonly watch: readonly SectionKey[];
      /** Seconds between polls while away. */
      readonly watchEvery: number;
      readonly reveal: "plist" | null;
    }
  | {
      readonly kind: "manual";
      /** Sections to poll after "Watch for the change" or a reveal; empty means no watcher. */
      readonly watch: readonly SectionKey[];
      readonly watchEvery: number;
      readonly reveal: "plist" | "file" | null;
    };

export interface Fix {
  /** One sentence, imperative. */
  readonly summary: string;
  /** Pane labels in order, e.g. ["System Settings", "Privacy & Security", "FileVault"]. */
  readonly settingsPath: readonly string[] | null;
  readonly settingsPane: SettingsPane | null;
  /** Zero or more commands, in display order. Rule 023 has one per launchd domain. */
  readonly commands: readonly FixCommand[];
  /** Ordered plain-language steps. */
  readonly steps: readonly string[];
  /** How the user confirms it worked. */
  readonly verify: string | null;
  readonly effort: FixEffort;
  readonly sideEffects: FixSideEffect;
  readonly apply: FixApply;
}

/** One row per catalog rule, in catalog order. Compact; carries no catalog text. */
export interface RuleResult {
  readonly ruleId: RuleId;
  readonly status: RuleStatus;
  readonly evidence: readonly Evidence[];
  readonly unknownReason: UnknownReason | null;
  /** Points the score gains when this rule is fixed. 0 unless status is fail. */
  readonly points: number;
}

/** A result that needs attention, with the catalog text attached for display. */
export interface Finding {
  readonly ruleId: RuleId;
  /** The positive statement of what is checked, from the rule. */
  readonly title: string;
  /**
   * Status-aware one-line headline for lists and cards. fail and review carry the
   * rule's failTitle; unknown carries "Couldn't check whether " plus the title.
   */
  readonly headline: string;
  readonly severity: Severity;
  readonly category: Category;
  readonly cis: string | null;
  readonly requires: readonly SectionKey[];
  readonly status: "fail" | "review" | "unknown";
  readonly evidence: readonly Evidence[];
  readonly unknownReason: UnknownReason | null;
  readonly points: number;
  /** Authored plain-language text. Shown with no LLM. */
  readonly explanation: string;
  readonly fix: Fix;
}
