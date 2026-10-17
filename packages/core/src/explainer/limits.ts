import { EXPLAINER_LIMITS, type Turn } from "../ports/explainer-port";

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Cuts a string to a code-unit length without leaving a dangling surrogate. */
export function clampString(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  let cut = value.slice(0, max);
  if (cut.length > 0 && isHighSurrogate(cut.charCodeAt(cut.length - 1))) {
    cut = cut.slice(0, -1);
  }
  return cut;
}

export function clampQuestion(question: string): string {
  return clampString(question, EXPLAINER_LIMITS.maxQuestionChars);
}

/** Keeps the most recent turns. */
export function clampHistory(history: readonly Turn[]): readonly Turn[] {
  if (history.length <= EXPLAINER_LIMITS.maxHistoryTurns) {
    return history;
  }
  return history.slice(history.length - EXPLAINER_LIMITS.maxHistoryTurns);
}

/** DESIGN-CHAT section 4: the chat task's own caps. maxReplyChars restates EXPLAINER_LIMITS.maxOutputStringChars. */
export const CHAT_LIMITS = {
  maxQuestionChars: 500,
  maxReplyChars: 1200,
  maxIntents: 3,
  maxRelated: 3,
  maxChips: 4,
  maxHistoryTurnsRemote: 6,
  maxHistoryTurnsOnDevice: 2,
  maxOnDeviceTurnChars: 400,
  maxEvents: 10,
  maxWatchItems: 6,
  maxPlanIds: 10,
} as const;

export type ChatHistoryTarget = "remote" | "on_device";

/** Keeps the newest turns: 6 for remote, 2 at 400 characters each on this Mac. */
export function clampChatHistory(history: readonly Turn[], target: ChatHistoryTarget): readonly Turn[] {
  if (target === "remote") {
    return history.length <= CHAT_LIMITS.maxHistoryTurnsRemote ? history : history.slice(history.length - CHAT_LIMITS.maxHistoryTurnsRemote);
  }
  const kept = history.length <= CHAT_LIMITS.maxHistoryTurnsOnDevice ? history : history.slice(history.length - CHAT_LIMITS.maxHistoryTurnsOnDevice);
  return kept.map((turn) => ({ role: turn.role, text: clampString(turn.text, CHAT_LIMITS.maxOnDeviceTurnChars) }));
}

export function clampChatQuestion(question: string): string {
  return clampString(question, CHAT_LIMITS.maxQuestionChars);
}
