import type { WatchModelProvider, WatchUnavailableReason } from "@talos/core";
import { askWhyQuestion } from "@talos/core";
import { SOCKET_TABLE_LABEL, UNKNOWN_REASON_LABELS } from "../app/labels";

/**
 * The watch window's strings (docs/DESIGN-WATCH-WINDOW.md section 6), held here until the WATCH
 * block in guided/copy.ts is free, the same precedent as src/activity/copy.ts. Every string is
 * under the banned-word test and the 1.6 counter in copy.test.ts. British English, no em-dashes.
 */
export const WATCH_WINDOW = {
  nextCheckMinutes: "Next check in {n} minutes",
  nextCheckHour: "Next check in about an hour",
  nextCheckHours: "Next check in {n} hours",
  nextCheckSoon: "Next check soon",
  closerWatch: "Checking every 15 minutes until {time}",
  calmDays: "No change in {n} days.",
  calmDay: "No change since yesterday.",
  calmHours: "No change in {n} hours.",
  calmHour: "No change in the last hour.",
  calmRecent: "No change since the last check.",
  calmStart: "No change since I started.",
  checkup: "Last check-up: {score}, {grade}.",
  checkupUnscored: "Last check-up: not scored.",
  checkupNone: "Waiting for your first check-up.",
  upNext: "Up next: {headline}",
  askPlaceholder: "Ask me about your Mac.",
  /** The authored "Why?" question, built by the one helper the chat reads too (docs/DESIGN-CHAT.md, the Why chip). */
  askWhy: (headline: string): string => askWhyQuestion(headline),
  askLink: "Ask why this matters",
  /** The look state with no item has no headline to ask about; the link reads this and carries the draft below. */
  askWhatChangedLink: "Ask what changed",
  askWhatChanged: "What changed on my Mac?",
  send: "Send",
  connectLine: "Connect your AI to ask me things from here.",
  connectLink: "Connect my AI",
  couldNotCheckArea: "I couldn't check {area}. {reason}",
  couldNotCheckAreas: "I couldn't check {areas}. {reason}",
  couldNotCheckMixed: "I couldn't check {n} areas. Open Talos Labs to see why.",
  lookEmptyNew: "At your last check-up, {n} new thing to fix.",
  lookEmptyNewMany: "At your last check-up, {n} new things to fix.",
  lookEmptyChange: "{n} change in the last day.",
  lookEmptyChanges: "{n} changes in the last day.",
  paused: "Paused until {time}",
  pausedLine: "I'll check again when the hour is up.",
} as const;

/** The short badge after a model line (docs/DESIGN-AI-PRESENCE.md section 5). */
export const AI_BADGES_SHORT: Readonly<Record<WatchModelProvider, string>> = {
  chatgpt: "ChatGPT, not verified",
  claude_plan: "Claude, not verified",
  apple: "Apple Intelligence on this Mac, not verified",
};

/** The plain label for a probe the sweep could not read; the socket table of an unsigned build has its own word. */
export function reasonLabel(reason: WatchUnavailableReason): string {
  return reason === "unsigned_build" ? SOCKET_TABLE_LABEL : UNKNOWN_REASON_LABELS[reason];
}
