import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  MACOS_CATALOG,
  PROVIDER_STATES,
  buildExplainerSystemPrompt,
  claudePromptFor,
  explainerEligibleRuleIds,
  validateAnswer,
  validateExplanation,
  validatePrioritisation,
} from "@talos/core";
import type {
  AiAvailability,
  AiAvailabilityDetail,
  Answer,
  AskInput,
  ExplainInput,
  ExplainOptions,
  ExplainerFailure,
  ExplainerPort,
  ExplainerResult,
  Explanation,
  PrioritiseInput,
  Prioritisation,
  RemoteTask,
  RemoteTurn,
  RuleCatalog,
  ScanReport,
} from "@talos/core";
import type { InvokeFn, ListenFn, StreamEvent } from "./apple-explainer";
import { defaultListen, nextId, snapshotHasCommandText } from "./apple-explainer";
import { acceptedIds, askTurns, explainTurns, failure, prioritiseTurns, type ReportSource } from "./explainer-shared";

export interface ClaudePlanExplainerOptions {
  readonly reportSource: ReportSource;
  readonly catalog?: RuleCatalog;
  readonly invoke?: InvokeFn;
  readonly listen?: ListenFn;
  readonly now?: () => string;
}

/** Stream error codes from the Rust Claude Code runner to the failure the UI shows. */
export const CLAUDE_PLAN_ERROR_MAP: Readonly<Record<string, ExplainerFailure>> = {
  needs_sign_in: "needs_sign_in",
  limit_reached: "limit_reached",
  provider_unavailable: "provider_unavailable",
  // The plan state is terminal; the call itself reads as the provider not answering.
  plan_not_eligible: "provider_unavailable",
  rejected_output: "rejected_output",
  timeout: "timeout",
  cancelled: "cancelled",
  busy: "busy",
  not_connected: "not_configured",
  not_offered: "not_configured",
  internal: "unknown",
};

export function mapClaudePlanError(code: string | undefined): ExplainerFailure {
  return code === undefined ? "unknown" : (CLAUDE_PLAN_ERROR_MAP[code] ?? "unknown");
}

type Validator<T> = (raw: unknown, report: ScanReport) => ExplainerResult<T>;

interface Cache {
  limitUntil: string | null;
  limitReached: boolean;
  /** When the limit was seen, for a limit the provider gave no reset time for. */
  limitAt: string | null;
  needsSignIn: boolean;
  unavailable: boolean;
  planNotEligible: boolean;
}

/** A limit with no reset time is forgotten after this long, the same TTL as the Rust cache; Rust answers from then on. */
export const LIMIT_TTL_MS = 300_000;

/** True while the cached limit still applies: until its reset time, or for the TTL when the provider gave none. */
function limitStillApplies(c: Cache, now: string): boolean {
  if (!c.limitReached) return false;
  const at = Date.parse(now);
  if (c.limitUntil !== null) return Date.parse(c.limitUntil) > at;
  return c.limitAt !== null && at - Date.parse(c.limitAt) < LIMIT_TTL_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDetail(value: unknown): AiAvailabilityDetail | null {
  if (!isRecord(value)) return null;
  const { state, until } = value;
  if (typeof state !== "string" || !(PROVIDER_STATES as readonly string[]).includes(state)) return null;
  return { state: state as AiAvailability, until: typeof until === "string" ? until : null };
}

/**
 * Streams from the person's own Claude plan through Claude Code, which Rust runs. The webview
 * sends the frozen instructions and the JSON envelope; Rust holds the flags and the schema.
 */
export class ClaudePlanExplainerAdapter implements ExplainerPort {
  readonly id = "claude_plan" as const;
  private static instance: ClaudePlanExplainerAdapter | null = null;
  private readonly reportSource: ReportSource;
  private readonly instructions: string;
  private readonly invoke: InvokeFn;
  private readonly listen: ListenFn;
  private readonly now: () => string;
  private readonly cache: Cache = { limitUntil: null, limitReached: false, limitAt: null, needsSignIn: false, unavailable: false, planNotEligible: false };

  constructor(options: ClaudePlanExplainerOptions) {
    this.reportSource = options.reportSource;
    this.instructions = buildExplainerSystemPrompt(options.catalog ?? MACOS_CATALOG);
    this.invoke = options.invoke ?? ((cmd, args) => tauriInvoke<unknown>(cmd, args));
    this.listen = options.listen ?? defaultListen();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** One adapter per app, so the cached state is shared. */
  static shared(reportSource: ReportSource): ClaudePlanExplainerAdapter {
    ClaudePlanExplainerAdapter.instance ??= new ClaudePlanExplainerAdapter({ reportSource });
    return ClaudePlanExplainerAdapter.instance;
  }

  async availability(fresh = false): Promise<AiAvailability> {
    return (await this.availabilityDetail(fresh)).state;
  }

  async availabilityDetail(fresh = false): Promise<AiAvailabilityDetail> {
    const c = this.cache;
    // A fresh probe (Try again, Disconnect, after a sign-in) forgets what this session saw, the reset time
    // included, and takes Rust's answer; Rust reports the limit again when it is still real.
    if (fresh) {
      c.limitUntil = null;
      c.limitReached = false;
      c.limitAt = null;
      c.unavailable = false;
      c.needsSignIn = false;
      c.planNotEligible = false;
    }
    if (limitStillApplies(c, this.now())) return { state: "limit_reached", until: c.limitUntil };
    // The reset time or the TTL has passed: the allowance comes back on its own, so Rust answers from here.
    c.limitReached = false;
    c.limitUntil = null;
    c.limitAt = null;
    if (c.unavailable) return { state: "provider_unavailable", until: null };
    if (c.needsSignIn) return { state: "needs_sign_in", until: null };
    if (c.planNotEligible) return { state: "plan_not_eligible", until: null };
    try {
      const detail = toDetail(await this.invoke("ai_provider_status", { provider: "claude_plan", fresh }));
      if (detail === null) return { state: "provider_unavailable", until: null };
      if (detail.state === "plan_not_eligible") c.planNotEligible = true;
      return detail;
    } catch {
      return { state: "provider_unavailable", until: null };
    }
  }

  explain(input: ExplainInput, options?: ExplainOptions<Explanation>): Promise<ExplainerResult<Explanation>> {
    return this.generate("explain", explainTurns(input), validateExplanation, options);
  }

  prioritise(input: PrioritiseInput, options?: ExplainOptions<Prioritisation>): Promise<ExplainerResult<Prioritisation>> {
    return this.generate("prioritise", prioritiseTurns(input), validatePrioritisationFor(input), options);
  }

  ask(input: AskInput, options?: ExplainOptions<Answer>): Promise<ExplainerResult<Answer>> {
    return this.generate("ask", askTurns(input), validateAnswer, options);
  }

  /** Remembers a mid-stream state change so the next availability() answers without a call. */
  private remember(code: string | undefined, until: string | undefined): void {
    if (code === "needs_sign_in") this.cache.needsSignIn = true;
    else if (code === "limit_reached") {
      this.cache.limitReached = true;
      this.cache.limitUntil = until ?? null;
      this.cache.limitAt = this.now();
    } else if (code === "provider_unavailable") this.cache.unavailable = true;
    else if (code === "plan_not_eligible") this.cache.planNotEligible = true;
  }

  private async generate<T>(
    task: RemoteTask,
    turns: readonly RemoteTurn[],
    validate: Validator<T>,
    options: ExplainOptions<T> | undefined,
  ): Promise<ExplainerResult<T>> {
    if (options?.signal?.aborted) return failure("cancelled");
    const report = await this.reportSource();
    if (report === null) return failure("unknown");
    const id = nextId();
    const signal = options?.signal;
    const prompt = claudePromptFor(turns);
    return new Promise<ExplainerResult<T>>((resolve) => {
      let settled = false;
      let unlisten: (() => void) | null = null;
      const finish = (result: ExplainerResult<T>) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        unlisten?.();
        resolve(result);
      };
      const cancel = (reason: ExplainerFailure) => {
        void this.invoke("claude_cancel", { id }).catch(() => undefined);
        finish(failure(reason));
      };
      const onAbort = () => cancel("cancelled");
      const onEvent = (event: StreamEvent) => {
        if (settled || event.id !== id) return;
        if (event.kind === "partial") {
          if (snapshotHasCommandText(event.json)) return cancel("rejected_output");
          if (isRecord(event.json)) options?.onPartial?.(event.json as Partial<T>);
          return;
        }
        if (event.kind === "done") {
          if (snapshotHasCommandText(event.json)) return finish(failure("rejected_output"));
          return finish(validate(event.json, report));
        }
        this.remember(event.code, event.until);
        finish(failure(mapClaudePlanError(event.code)));
      };
      void this.listen("ai:stream", onEvent)
        .then((stop) => {
          unlisten = stop;
          if (settled) return stop();
          signal?.addEventListener("abort", onAbort);
          if (signal?.aborted) return onAbort();
          const request = { id, task, instructions: this.instructions, prompt };
          return this.invoke("claude_generate", { request }).catch((error: unknown) => {
            const code = typeof error === "string" ? error : undefined;
            this.remember(code, undefined);
            finish(failure(mapClaudePlanError(code)));
          });
        })
        .catch(() => finish(failure("provider_unavailable")));
    });
  }
}

/** The order may only name rules the prompt showed: every eligible rule less the ones the person chose to leave. */
function validatePrioritisationFor(input: PrioritiseInput): Validator<Prioritisation> {
  return (raw, report) => validatePrioritisation(raw, report, explainerEligibleRuleIds(report, acceptedIds(input.context)));
}
