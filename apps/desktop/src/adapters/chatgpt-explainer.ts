import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  MACOS_CATALOG,
  PROVIDER_STATES,
  buildSystemPrompt,
  completeJsonPrefix,
  explainerEligibleRuleIds,
  parseResponsesError,
  parseResponsesEvent,
  responsesRequestBody,
  splitSseEvents,
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
import type { InvokeFn } from "./apple-explainer";
import { snapshotHasCommandText } from "./apple-explainer";
import { askTurns, explainTurns, failure, parseJson, prioritiseTurns, type ReportSource } from "./explainer-shared";

/** Fixed so the CSP stays static. */
export const CHATGPT_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const CHATGPT_REQUEST_TIMEOUT_MS = 90_000;
/** Partial snapshots are forwarded at most this often. */
export const CHATGPT_PARTIAL_EVERY_MS = 80;

/** The 400 code that means the account rejects reasoning or the schema format. */
const UNSUPPORTED_CAPABILITY = "subscription_sharing_unsupported_capability";

export interface ChatGptExplainerOptions {
  readonly reportSource: ReportSource;
  /** Developer-mode override; empty means the account's model from chatgpt_token. */
  readonly model?: string;
  readonly catalog?: RuleCatalog;
  readonly invoke?: InvokeFn;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => string;
}

interface ChatGptToken {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly model: string;
}

type TokenResult = { readonly ok: true; readonly token: ChatGptToken } | { readonly ok: false; readonly reason: ExplainerFailure };

type Validator<T> = (raw: unknown, report: ScanReport) => ExplainerResult<T>;

/** What the adapter remembers between calls, so availability answers without the network. */
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

function toToken(value: unknown): ChatGptToken | null {
  if (!isRecord(value)) return null;
  const { accessToken, expiresAt, model } = value;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;
  return { accessToken, expiresAt: typeof expiresAt === "string" ? expiresAt : "", model: typeof model === "string" ? model : "" };
}

function toDetail(value: unknown): AiAvailabilityDetail | null {
  if (!isRecord(value)) return null;
  const { state, until } = value;
  if (typeof state !== "string" || !(PROVIDER_STATES as readonly string[]).includes(state)) return null;
  return { state: state as AiAvailability, until: typeof until === "string" ? until : null };
}

/**
 * Streams from the Responses API with the person's own ChatGPT plan. Rust owns the sign-in and
 * the tokens; this adapter asks for an access token per call, holds it in a local, and drops it
 * when the request ends. Core builds the body and validates the answer.
 */
export class ChatGptExplainerAdapter implements ExplainerPort {
  readonly id = "chatgpt" as const;
  private static instance: ChatGptExplainerAdapter | null = null;
  private readonly reportSource: ReportSource;
  private readonly model: string;
  private readonly instructions: string;
  private readonly invoke: InvokeFn;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => string;
  /** Set once the account answered 400 unsupported_capability; the session then sends plain requests. */
  private plainOutput = false;
  private readonly cache: Cache = { limitUntil: null, limitReached: false, limitAt: null, needsSignIn: false, unavailable: false, planNotEligible: false };

  constructor(options: ChatGptExplainerOptions) {
    this.reportSource = options.reportSource;
    this.model = options.model?.trim() ?? "";
    this.instructions = buildSystemPrompt(options.catalog ?? MACOS_CATALOG);
    this.invoke = options.invoke ?? ((cmd, args) => tauriInvoke<unknown>(cmd, args));
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** One adapter per app so the cached state survives re-creation of the explainer. */
  static shared(options: ChatGptExplainerOptions): ChatGptExplainerAdapter {
    const current = ChatGptExplainerAdapter.instance;
    if (current !== null && current.model === (options.model?.trim() ?? "")) return current;
    ChatGptExplainerAdapter.instance = new ChatGptExplainerAdapter(options);
    return ChatGptExplainerAdapter.instance;
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
      const detail = toDetail(await this.invoke("ai_provider_status", { provider: "chatgpt", fresh }));
      if (detail === null) return { state: "provider_unavailable", until: null };
      if (detail.state === "plan_not_eligible") c.planNotEligible = true;
      return detail;
    } catch {
      return { state: "provider_unavailable", until: null };
    }
  }

  explain(input: ExplainInput, options?: ExplainOptions<Explanation>): Promise<ExplainerResult<Explanation>> {
    return this.request("explain", explainTurns(input), validateExplanation, options);
  }

  prioritise(input: PrioritiseInput, options?: ExplainOptions<Prioritisation>): Promise<ExplainerResult<Prioritisation>> {
    return this.request("prioritise", prioritiseTurns(input), validatePrioritisationFor, options);
  }

  ask(input: AskInput, options?: ExplainOptions<Answer>): Promise<ExplainerResult<Answer>> {
    return this.request("ask", askTurns(input), validateAnswer, options);
  }

  private async token(forceRefresh: boolean): Promise<TokenResult> {
    let raw: unknown;
    try {
      raw = await this.invoke("chatgpt_token", { forceRefresh });
    } catch (error) {
      const code = typeof error === "string" ? error : "";
      if (code === "not_connected" || code === "not_offered") return { ok: false, reason: "not_configured" };
      if (code === "needs_sign_in") {
        this.cache.needsSignIn = true;
        return { ok: false, reason: "needs_sign_in" };
      }
      this.cache.unavailable = true;
      return { ok: false, reason: "provider_unavailable" };
    }
    const token = toToken(raw);
    if (token === null) {
      this.cache.unavailable = true;
      return { ok: false, reason: "provider_unavailable" };
    }
    return { ok: true, token };
  }

  private async request<T>(
    task: RemoteTask,
    turns: readonly RemoteTurn[],
    validate: Validator<T>,
    options: ExplainOptions<T> | undefined,
  ): Promise<ExplainerResult<T>> {
    const signal = options?.signal;
    if (signal?.aborted) return failure("cancelled");
    const report = await this.reportSource();
    if (report === null) return failure("unknown");

    const controller = new AbortController();
    const clock = { timedOut: false };
    const timer = setTimeout(() => {
      clock.timedOut = true;
      controller.abort();
    }, CHATGPT_REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    try {
      let tokenResult = await this.token(false);
      if (!tokenResult.ok) return failure(tokenResult.reason);
      let retried = false;
      // At most one retry per call: a forced refresh after 401, or a plain body after 400 unsupported_capability.
      for (;;) {
        const model = this.model.length > 0 ? this.model : tokenResult.token.model;
        // Rust returns "" when the account's model list did not parse at connect time; never send an empty id.
        if (model.length === 0) return failure("provider_unavailable");
        const body = JSON.stringify(responsesRequestBody(task, model, this.instructions, turns, { plainOutput: this.plainOutput }));
        let response: Response;
        try {
          response = await this.fetchImpl(CHATGPT_RESPONSES_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokenResult.token.accessToken}`,
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body,
            signal: controller.signal,
          });
        } catch {
          if (signal?.aborted) return failure("cancelled");
          if (clock.timedOut) return failure("timeout");
          this.cache.unavailable = true;
          return failure("provider_unavailable");
        }
        if (response.ok) return this.stream(response, controller, clock, validate, report, options);

        const text = await response.text().catch(() => "");
        const status = response.status;
        if (status === 401 && !retried) {
          retried = true;
          tokenResult = await this.token(true);
          if (!tokenResult.ok) return failure(tokenResult.reason);
          continue;
        }
        if (status === 401) {
          this.cache.needsSignIn = true;
          return failure("needs_sign_in");
        }
        if (status === 403) {
          this.cache.planNotEligible = true;
          return failure("provider_unavailable");
        }
        if (status === 429) {
          const { until } = parseResponsesError(text, this.now());
          this.cache.limitReached = true;
          this.cache.limitUntil = until;
          this.cache.limitAt = this.now();
          return failure("limit_reached");
        }
        if (status === 400 && !retried && !this.plainOutput && parseResponsesError(text, this.now()).code === UNSUPPORTED_CAPABILITY) {
          retried = true;
          this.plainOutput = true;
          continue;
        }
        this.cache.unavailable = true;
        return failure("provider_unavailable");
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private async stream<T>(
    response: Response,
    controller: AbortController,
    clock: { readonly timedOut: boolean },
    validate: Validator<T>,
    report: ScanReport,
    options: ExplainOptions<T> | undefined,
  ): Promise<ExplainerResult<T>> {
    const reader = response.body?.getReader();
    if (reader === undefined) {
      this.cache.unavailable = true;
      return failure("provider_unavailable");
    }
    const decoder = new TextDecoder();
    let rest = "";
    let text = "";
    let completed: string | null = null;
    let lastPartialAt = 0;
    let pendingPartial: unknown = null;

    const forward = (force: boolean) => {
      if (pendingPartial === null) return;
      const at = Date.parse(this.now());
      if (!force && at - lastPartialAt < CHATGPT_PARTIAL_EVERY_MS) return;
      lastPartialAt = at;
      const snapshot = pendingPartial;
      pendingPartial = null;
      options?.onPartial?.(snapshot as Partial<T>);
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        const chunk = done ? "" : decoder.decode(value, { stream: true });
        const split = splitSseEvents(rest + chunk + (done ? "\n\n" : ""));
        rest = split.rest;
        for (const block of split.events) {
          const event = parseResponsesEvent(block);
          if (event === null || event.type === "other") continue;
          if (event.type === "failed") {
            this.cache.unavailable = true;
            return failure("provider_unavailable");
          }
          if (event.type === "completed") {
            completed = event.text.length > 0 ? event.text : text;
            continue;
          }
          text += event.delta;
          const snapshot = completeJsonPrefix(text);
          if (!isRecord(snapshot)) continue;
          if (snapshotHasCommandText(snapshot)) {
            controller.abort();
            return failure("rejected_output");
          }
          pendingPartial = snapshot;
          forward(false);
        }
        if (done) break;
      }
    } catch {
      if (options?.signal?.aborted) return failure("cancelled");
      if (clock.timedOut) return failure("timeout");
      this.cache.unavailable = true;
      return failure("provider_unavailable");
    } finally {
      reader.releaseLock();
    }

    if (completed === null) {
      if (options?.signal?.aborted) return failure("cancelled");
      if (clock.timedOut) return failure("timeout");
      this.cache.unavailable = true;
      return failure("provider_unavailable");
    }
    forward(true);
    const parsed = parseJson(completed);
    if (!parsed.ok) return failure("rejected_output");
    if (snapshotHasCommandText(parsed.value)) return failure("rejected_output");
    return validate(parsed.value, report);
  }
}

/** The order may only name rules the prompt showed, which for a full context is every eligible rule. */
function validatePrioritisationFor(raw: unknown, report: ScanReport): ExplainerResult<Prioritisation> {
  return validatePrioritisation(raw, report, explainerEligibleRuleIds(report));
}
