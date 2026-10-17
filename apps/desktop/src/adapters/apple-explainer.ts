import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import {
  MACOS_CATALOG,
  buildOnDeviceInstructions,
  buildOnDevicePrompt,
  containsCommandText,
  validateAnswer,
  validateExplanation,
  validatePrioritisation,
} from "@talos/core";
import type {
  AiAvailability,
  Answer,
  AskInput,
  ExplainInput,
  ExplainOptions,
  ExplainerFailure,
  ExplainerPort,
  ExplainerResult,
  Explanation,
  OnDeviceExtra,
  OnDeviceTask,
  PrioritiseInput,
  Prioritisation,
  RuleCatalog,
  RuleId,
  ScanReport,
} from "@talos/core";
import { failure, type ReportSource } from "./explainer-shared";

/** The ai:stream payload the Rust engine emits. */
export interface StreamEvent {
  readonly id: string;
  readonly kind: "partial" | "done" | "error";
  readonly json?: unknown;
  readonly code?: string;
  /** ISO with a limit_reached error, when the provider said when the allowance comes back. */
  readonly until?: string;
}

export type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
export type ListenFn = (event: "ai:stream", handler: (payload: StreamEvent) => void) => Promise<() => void>;

export interface AppleExplainerOptions {
  readonly reportSource: ReportSource;
  readonly catalog?: RuleCatalog;
  readonly invoke?: InvokeFn;
  readonly listen?: ListenFn;
}

const AVAILABILITY: readonly AiAvailability[] = [
  "available",
  "device_not_eligible",
  "apple_intelligence_not_enabled",
  "model_not_ready",
  "helper_unavailable",
];

/** Helper error codes to the failure the UI shows; context_window is handled by the retry before this. */
export const AI_ERROR_MAP: Readonly<Record<string, ExplainerFailure>> = {
  context_window: "too_long",
  guardrail: "refused",
  refusal: "refused",
  unsupported_language: "refused",
  assets_unavailable: "unavailable",
  rate_limited: "unavailable",
  busy: "busy",
  decoding: "rejected_output",
  internal: "unknown",
  cancelled: "cancelled",
};

export function mapAiError(code: string | undefined): ExplainerFailure {
  return code === undefined ? "unknown" : (AI_ERROR_MAP[code] ?? "unknown");
}

let counter = 0;
/** A request id matching the engine's ^[a-z0-9]{1,16}$; shared with the Claude plan adapter. */
export function nextId(): string {
  counter = (counter + 1) % 1_000_000;
  return `g${Date.now().toString(36).slice(-6)}${counter.toString(36)}`.slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when any string in the snapshot reads like a command. */
export function snapshotHasCommandText(json: unknown): boolean {
  if (typeof json === "string") return containsCommandText(json);
  if (Array.isArray(json)) return json.some(snapshotHasCommandText);
  if (isRecord(json)) return Object.values(json).some(snapshotHasCommandText);
  return false;
}

function toStreamEvent(payload: unknown): StreamEvent | null {
  if (!isRecord(payload)) return null;
  const { id, kind, json, code, until } = payload;
  if (typeof id !== "string") return null;
  if (kind !== "partial" && kind !== "done" && kind !== "error") return null;
  const event: { id: string; kind: StreamEvent["kind"]; json?: unknown; code?: string; until?: string } = { id, kind };
  if (json !== undefined) event.json = json;
  if (typeof code === "string") event.code = code;
  if (typeof until === "string") event.until = until;
  return event;
}

/** The ai:stream listener both Tauri-backed adapters share; drops payloads that are not stream events. */
export function defaultListen(): ListenFn {
  return async (event, handler) =>
    tauriListen<unknown>(event, (e) => {
      const parsed = toStreamEvent(e.payload);
      if (parsed !== null) handler(parsed);
    });
}

type Validator<T> = (raw: unknown, report: ScanReport, kept: readonly RuleId[]) => ExplainerResult<T>;

type RunResult<T> = ExplainerResult<T> | { readonly ok: false; readonly reason: "context_window" };

/** Streams from the on-device model through the Rust engine. Core builds the prompt and validates the answer. */
export class AppleExplainerAdapter implements ExplainerPort {
  readonly id = "apple" as const;
  private static instance: AppleExplainerAdapter | null = null;
  private readonly reportSource: ReportSource;
  private readonly catalog: RuleCatalog;
  private readonly invoke: InvokeFn;
  private readonly listen: ListenFn;

  constructor(options: AppleExplainerOptions) {
    this.reportSource = options.reportSource;
    this.catalog = options.catalog ?? MACOS_CATALOG;
    this.invoke = options.invoke ?? ((cmd, args) => tauriInvoke<unknown>(cmd, args));
    this.listen = options.listen ?? defaultListen();
  }

  /** One adapter per app, so the availability probe and its cache are shared. */
  static shared(reportSource: ReportSource): AppleExplainerAdapter {
    AppleExplainerAdapter.instance ??= new AppleExplainerAdapter({ reportSource });
    return AppleExplainerAdapter.instance;
  }

  async availability(fresh = false): Promise<AiAvailability> {
    try {
      const state = await this.invoke("ai_availability", { fresh });
      return typeof state === "string" && (AVAILABILITY as readonly string[]).includes(state)
        ? (state as AiAvailability)
        : "helper_unavailable";
    } catch {
      return "helper_unavailable";
    }
  }

  explain(input: ExplainInput, options?: ExplainOptions<Explanation>): Promise<ExplainerResult<Explanation>> {
    return this.generate("explain", input, { ruleId: input.ruleId }, (raw, report) => validateExplanation(raw, report), options);
  }

  prioritise(input: PrioritiseInput, options?: ExplainOptions<Prioritisation>): Promise<ExplainerResult<Prioritisation>> {
    return this.generate("prioritise", input, {}, validatePrioritisation, options);
  }

  ask(input: AskInput, options?: ExplainOptions<Answer>): Promise<ExplainerResult<Answer>> {
    const extra: OnDeviceExtra = { question: input.question, history: input.history };
    return this.generate("ask", input, extra, (raw, report) => validateAnswer(raw, report), options);
  }

  private async generate<T>(
    task: OnDeviceTask,
    input: { readonly context: PrioritiseInput["context"] },
    extra: OnDeviceExtra,
    validate: Validator<T>,
    options: ExplainOptions<T> | undefined,
  ): Promise<ExplainerResult<T>> {
    if (options?.signal?.aborted) return failure("cancelled");
    const report = await this.reportSource();
    if (report === null) return failure("unknown");
    const first = await this.once(task, input, extra, validate, report, options);
    if (first.ok || first.reason !== "context_window") return first;
    // The window was too small: one retry without the catalog explanations, then give up.
    const second = await this.once(task, input, { ...extra, explanations: false }, validate, report, options);
    if (!second.ok && second.reason === "context_window") return failure("too_long");
    return second;
  }

  private once<T>(
    task: OnDeviceTask,
    input: { readonly context: PrioritiseInput["context"] },
    extra: OnDeviceExtra,
    validate: Validator<T>,
    report: ScanReport,
    options: ExplainOptions<T> | undefined,
  ): Promise<RunResult<T>> {
    const built = buildOnDevicePrompt(task, input.context, this.catalog, extra);
    const id = nextId();
    const signal = options?.signal;
    return new Promise<RunResult<T>>((resolve) => {
      let settled = false;
      let unlisten: (() => void) | null = null;
      const finish = (result: RunResult<T>) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        unlisten?.();
        resolve(result);
      };
      const cancel = (reason: ExplainerFailure) => {
        void this.invoke("ai_cancel", { id }).catch(() => undefined);
        finish({ ok: false, reason });
      };
      const onAbort = () => cancel("cancelled");
      const onEvent = (event: StreamEvent) => {
        if (settled || event.id !== id) return;
        if (event.kind === "partial") {
          if (snapshotHasCommandText(event.json)) return cancel("rejected_output");
          if (isRecord(event.json)) options?.onPartial?.(event.json as Partial<T>);
          return;
        }
        if (event.kind === "done") return finish(validate(event.json, report, built.kept));
        if (event.code === "context_window") return finish({ ok: false, reason: "context_window" });
        finish({ ok: false, reason: mapAiError(event.code) });
      };
      void this.listen("ai:stream", onEvent)
        .then((stop) => {
          unlisten = stop;
          if (settled) return stop();
          signal?.addEventListener("abort", onAbort);
          if (signal?.aborted) return onAbort();
          const request = { id, task, instructions: buildOnDeviceInstructions(), prompt: built.text };
          return this.invoke("ai_generate", { request }).catch((error: unknown) => {
            finish({ ok: false, reason: typeof error === "string" ? mapAiError(error) : "unknown" });
          });
        })
        .catch(() => finish({ ok: false, reason: "unavailable" }));
    });
  }
}
