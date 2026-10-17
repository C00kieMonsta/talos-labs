/**
 * The words no authored or model line in the watch may carry. The same list as the local
 * BANNED in apps/desktop/src/guided/copy.test.ts, in the same order; emitted to
 * fixtures/watch-cases.json as bannedWords so Rust pins its copy to this one.
 */
export const WATCH_BANNED_WORDS = [
  "finding",
  "findings",
  "severity",
  "CIS",
  "rule",
  "rules",
  "policy",
  "configuration",
  "SSH",
  "launchd",
  "plist",
  "daemon",
  "sudo",
  "Terminal",
  "TCC",
  "stealth",
  "sysadminctl",
  "command",
  "points",
] as const;

/** Whole word, case-insensitive. */
export const WATCH_BANNED_PATTERN = new RegExp(`\\b(${WATCH_BANNED_WORDS.join("|")})\\b`, "i");
