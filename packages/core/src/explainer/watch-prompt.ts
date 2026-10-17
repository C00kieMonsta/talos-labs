import type { WatchContext } from "../ports/watch-port";
import { MACOS_CATALOG } from "../rules/macos/index";
import { ON_DEVICE_BASE_INSTRUCTIONS, ON_DEVICE_LIMITS, type OnDevicePrompt } from "./on-device-prompt";
import { WATCH_INSTRUCTIONS_BLOCK } from "./remote";
import { buildSystemPrompt } from "./system-prompt";

export interface WatchOnDevicePrompt extends OnDevicePrompt {
  readonly instructions: string;
}

/** What ratingReason is for, told to the remote judge (docs/DESIGN-WATCH-WINDOW.md section 3). */
export const WATCH_REASON_RULES =
  "ratingReason is one sentence of at most 120 characters, in every rating, written to the reader in the second person. Never write as the app: never I, me, my or we. Never tell the reader what to click or run. Never say the Mac is safe, protected, secure, clean or fine. Never say how long anything has held still; the app shows the time. Never name a check-up item by its title; describe it in plain words. On calm, say what is still open on this Mac and why it matters to this reader today. On keep_an_eye and act_now, say what the change is and why it stands out.";

/** The same rules for the on-device model, whose calm reason stays empty. */
export const WATCH_REASON_RULES_ON_DEVICE =
  "ratingReason is one sentence of at most 120 characters, written to the reader in the second person. Never write as the app: never I, me, my or we. Never tell the reader what to click or run. Never say the Mac is safe, protected, secure, clean or fine. Never say how long anything has held still; the app shows the time. Never name a check-up item by its title; describe it in plain words. On calm, ratingReason is empty. On keep_an_eye and act_now, say what the change is and why it stands out.";

/**
 * The remote judge's instructions: the frozen system prompt, the reason rules, then the watch
 * block, so the text still ends with the vocabulary sentence. Rust reads the same text from
 * fixtures/watch-instructions.txt.
 */
export function buildWatchJudgeInstructions(): string {
  return `${buildSystemPrompt(MACOS_CATALOG)}\n\n${WATCH_REASON_RULES}\n\n${WATCH_INSTRUCTIONS_BLOCK}`;
}

/** The frozen on-device base text, the on-device reason rules, then the watch block. Rust reads the same text from fixtures/watch-instructions-on-device.txt. */
export function buildOnDeviceWatchInstructions(): string {
  return `${ON_DEVICE_BASE_INSTRUCTIONS}\n\n${WATCH_REASON_RULES_ON_DEVICE}\n\n${WATCH_INSTRUCTIONS_BLOCK}`;
}

function render(context: WatchContext): string {
  return JSON.stringify({ task: "watch", context });
}

/**
 * The user message for the on-device model: { task: "watch", context }. Over maxPromptChars,
 * unchanged rules are dropped first, then unchanged signals, then recent entries from the end.
 * kept carries the rule ids that stayed; omitted counts every dropped rule, signal and recent entry.
 */
export function buildOnDeviceWatchPrompt(context: WatchContext): WatchOnDevicePrompt {
  const max = ON_DEVICE_LIMITS.maxPromptChars;
  let current: WatchContext = context;
  let omitted = 0;
  let text = render(current);
  if (text.length > max) {
    const rules = current.rules.filter((r) => r.change !== "none");
    omitted += current.rules.length - rules.length;
    current = { ...current, rules };
    text = render(current);
  }
  if (text.length > max) {
    const signals = current.signals.filter((s) => s.change !== "same");
    omitted += current.signals.length - signals.length;
    current = { ...current, signals };
    text = render(current);
  }
  while (text.length > max && current.recent.length > 0) {
    current = { ...current, recent: current.recent.slice(0, -1) };
    omitted += 1;
    text = render(current);
  }
  return { instructions: buildOnDeviceWatchInstructions(), text, kept: current.rules.map((r) => r.ruleId), omitted };
}
