import { replyRejected, validateChat, validateChatAnswer } from "@talos/core";
import type { AbortSignalLike, ChatCall, ChatResult, ExplainOptions, ExplainerContext, ExplainerFailure, ExplainerResult, RemoteTask, RemoteTurn, RuleId, ScanReport } from "@talos/core";

/**
 * Helpers shared by the HTTP explainer adapters. The turn builders live in core
 * (packages/core/src/explainer/remote.ts) so the canary test covers their bytes.
 */
export { askTurns, chatTurns, explainTurns, prioritiseTurns } from "@talos/core";

/** The chat validator bound to one call's allow-lists and locked ids; the ChatResult shape. */
export function chatValidator(call: ChatCall): (raw: unknown, report: ScanReport) => ExplainerResult<ChatResult> {
  return (raw, report) => validateChat(raw, report, call.allowed, call.locked);
}

/** The ask-shaped chat validator (on this Mac, ChatGPT plainOutput): no intents, cards come from relatedRuleIds. */
export function chatAnswerValidator(call: ChatCall): (raw: unknown, report: ScanReport) => ExplainerResult<ChatResult> {
  return (raw, report) => validateChatAnswer(raw, report, call.allowed);
}

/** Accepts either shape: validateChat when the reply carries intents, the ask shape otherwise. */
export function chatEitherValidator(call: ChatCall): (raw: unknown, report: ScanReport) => ExplainerResult<ChatResult> {
  return (raw, report) => (isAskShaped(raw) ? validateChatAnswer(raw, report, call.allowed) : validateChat(raw, report, call.allowed, call.locked));
}

function isAskShaped(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof (raw as { answer?: unknown }).answer === "string" && !("reply" in raw);
}

/** The reply text so far from a chat or ask-shaped snapshot, or null when neither field is a string yet. */
export function chatPartialText(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return null;
  const { reply, answer } = snapshot as { reply?: unknown; answer?: unknown };
  if (typeof reply === "string") return reply;
  if (typeof answer === "string") return answer;
  return null;
}

/** True when the reply so far already breaks the prose rules; the adapter cancels as rejected_output. */
export function chatPartialRejected(snapshot: unknown): boolean {
  const text = chatPartialText(snapshot);
  return text !== null && replyRejected(text);
}

/** Wraps options so every partial reaches the chat as { reply }, whichever shape the provider streams. */
export function chatPartialOptions(options: ExplainOptions<ChatResult> | undefined): ExplainOptions<unknown> {
  return {
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
    onPartial: (partial: unknown) => {
      const reply = chatPartialText(partial);
      if (reply !== null) options?.onPartial?.({ reply });
    },
  };
}

/** Supplies the report the validators check model output against. */
export type ReportSource = () => Promise<ScanReport | null>;

/** The ids the person chose to leave, read from the document's own rows; the prioritise validator drops them. */
export function acceptedIds(context: ExplainerContext): readonly RuleId[] {
  return context.findings.filter((f) => f.accepted).map((f) => f.ruleId);
}

export function failure<T>(reason: ExplainerFailure): ExplainerResult<T> {
  return { ok: false, reason };
}

/** Bridges core's structural signal onto a real AbortSignal for fetch and the SDK. */
export function toAbortSignal(signal: AbortSignalLike | undefined): AbortSignal | undefined {
  if (signal === undefined) return undefined;
  if (signal instanceof AbortSignal) return signal;
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort();
  } else {
    signal.addEventListener("abort", () => controller.abort());
  }
  return controller.signal;
}

export type ExplainerTask = RemoteTask;

export type ChatTurn = RemoteTurn;

export type ParsedJson = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export function parseJson(text: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Keeps a user override only when it matches the provider's id pattern. */
export function resolveModel(candidate: string | undefined, pattern: RegExp, fallback: string): string {
  const trimmed = candidate?.trim() ?? "";
  return pattern.test(trimmed) ? trimmed : fallback;
}
