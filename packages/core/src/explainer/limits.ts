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
