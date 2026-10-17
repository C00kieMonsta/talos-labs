import type { FishyKind, FixError, GatedKind, SectionKey, SignatureWord } from "@talos/core";
import { AI_BADGES, AI_OPEN_APPLE_SETTINGS, AI_UNAVAILABLE_COPY, SECTION_LABELS } from "../app/labels";

/** Fixed strings of the guided flow. Every value is under the banned-word test. */

export const GUIDED_SECTION_LABELS: Readonly<Record<SectionKey, string>> = {
  ...SECTION_LABELS,
  ssh: "Checking your login keys",
  passwordPolicy: "Checking password settings",
  dotfiles: "Checking files for saved passwords",
};

/** What the watch is not, in the app, the readme and the website (DESIGN-WATCH.md section 1). */
export const NOT_ANTIVIRUS = "I'm not antivirus. I read your Mac's settings and the list of programs that start on their own, then tell you when something changed. I never read your files. macOS's own virus checks do that part.";

export const WELCOME = {
  title: "Let's check your Mac.",
  body: "I'll look at your Mac's safety settings and fix what I can. Nothing leaves your Mac.",
  start: "Start",
  what: "What do you look at?",
  back: "Back",
  reads: "Disk encryption, firewall, updates, screen lock, network services and browser add-on permissions.",
  neverReads: "Your documents, photos, messages, passwords, browsing history or anything you type into macOS password dialogs.",
  notAntivirus: NOT_ANTIVIRUS,
  /** The foreground button that asks macOS for notification permission. */
  allowNotifications: "Tell me when something needs doing now",
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
  body: "The full version does them all and keeps an eye on your Mac from the menu bar.",
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
  badge: AI_BADGES,
  /** The v0.2 Apple Intelligence lines, as on the expert card, when On this Mac cannot explain. */
  apple: AI_UNAVAILABLE_COPY,
  openAppleSettings: AI_OPEN_APPLE_SETTINGS,
  /** The chosen provider cannot be offered by this build and nothing else can be connected. */
  notOffered: { chatgpt: "ChatGPT isn't available in this version yet.", claude_plan: "Claude isn't available in this version yet." },
  /** The disclosure's refusal while the chat is answering (one request at a time per provider). */
  busy: "I'm answering in the chat. Stop it there, or give me a moment.",
} as const;

export const END = {
  allDone: "Your Mac is in good shape.",
  nextTime: "I'll check again next time you open me.",
  /** Between allDone and nextTime, only while the watch is off (DESIGN-PLAYFUL.md 3.12). */
  allDoneLine: "That's all for today.",
  partial: "Your Mac is safer than it was.",
  nothing: "Nothing needs fixing.",
  unreadableAll: "I couldn't check your Mac.",
  unreadableSome: "Nothing to fix in what I could check.",
  tryAgain: "I'll try again next time you open me.",
  didNotChange: "Did not change",
  waiting: "Still waiting",
  locked: "In the full version",
  leftAlone: "Things I left alone",
  /** The accepted rules, DESIGN-ACCEPT.md section 3, item 3. */
  chosen: "Things you chose to leave",
  /** In place of `nothing` while a rule is accepted. */
  nothingLeft: "Nothing left for me to do.",
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

/** The three strings that change while the watch is on (DESIGN-WATCH.md section 6). */
export const WATCH_ON = {
  nextTime: "I'll keep checking from the menu bar.",
  tryAgain: "I'll check again within the hour.",
  couldNotCheck: "I made the change but could not check it. I'll check again within the hour.",
} as const;

/** The "something seems fishy" flow. "{time}" is substituted at render with formatTime. */
export const FISHY = {
  gate: {
    title: "Did you just change this?",
    body: {
      guard: "A built-in safety guard was switched off at {time}.",
      remote: "Remote access to your Mac was turned on at {time}.",
      admin: "A new admin account was added at {time}.",
      backup: "Your backups were switched off at {time}.",
      exposure: "A sharing setting was switched on at {time}.",
    } satisfies Readonly<Record<GatedKind, string>>,
    primary: "No, I didn't",
    link: "Yes, that was me",
  },
  noticed: {
    headline: {
      persistence: "A new program started running on its own",
      listener: "A new program is waiting for calls from the network",
      guard: "A built-in safety guard was switched off",
      remote: "Remote access to your Mac was turned on",
      admin: "A new admin account was added",
      dns: "The way your Mac finds websites changed",
      backup: "Your backups were switched off",
      app: "A new app skipped the usual safety checks",
      shell: "A hidden file that runs at start-up changed",
      exposure: "Your Mac is sharing more than before",
    } satisfies Readonly<Record<FishyKind, string>>,
    body: "I noticed this at {time}. It was not there at the last check. I have not deleted anything.",
    /** The shell kind's Details line under the file path. */
    changedAt: "changed at {time}",
    source: "SANS calls this identification, the step after preparation.",
    primary: "See what to do",
    link: "This is fine, I know it",
    details: "Details",
    ransom: "I saw a message asking for money",
  },
  disconnect: {
    title: "First, cut it off from the internet",
    body: "I'll turn Wi-Fi off. Nothing else changes, and you can turn it back on from here. This may not stop everything, but experts say do it first and do not wait.",
    bodyWired: "Unplug the network cable. Then I'll block all incoming connections. Some things you use may stop working until you allow them again.",
    source: "CISA's ransomware checklist, step 1. NIST SP 800-61 (2012 edition), section 3.3.1.",
    primary: "Turn Wi-Fi off",
    primaryWired: "Block incoming connections",
    link: "Not now",
    keepOn: "Do not switch the Mac off. Experts keep it running so the trace is not lost.",
    keepOnSource: "CISA's ransomware checklist, step 2.",
  },
  stop: {
    title: "Stop the program",
    body: "I'll stop it from running. I won't delete anything, so an expert can still look at it.",
    bodyNoEntry: "Quit the program named in Details. I can't stop it for you, because it has no start-up entry I can switch off.",
    source: "CISA's ransomware checklist, step 11. NIST SP 800-61 (2012 edition), section 3.3.2.",
    primary: "Stop it",
    primaryNoEntry: "Block incoming connections",
    link: "Not now",
  },
  eradicate: {
    title: "Keep it from starting again",
    body: 'Under "Allow in the Background", switch off the item you do not recognise. I\'ll show you which one.',
    source: "NIST SP 800-61 (2025), RS.MI-02. Apple's Personal Safety checklist, step 6.",
    primary: "Show me where",
    link: "I'll do it later",
  },
  experts: {
    title: "What experts do next",
    primary: "Done",
    more: "More experts suggest",
    rows: {
      passwords: {
        text: "Change your passwords from another device, like your phone. Start with your Apple Account and your email.",
        details: "CISA's ransomware checklist, step 17, and Apple's Apple Account guidance. Doing it from another device is our advice, not a quote.",
      },
      devices: {
        text: "In System Settings, click your name, then Sign-In & Security, and remove any device you don't know.",
        details: "Apple, Keep your Apple Account secure.",
      },
      twoFactor: {
        text: "Turn on two-factor sign-in for your Apple Account if it is off.",
        details: "Apple, If you think your Apple Account has been compromised.",
      },
      restore: {
        text: "Restore files only from a backup made before today, and check it first.",
        details: "NIST SP 800-61 (2025), RC.RP-03, and CISA's ransomware checklist, step 19.",
      },
      doNotPay: {
        text: "If a message asks for money, do not pay.",
        details: "CISA and the NCSC both say paying gives no guarantee.",
      },
      reinstall: {
        text: "If you are sure it was bad software, experts wipe the Mac and reinstall macOS. That is a job for Apple Support or a repair shop.",
        details: "CISA's recovery guide, step 5, calls a wipe the only sure way; SANS says the same.",
      },
      report: {
        text: "Tell someone: the police, your country's cyber security centre, or your IT person if you have one.",
        details: "CISA's ransomware checklist, step 7.",
      },
      update: {
        text: "Install the update if one is waiting.",
        details: "NIST SP 800-61 (2012 edition), section 3.3.4, and CISA's ransomware checklist, step 17.",
      },
      lockdown: {
        text: "Lockdown Mode, for the very few people who may be singled out.",
        details: "Apple says it is for the very few.",
      },
      limitAirdrop: {
        text: "Set AirDrop to Contacts Only, so strangers nearby cannot send you files.",
        details: "Apple macOS 26 Benchmark, section 2.3.1.1.",
      },
      stopSharing: {
        text: "Turn Internet Sharing off unless you meant to hand out your connection.",
        details: "Apple macOS 26 Benchmark, section 2.3.3.7.",
      },
      getHelp: {
        text: "Get help from someone you trust before you change the file yourself.",
        details: "CISA, Recovering from a Trojan Horse or Virus, step 1.",
      },
    },
  },
  recover: {
    title: "When you're done, turn Wi-Fi back on",
    body: "I'll keep watching more closely for a day.",
    source: "NIST SP 800-61 (2025), RC.RP-04. SANS says the same.",
    primary: "Turn Wi-Fi on",
    primaryWired: "Allow incoming again",
    link: "Not now",
  },
  evidence: "I have not deleted anything. The file is still there for an expert to look at.",
  lessons: "Last time you went through the steps for a program that started on its own. Here is what changed since.",
  notifyTail: "Open me to see what experts suggest.",
  /** The app kind's signature in words, under Details (WatchDetailsItem.signature). */
  signature: {
    apple: "from Apple",
    app_store: "from the App Store",
    developer_id: "signed by its maker",
    adhoc: "signed by no one macOS knows",
    unsigned: "not signed",
    invalid: "its signature is broken",
  } satisfies Readonly<Record<SignatureWord, string>>,
} as const;

/** The 320 px watch window (DESIGN-WATCH.md section 5). "{n}" is the count. */
export const WATCH = {
  calm: "Nothing changed",
  look: "Something to look at",
  lookOne: "One thing to look at",
  lookMany: "{n} things to look at",
  act: "Act now",
  checkedJustNow: "Checked just now",
  checkedMinutes: "Checked {n} minutes ago",
  checkedHours: "Checked {n} hours ago",
  checking: "Checking now",
  couldNotCheckOne: "I couldn't check 1 area",
  couldNotCheck: "I couldn't check {n} areas",
  moreOne: "and 1 more thing",
  more: "and {n} more things",
  seeWhatToDo: "See what to do",
  showMe: "Show me",
  openApp: "Open Talos Labs",
  checkNow: "Check now",
  firstRun: "I'll check your settings on a timer and tell you when something changed.",
  startAtLogin: "Start me when you log in",
  sourceAct: "Experts would cut it off first. CISA's ransomware checklist, step 1.",
  /** One line of why under the top item's headline, by kind. */
  why: {
    persistence: "Bad software often starts this way.",
    listener: "A program that waits for calls can let someone in.",
    guard: "This guard keeps bad software from running.",
    remote: "Someone could use your Mac from afar.",
    admin: "An admin account can change anything on this Mac.",
    dns: "Your Mac could be sent to the wrong websites.",
    backup: "Without backups, lost files stay lost.",
    app: "Apps that skip the checks are how bad software gets in.",
    shell: "Bad software hides there so it runs again and again.",
    exposure: "Each thing shared is one more way in.",
  } satisfies Readonly<Record<FishyKind, string>>,
} as const;

/** The Watch section in Settings, above Check-up. */
export const WATCH_SETTINGS = {
  title: "Watch",
  enabled: "Keep an eye on my Mac from the menu bar",
  sentence: "With this off, Talos Labs only checks when you open it.",
  startAtLogin: "Start when I log in",
  startAtLoginDescription: "Adds Talos Labs under Allow in the Background in System Settings. You can switch it off there too.",
  howOften: "How often",
  every15: "Every 15 minutes",
  every60: "Every hour",
  every240: "Every 4 hours",
  notify: "Tell me when something needs doing now",
  notifyDescription: "Only for things that need doing now. Never about the full version or AI.",
} as const;

/** The "What I watch" screen (docs/DESIGN-THREATS-V2.md section 4a). "{interval}" is substituted at render. */
export const COVERAGE = {
  title: "What I watch",
  back: "Back",
  intro: "I look at these every {interval}, from the menu bar. I compare each one with how it was last time.",
  interval: { 15: "15 minutes", 60: "hour", 240: "4 hours" },
  introOff: "The watch is off. I look at these when you open me.",
  introUnlicensed: "I look at these each time you open me.",
  turnOn: "Turn the watch on",
  groups: { firewalls: "Firewalls", settings: "Secure settings", access: "Who can get in", malware: "Malware protection", updates: "Updates, backups and health" },
  fewTimesADay: "a few times a day",
  reason: {
    needs_full_disk_access: "needs Full Disk Access",
    needs_automation_permission: "needs permission to control System Events",
    needs_admin: "needs an administrator account",
    permission_denied: "permission was denied",
    tool_missing: "a system tool is missing",
    timeout: "took too long",
    parse_error: "I couldn't read the answer",
    not_supported_on_os: "not on this version of macOS",
    collector_error: "something went wrong",
    rule_error: "something went wrong",
    indeterminate: "I couldn't tell",
    unsigned_build: "needs a signed build",
    spotlight_off: "Spotlight is off",
  },
  cannot: "What I can't see",
  gaps: {
    sockets: ["Which programs are talking to the internet.", "Needs a signed build."],
    browsers: ["Browser add-ons and home pages.", "Needs Full Disk Access."],
    btm: ["All the programs macOS lets run in the background.", "Needs an administrator tool I don't use."],
    realtime: ["Files being changed as it happens, and network traffic.", "Not possible for an app like me."],
    privacy: ["Which apps may use your camera, microphone or screen.", "macOS keeps that list private."],
  },
  experts: "Experts call these",
} as const;

/** watchOn swaps the "next time you open me" sentence for the watch's own. */
export function failureCopy(error: FixError | "still_failing" | "unreadable", batch: boolean, hasPane: boolean, watchOn = false): FailureCopy {
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
      return { title: "I made the change but could not check it.", body: watchOn ? WATCH_ON.tryAgain : "I'll check next time you open me.", primary: "next", later: false };
  }
}

/** "Leave it alone, I know the risk" (DESIGN-ACCEPT.md section 4). The word "accept" never reaches the screen. */
export const ACCEPT = {
  title: "Shall I stop asking about this?",
  titleMany: "Shall I stop asking about these?",
  body: "I've asked about this a few times. I can stop asking, but your Mac stays at risk until it's done.",
  bodyMany: "I've asked about these a few times. I can stop asking, but your Mac stays at risk until they're done.",
  primary: "No, keep asking",
  link: "Leave it alone, I know the risk",
  linkMany: "Leave them alone, I know the risks",
  flash: "OK, I'll leave it alone.",
  flashMany: "OK, I'll leave them alone.",
  /** The Finding detail offer and strip; the expert shell may use a real button. "{date}" is rendered through formatDate. */
  offer: "Don't want to do this? I'll stop proposing it. It still counts against the score.",
  strip: "You chose to leave this on {date}. It still counts against the score.",
  undo: "Ask me again",
  pill: "Left alone",
  chosenOne: "1 thing you chose to leave still counts.",
  chosenMany: "{n} things you chose to leave still count.",
  settingsSentence: "Open one to see it again or to ask me about it later.",
} as const;

/** The score card's fine-print line for `n` accepted rules that still fail. */
export function chosenLine(n: number): string {
  return n === 1 ? ACCEPT.chosenOne : ACCEPT.chosenMany.replace("{n}", String(n));
}

/** The activity rows' strings (docs/DESIGN-AGENT.md section 4). Every value is under the banned-word test. */
export const ACTIVITY = {
  rows: {
    preparing: "Getting ready",
    batchAdmin: "Fixing {n} things",
    batchAdminOne: "Fixing 1 thing",
    checking: "Checking it worked",
    watching: "Watching for the change",
    watchCheck: "Checking your Mac",
    /* AGENT part B region: the checklist row fragments (docs/DESIGN-AGENT.md 2c). */
    waitingForYou: "Waiting for you",
    anotherDay: "Another day",
    more: "and {n} more",
  },
  /** The participle of every catalogue guided.verb, pinned by a test. */
  verbs: {
    "Turn it on": "Turning it on",
    "Turn it off": "Turning it off",
    "Make it quiet": "Making it quiet",
    "Lock it sooner": "Locking it sooner",
    "Stop sharing it": "Stopping sharing it",
    "Add a password": "Adding a password",
    "Make it private": "Making it private",
    "Show me where": "Showing you where",
    Details: "Showing the details",
  },
  /** The state words on a row, always lower-case. */
  words: {
    password: "your password",
    running: "{i} of {n}",
    working: "working",
    watching: "watching",
    done: "done",
    didNotChange: "did not change",
    stopped: "stopped",
    couldNotCheck: "couldn't check",
    notChangedYet: "not changed yet",
    noChange: "no change yet",
    same: "same",
    changed: "changed",
    stillOff: "still off",
    nowOn: "now on",
  },
  /* AGENT part B region (docs/DESIGN-AGENT.md section 4 "Copy"). Templates use {n}, {headline}, {time}, {date}, {done}, {of} and {p}. */
  investigate: {
    lead: "I'll re-read the areas this touches and tell you what changed.",
    wait: "Checking now, one moment.",
    calm: "Nothing changed in what I re-read.",
    lookOne: "Still one thing to look at.",
    look: "Still {n} things to look at.",
    act: "This needs doing now.",
  },
  plan: {
    lead: "I'll go through these one at a time. Each fix is one tap, and macOS asks for your password when it needs it.",
    progress: "{done} of {of} done",
  },
  closer: {
    headline: "Watch this closer for an hour",
    until: "I'll check every 15 minutes until {time}.",
    paused: "I'll start when the pause ends, then check every 15 minutes for an hour.",
    // Reworded from the doc's "I already check every 15 minutes." (2.2) to pass the 1.6 counter.
    already: "I already check that often.",
  },
  remind: {
    tomorrow: "OK. I'll bring this up tomorrow when you open me: {headline}.",
    sunday: "OK. I'll bring this up on Sunday when you open me: {headline}.",
    due: "You asked me to bring this up today: {headline}.",
  },
  writeUp: {
    lead: "Here is a plain summary you can send. It has no file names or settings paths in it.",
    copy: "Copy it",
    copied: "Copied",
    save: "Save as a file…",
    saved: "Saved.",
    failed: "I couldn't save it there. Copy it instead.",
    copyFailed: "I couldn't copy it. Select the text and copy it yourself.",
    title: "Talos Labs check-up, {date}",
    score: "Score {n} out of 100, {grade}.",
    fixed: "Fixed today:",
    todo: "Still to do:",
    later: "Left for later:",
    left: "Left alone by choice:",
    watch: "The menu bar watch:",
    quote: {
      chatgpt: "ChatGPT wrote this. Not verified:",
      claude_plan: "Claude wrote this. Not verified:",
      claude: "Claude wrote this. Not verified:",
      apple: "Apple Intelligence on this Mac wrote this. Not verified:",
      ollama: "A local model wrote this. Not verified:",
    },
  },
  whatIf: {
    cost: "Leaving it keeps {p} off your score.",
    critical: "This is the one that would hurt most.",
  },
  /** The honest limits of docs/DESIGN-AGENT.md section 3; every one an app line with at most one way out. */
  refuse: {
    cannot_from_here: "I can't stop it by name. I can switch off the start-up entry it uses, if it has one.",
    watch_off: "The menu bar watch is off, so I can't look closer from here.",
    full_version: "Looking closer from the menu bar is in the full version.",
    full_version_recheck: "Checking again is in the full version.",
    full_version_closer: "Watching from the menu bar is in the full version.",
    cap_reached: "I've used today's allowance for the watch. I'll keep checking the usual way until tomorrow.",
    limit_reached: "Your AI has hit its limit for now. I'll keep checking the usual way.",
    no_notify: "I'll say it next time you open me. I don't send reminders.",
    busy: "I'm in the middle of something. One moment.",
    lookNotYet: "I can't look closer from here yet. I'll keep checking on my usual timer.",
    closerNotYet: "I can't change how often I check from here yet. You can set it in Settings.",
  },
  /** The one way out a refusal may carry (section 3). */
  links: { settings: "Open Settings" },
  /** The agent chips, at most 25 characters; "Do them all" and "Check again" stay CHAT.chips' alone. */
  chips: {
    lookInto: "Look into this",
    watchCloser: "Watch closer for an hour",
    remindTomorrow: "Ask me again tomorrow",
    remindSunday: "Remind me on Sunday",
    writeUp: "Write this up",
    whatIf: "What if I leave it?",
  },
} as const;

/**
 * The chat surface (docs/DESIGN-CHAT.md, docs/DESIGN-CHAT-UI.md). Plain templates: "{n}", "{i}" and "{headline}"
 * are substituted at render. `word` and `activity` point at ACTIVITY so the state words have one source.
 */
export const CHAT = {
  placeholder: "Ask me, or tell me what to do.",
  message: "Message",
  send: "Send",
  stop: "Stop",
  writing: "Writing",
  doneWriting: "Done writing",
  stopped: "Stopped.",
  sendAgain: "Send again",
  tryAgain: "Try again",
  stillWaiting: { chatgpt: "Still waiting for ChatGPT.", claude_plan: "Still waiting for Claude.", apple: "Still working on this Mac." },
  guard: "I can't read file paths or typed instructions. Say it in words and I'll answer.",
  busyExplain: "I'm still explaining the last one. Stop it, or give me a moment.",
  couldNotUse: "I couldn't use that answer. Try asking another way.",
  tooLong: "That was too much for this Mac in one go. Ask a shorter question.",
  outside: "That's outside what the check-up covers.",
  left: "{n} left",
  newMessages: "New messages",
  stepByStep: "Step by step",
  chat: "Chat",
  calls: "Calls this check-up: {n}",
  activity: { watching: ACTIVITY.rows.watching, watchCheck: ACTIVITY.rows.watchCheck },
  word: ACTIVITY.words,
  ok: "OK.",
  exchangeYou: "You asked",
  exchangeApp: "Talos Labs",
  conversation: "Conversation",
  actHeadline: "Act now: {headline}",
  noticedNoTime: "It was not there at the last check. I have not deleted anything.",
  moreLocked: "{n} more in the full version.",
  moreLockedOne: "1 more in the full version.",
  lockHeadline: "There are {n} more things I could fix.",
  lockHeadlineOne: "There is 1 more thing I could fix.",
  /** The chips, at most 25 characters each. */
  chips: {
    doThemAll: "Do them all",
    fixWhatYouCan: "Fix what you can",
    whatIsUrgent: "What is urgent?",
    whatFirst: "What should I do first?",
    whatsNext: "What's next?",
    showList: "Show me the list",
    checkAgain: "Check again",
    leaveAlone: "Leave it alone",
    why: "Why?",
  },
  // The "Why?" chip's turn and the watch window's draft are both askWhyQuestion(headline) from @talos/core; no template here.
  urgentLead: "This one is urgent:",
  firstLead: "Start here.",
  nextLead: "Next up.",
  acceptBody: "I can stop asking about this one, but your Mac stays at risk until it's done.",
  accepted: "OK. I'll leave this one alone and won't bring it up again. You can change that in Settings.",
  staleDone: "That one is done.",
  staleWaiting: "That one is waiting.",
  detailsRow: "Details: {headline}",
  rescanHeadline: "Shall I check again?",
  changeAiHeadline: "Change which AI I use",
  changeAiPrimary: "Change",
  watchHeadline: "Your Mac, from the menu bar",
  watchBody: "I check your Mac's settings on a timer. Ask me to look now and I'll say what I find.",
  list: "The plan",
  checkFailed: "I couldn't check just now.",
} as const;
