import type { FixError, SectionKey } from "@talos/core";
import { AI_BADGES, AI_OPEN_APPLE_SETTINGS, AI_UNAVAILABLE_COPY, SECTION_LABELS } from "../app/labels";

/** Fixed strings of the guided flow. Every value is under the banned-word test. */

export const GUIDED_SECTION_LABELS: Readonly<Record<SectionKey, string>> = {
  ...SECTION_LABELS,
  ssh: "Checking your login keys",
  passwordPolicy: "Checking password settings",
  dotfiles: "Checking files for saved passwords",
};

export const WELCOME = {
  title: "Let's check your Mac.",
  body: "I'll look at your Mac's safety settings and fix what I can. Nothing leaves your Mac.",
  start: "Start",
  what: "What do you look at?",
  back: "Back",
  reads: "Disk encryption, firewall, updates, screen lock, network services and browser add-on permissions.",
  neverReads: "Your documents, photos, messages, passwords, browsing history or anything you type into macOS password dialogs.",
} as const;

export const SCANNING_TITLE = "Checking your Mac";
export const STOPPED = { title: "I stopped before finishing.", button: "Check again" } as const;
/** The guided home with the automatic check-up switched off, or reached before any check-up ran. */
export const READY = { title: "Ready when you are.", body: "I'll look at your Mac's safety settings and fix what I can.", button: "Check my Mac" } as const;
export const FAILED = {
  title: "I couldn't finish checking.",
  body: "Something went wrong on my side, not yours. Nothing was changed.",
  button: "Try again",
} as const;

export const PLAN = {
  go: "Let's go",
  list: "Show me the list",
  doThis: "I'll do this",
  showWhere: "I'll show you where",
  nothingMyself: "I found nothing to fix myself.",
  allSettings: "They all need a quick visit to System Settings. I'll show you where.",
  urgent: "One of these is urgent.",
} as const;

export const SINCE = { title: "Since last time.", carryOn: "Carry on" } as const;

export const BATCH = {
  password: "Your Mac will ask for your password once. That is macOS asking, not me, and I never see it.",
  button: "Fix these for me",
  later: "Do these later",
  carryOn: "Carry on",
  whatWillRun: "What will run",
} as const;

export const STATUS = {
  preparing: "Getting ready",
  password: "Your Mac is asking for your password. Then I'll get to work.",
  working: "Working",
  checking: "Checking it worked",
  /** The batch's status line while the password box is up; the password sentence is the headline then. */
  waiting: "Waiting for macOS",
} as const;

export const FIX = {
  canFix: "I can fix that for you.",
  password: "Your Mac will ask for your password.",
  noPassword: "No password is needed.",
  later: "Do this later",
  passphrase: "Add a password",
  showWhere: "Show me where",
  next: "Next",
  tryAgain: "Try again",
  checkAgain: "Check again",
  couldNotCheck: "I made the change but could not check it. I'll check next time you open me.",
} as const;

export const SHOW = {
  lead: "macOS has to do this one, so I'll open the right page and wait.",
  button: "Show me where",
  opened: "I've opened the right page.",
  notice: "I'll notice when it changes.",
  later: "I'll do it later",
  staleTitle: "It doesn't look changed yet.",
  staleBody: "The page is still open in System Settings.",
  restart: "Your Mac may restart. I'll carry on when you open me again.",
  carryOn: "I'll carry on when you open me again.",
  expiredNotice: "I'll ask about this again another day.",
} as const;

export const QUESTION = {
  ask: "Do you have a disk for backups?",
  yes: "Yes, show me where",
  no: "No, I'll get one later",
  flash: "A small external disk is enough. Plug it in and I'll help next time.",
} as const;

export const LATER_FLASH = "OK, I'll remind you another day.";

export const PERMISSION = {
  title: "Can I check your web browser too?",
  body: "macOS needs you to flip one switch so I can read which browser add-ons you have. I read nothing else.",
  button: "Show me where",
  notNow: "Not now",
  opened: "I've opened the right page.",
  where: "Find Talos Labs in the list and switch it on.",
  granted: "Done. I'll check your browser now.",
  nearly: "Nearly there.",
  reopenBody: "macOS applies this once Talos Labs reopens.",
  reopen: "Quit and reopen",
} as const;

export const PAYWALL = {
  body: "The full version does them all, explains everything with your own AI, and lets you ask questions.",
  buy: "Buy the full version, €24 a year",
  notNow: "Not now",
  thanks: "Thank you.",
  carrying: "Carrying on.",
} as const;

/** The Connect screen (DESIGN-AI section 4). */
export const CONNECT = {
  title: "Which AI do you use?",
  body: "I'll use it to explain what I find, in plain words. I send it a short summary of the check-up, never your files, passwords or your computer's name.",
  /** The status line while the offered providers are not known yet. */
  loading: "One moment.",
  rows: { chatgpt: "ChatGPT", claude_plan: "Claude", apple: "On this Mac" },
  plans: { chatgpt: "Plus or Pro", claude_plan: "Pro or Max", apple: "Apple Intelligence, no account" },
  notAvailable: "Not available yet",
  primary: { chatgpt: "Connect ChatGPT", claude_plan: "Connect Claude", apple: "Use this Mac" },
  notNow: "Not now",
  cancel: "Cancel",
  tryAgain: "Try again",
  chooseAnother: "Choose another",
  done: { chatgpt: "Done. ChatGPT is connected.", claude_plan: "Done. Claude is connected.", apple: "Done. I'll explain things on this Mac." },
} as const;

export const CONNECTING = {
  opened: { chatgpt: "I've opened ChatGPT in your browser.", claude_plan: "I've opened Claude in your browser." },
  body: "Sign in there and say yes when it asks. Then come back here.",
  status: "I'll notice when you're done.",
  fetchTitle: "Getting Claude ready.",
  fetchBody: "I'm fetching Claude's own helper from Anthropic. This happens once.",
  fetchStatus: "About a minute.",
  fetchFailedTitle: "I couldn't fetch Claude's helper.",
  fetchFailedBody: "Check your internet connection and try again.",
} as const;

export const CONNECT_FAILED = {
  closed: { title: "You stopped before signing in.", body: "Nothing was connected." },
  plan_not_eligible: {
    title: "That account's plan doesn't include this.",
    body: { chatgpt: "ChatGPT Plus or Pro is needed.", claude_plan: "Claude Pro or Max is needed." },
  },
  provider_unavailable: {
    title: { chatgpt: "ChatGPT didn't answer.", claude_plan: "Claude didn't answer." },
    body: "Nothing was connected. Try again in a little while.",
  },
  timeout: { title: "I stopped waiting.", body: "Nothing was connected." },
} as const;

/** The "Explain this" disclosure in every AI state. */
export const EXPLAIN = {
  open: "Explain this",
  stop: "Stop",
  checking: "Checking your AI.",
  notConnected: "Talos Labs can explain each of these using the AI you already pay for, ChatGPT or Claude. Nothing to install and no extra cost.",
  notConnectedApple: "Talos Labs can explain each of these using the AI you already pay for, ChatGPT, Claude, or Apple Intelligence on this Mac. Nothing to install and no extra cost.",
  connect: "Connect my AI",
  notNow: "Not now",
  waiting: "I'll notice when you're done.",
  signedOut: { chatgpt: "ChatGPT signed me out.", claude_plan: "Claude signed me out." },
  signInAgain: "Sign in again",
  limit: { chatgpt: "Your ChatGPT allowance is used up for now.", claude_plan: "Your Claude allowance is used up for now." },
  limitBack: "It comes back on its own.",
  limitBackAtPrefix: "It comes back at ",
  didNotAnswer: { chatgpt: "ChatGPT didn't answer.", claude_plan: "Claude didn't answer." },
  tryAgain: "Try again",
  locked: "Explaining everything is in the full version.",
  unlock: "Unlock",
  badge: AI_BADGES,
  /** The v0.2 Apple Intelligence lines, as on the expert card, when On this Mac cannot explain. */
  apple: AI_UNAVAILABLE_COPY,
  openAppleSettings: AI_OPEN_APPLE_SETTINGS,
  /** The chosen provider cannot be offered by this build and nothing else can be connected. */
  notOffered: { chatgpt: "ChatGPT isn't available in this version yet.", claude_plan: "Claude isn't available in this version yet." },
} as const;

export const END = {
  allDone: "Your Mac is in good shape.",
  nextTime: "I'll check again next time you open me.",
  partial: "Your Mac is safer than it was.",
  nothing: "Nothing needs fixing.",
  unreadableAll: "I couldn't check your Mac.",
  unreadableSome: "Nothing to fix in what I could check.",
  tryAgain: "I'll try again next time you open me.",
  didNotChange: "Did not change",
  waiting: "Still waiting",
  locked: "In the full version",
  leftAlone: "Things I left alone",
  technical: "For a technical person",
  checkAgain: "Check again",
  details: "Details",
  next: "Do this next",
  unreadable: "Couldn't check",
  biggestRisk: "That is the biggest risk left.",
  explained: "Get things explained",
  explainedSub: "Connect the AI you already use",
} as const;

/** The "Do this next" button, by what the step does. */
export const NEXT = { show: "Show me where", fix: "Fix it for me", unlock: "Unlock", details: "Details" } as const;

export const DONE_PREFIX = "Done. ";

/** The failure table for a batch (dialog-level) and a single fix. */
export interface FailureCopy {
  readonly title: string;
  readonly body: string | null;
  readonly primary: "try_again" | "show_where" | "next" | "check_again";
  readonly later: boolean;
}

export function failureCopy(error: FixError | "still_failing" | "unreadable", batch: boolean, hasPane: boolean): FailureCopy {
  const nothing = "Nothing was changed.";
  const instead = hasPane ? "I'll show you where to do it instead." : "I've left it alone.";
  switch (error) {
    case "cancelled":
      return { title: "You closed the password box.", body: nothing, primary: "try_again", later: true };
    case "wrong_password":
      return { title: "That password did not work.", body: nothing, primary: "try_again", later: true };
    case "timeout":
      return { title: "Your Mac did not answer.", body: batch ? nothing : "Nothing more was run.", primary: "try_again", later: true };
    case "command_failed":
      if (batch) return { title: "That did not work.", body: nothing, primary: "try_again", later: true };
      return { title: "That did not work.", body: instead, primary: hasPane ? "show_where" : "next", later: hasPane };
    case "invalid_choice":
    case "invalid_input":
    case "not_in_catalog":
      if (batch) return { title: "Let me look again.", body: null, primary: "try_again", later: true };
      return { title: "I can't do this one from here.", body: hasPane ? "I'll show you where instead." : "I've left it alone.", primary: hasPane ? "show_where" : "next", later: true };
    case "plan_expired":
    case "precondition_changed":
    case "busy":
      return { title: "Let me look again.", body: null, primary: "try_again", later: true };
    case "still_failing":
      return { title: "It ran, but the setting has not changed yet.", body: "macOS sometimes needs a moment.", primary: "check_again", later: true };
    case "unreadable":
      return { title: "I made the change but could not check it.", body: "I'll check next time you open me.", primary: "next", later: false };
  }
}
