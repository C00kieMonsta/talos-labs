import type { Grade, SectionKey, Severity } from "@talos/core";
import {
  Bug,
  ChevronLeft,
  CircleAlert,
  CircleQuestionMark,
  Copy,
  Cpu,
  Download,
  EyeOff,
  FileCode,
  FolderSearch,
  Globe,
  LoaderCircle,
  LogIn,
  OctagonAlert,
  Repeat,
  ScreenShare,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Square,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { IconComponent } from "../components/KitIcon";
import {
  AccountsIcon,
  AiIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BackupsIcon,
  CheckIcon,
  CheckUpIcon,
  ChevronRightIcon,
  CloseIcon,
  DeveloperIcon,
  DiskIcon,
  ExtensionsIcon,
  EyeIcon,
  FindingsIcon,
  FirewallIcon,
  InfoIcon,
  KeyIcon,
  LicenseIcon,
  ListIcon,
  LockIcon,
  MacIcon,
  NetworkIcon,
  OverviewIcon,
  PauseIcon,
  PrivacyIcon,
  ScreenLockIcon,
  SettingsIcon,
  SharingIcon,
  ShieldIcon,
  TerminalIcon,
  UpdatesIcon,
  WarningIcon,
  WatchIcon,
} from "../components/icons";

export type { IconComponent, LucideIcon };

export type NavKey = "overview" | "findings" | "ask" | "settings";

export const NAV_ICONS: Readonly<Record<NavKey, IconComponent>> = {
  overview: OverviewIcon,
  findings: FindingsIcon,
  ask: AiIcon,
  settings: SettingsIcon,
};

/* Kit icons where the kit has one; lucide (Bug, ScreenShare, Repeat, LogIn, Globe, FileCode) for the rest. */
export const SECTION_ICONS: Readonly<Record<SectionKey, IconComponent>> = {
  diskEncryption: DiskIcon,
  firewall: FirewallIcon,
  platformIntegrity: ShieldIcon,
  malwareProtection: Bug,
  updates: UpdatesIcon,
  screenLock: ScreenLockIcon,
  accounts: AccountsIcon,
  passwordPolicy: KeyIcon,
  listeners: NetworkIcon,
  remoteAccess: ScreenShare,
  fileSharing: SharingIcon,
  persistence: Repeat,
  loginItems: LogIn,
  backup: BackupsIcon,
  browsers: Globe,
  ssh: TerminalIcon,
  dotfiles: FileCode,
};

/* Critical and medium keep lucide's octagon and circle so the five levels read apart; the kit has only one warning triangle. */
export const SEVERITY_ICONS: Readonly<Record<Severity, IconComponent>> = {
  critical: OctagonAlert,
  high: WarningIcon,
  medium: CircleAlert,
  low: InfoIcon,
  info: InfoIcon,
};

/* One lucide family so the four grades share a shield outline; the kit has a single plain shield. */
export const GRADE_ICONS: Readonly<Record<Grade, IconComponent>> = {
  good: ShieldCheck,
  fair: Shield,
  poor: ShieldAlert,
  at_risk: ShieldOff,
};

/** The fix-cost word on a card footer: how the fix is applied. */
export type FixCostKey = "in_app" | "deep_link" | "manual";

export const FIX_COST_ICONS: Readonly<Record<FixCostKey, IconComponent>> = {
  in_app: Wrench,
  deep_link: ArrowUpRightIcon,
  manual: ListIcon,
};

/**
 * Status and action icons by plain name. Lucide stays only where the kit has no glyph:
 * eyeOff, question, spinner, fix, reveal, download, cpu, alert, stop, chevronLeft, copy.
 */
export const ICONS = {
  check: CheckIcon,
  warning: WarningIcon,
  eye: EyeIcon,
  eyeOff: EyeOff,
  question: CircleQuestionMark,
  spinner: LoaderCircle,
  lock: LockIcon,
  ai: AiIcon,
  fix: Wrench,
  external: ArrowUpRightIcon,
  steps: ListIcon,
  reveal: FolderSearch,
  download: Download,
  cpu: Cpu,
  alert: CircleAlert,
  stop: Square,
  pause: PauseIcon,
  chevronRight: ChevronRightIcon,
  chevronLeft: ChevronLeft,
  arrowLeft: ArrowLeftIcon,
  close: CloseIcon,
  copy: Copy,
  info: InfoIcon,
  password: KeyIcon,
  clock: WatchIcon,
  watch: WatchIcon,
  rescan: UpdatesIcon,
  checkup: CheckUpIcon,
  brand: CheckUpIcon,
  mac: MacIcon,
  privacy: PrivacyIcon,
  licence: LicenseIcon,
  developer: DeveloperIcon,
  terminal: TerminalIcon,
  extensions: ExtensionsIcon,
  shield: ShieldIcon,
} as const satisfies Readonly<Record<string, IconComponent>>;

export type IconKey = keyof typeof ICONS;

/** Every lucide name the app relies on, for the export test. */
export const LUCIDE_NAMES: readonly string[] = [
  "Bug", "ChevronLeft", "CircleAlert", "CircleQuestionMark", "Copy", "Cpu", "Download", "EyeOff", "FileCode", "FolderSearch",
  "Globe", "LoaderCircle", "LogIn", "OctagonAlert", "Repeat", "ScreenShare", "Shield", "ShieldAlert", "ShieldCheck", "ShieldOff",
  "Square", "Wrench",
];
