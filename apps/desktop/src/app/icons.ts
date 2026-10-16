import type { Grade, SectionKey, Severity } from "@talos/core";
import {
  BrickWall,
  Bug,
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Cpu,
  DatabaseBackup,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FolderOpen,
  FolderSearch,
  Gauge,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  KeySquare,
  ListChecks,
  ListOrdered,
  LoaderCircle,
  Lock,
  LockKeyhole,
  LogIn,
  MessageCircleQuestionMark,
  Network,
  OctagonAlert,
  RefreshCw,
  Repeat,
  ScreenShare,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Square,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type { LucideIcon };

export type NavKey = "overview" | "findings" | "ask" | "settings";

export const NAV_ICONS: Readonly<Record<NavKey, LucideIcon>> = {
  overview: Gauge,
  findings: ListChecks,
  ask: MessageCircleQuestionMark,
  settings: Settings,
};

export const SECTION_ICONS: Readonly<Record<SectionKey, LucideIcon>> = {
  diskEncryption: HardDrive,
  firewall: BrickWall,
  platformIntegrity: ShieldCheck,
  malwareProtection: Bug,
  updates: RefreshCw,
  screenLock: LockKeyhole,
  accounts: Users,
  passwordPolicy: KeyRound,
  listeners: Network,
  remoteAccess: ScreenShare,
  fileSharing: FolderOpen,
  persistence: Repeat,
  loginItems: LogIn,
  backup: DatabaseBackup,
  browsers: Globe,
  ssh: KeySquare,
  dotfiles: FileCode,
};

export const SEVERITY_ICONS: Readonly<Record<Severity, LucideIcon>> = {
  critical: OctagonAlert,
  high: TriangleAlert,
  medium: CircleAlert,
  low: Info,
  info: Info,
};

export const GRADE_ICONS: Readonly<Record<Grade, LucideIcon>> = {
  good: ShieldCheck,
  fair: Shield,
  poor: ShieldAlert,
  at_risk: ShieldOff,
};

/** The fix-cost word on a card footer: how the fix is applied. */
export type FixCostKey = "in_app" | "deep_link" | "manual";

export const FIX_COST_ICONS: Readonly<Record<FixCostKey, LucideIcon>> = {
  in_app: Wrench,
  deep_link: ExternalLink,
  manual: ListOrdered,
};

/** Status and action icons by plain name. */
export const ICONS = {
  check: CircleCheck,
  warning: TriangleAlert,
  eye: Eye,
  eyeOff: EyeOff,
  question: CircleQuestionMark,
  spinner: LoaderCircle,
  lock: Lock,
  ai: Sparkles,
  fix: Wrench,
  external: ExternalLink,
  steps: ListOrdered,
  reveal: FolderSearch,
  download: Download,
  cpu: Cpu,
  alert: CircleAlert,
  stop: Square,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  close: X,
  copy: Copy,
  info: Info,
  password: KeyRound,
  clock: Clock,
  rescan: RefreshCw,
  brand: ShieldCheck,
} as const satisfies Readonly<Record<string, LucideIcon>>;

export type IconKey = keyof typeof ICONS;

/** Every lucide name the app relies on, for the export test. */
export const LUCIDE_NAMES: readonly string[] = [
  "Gauge", "ListChecks", "MessageCircleQuestionMark", "Settings",
  "HardDrive", "BrickWall", "ShieldCheck", "Bug", "RefreshCw", "LockKeyhole", "Users", "KeyRound", "Network",
  "ScreenShare", "FolderOpen", "Repeat", "LogIn", "DatabaseBackup", "Globe", "KeySquare", "FileCode",
  "CircleCheck", "TriangleAlert", "Eye", "CircleQuestionMark", "LoaderCircle", "Lock", "Sparkles", "Wrench",
  "ExternalLink", "ListOrdered", "FolderSearch", "Download", "Cpu", "CircleAlert", "Square", "ChevronRight",
  "ChevronLeft", "X", "Copy", "EyeOff", "Info", "OctagonAlert", "Shield", "ShieldAlert", "ShieldOff", "Clock",
];
