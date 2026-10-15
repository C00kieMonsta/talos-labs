import type {
  AbortSignalLike,
  AskInput,
  ExplainInput,
  ExplainerContext,
  ExplainerFailure,
  ExplainerResult,
  PrioritiseInput,
  ScanReport,
  Turn,
} from "@talos/core";
import { clampHistory, clampQuestion } from "@talos/core";

/** Supplies the report the validators check model output against. */
export type ReportSource = () => Promise<ScanReport | null>;

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

export type ExplainerTask = "explain" | "prioritise" | "ask";

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

interface TaskEnvelope {
  readonly task: ExplainerTask;
  readonly context: ExplainerContext;
  readonly ruleId?: string;
  readonly question?: string;
}

function envelope(e: TaskEnvelope): string {
  return JSON.stringify(e);
}

export function explainTurns(input: ExplainInput): readonly ChatTurn[] {
  return [{ role: "user", content: envelope({ task: "explain", ruleId: input.ruleId, context: input.context }) }];
}

export function prioritiseTurns(input: PrioritiseInput): readonly ChatTurn[] {
  return [{ role: "user", content: envelope({ task: "prioritise", context: input.context }) }];
}

/** Validated history first, the clamped question last, never an assistant turn at the end. */
export function askTurns(input: AskInput): readonly ChatTurn[] {
  const history: readonly Turn[] = clampHistory(input.history);
  const firstUser = history.findIndex((t) => t.role === "user");
  const usable = firstUser === -1 ? [] : history.slice(firstUser);
  const turns: ChatTurn[] = usable.map((t) => ({ role: t.role, content: t.text }));
  turns.push({
    role: "user",
    content: envelope({ task: "ask", context: input.context, question: clampQuestion(input.question) }),
  });
  return turns;
}

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
