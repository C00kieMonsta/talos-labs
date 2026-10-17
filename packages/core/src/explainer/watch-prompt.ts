import type { WatchContext } from "../ports/watch-port";
import { ON_DEVICE_BASE_INSTRUCTIONS, ON_DEVICE_LIMITS, type OnDevicePrompt } from "./on-device-prompt";
import { WATCH_INSTRUCTIONS_BLOCK } from "./remote";

export interface WatchOnDevicePrompt extends OnDevicePrompt {
  readonly instructions: string;
}

/** The frozen on-device base text plus the watch block. Rust reads the same text from fixtures/watch-instructions-on-device.txt. */
export function buildOnDeviceWatchInstructions(): string {
  return `${ON_DEVICE_BASE_INSTRUCTIONS}\n\n${WATCH_INSTRUCTIONS_BLOCK}`;
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
