import type { AbortSignalLike, ExplainerContext, ExplainerFailure, ExplainerResult, RemoteTask, RemoteTurn, RuleId, ScanReport } from "@talos/core";

/**
 * Helpers shared by the HTTP explainer adapters. The turn builders live in core
 * (packages/core/src/explainer/remote.ts) so the canary test covers their bytes.
 */
export { askTurns, explainTurns, prioritiseTurns } from "@talos/core";

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
