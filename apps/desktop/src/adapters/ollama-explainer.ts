import {
  ANSWER_JSON_SCHEMA,
  EXPLANATION_JSON_SCHEMA,
  MACOS_CATALOG,
  PRIORITISATION_JSON_SCHEMA,
  buildSystemPrompt,
  validateAnswer,
  validateExplanation,
  validatePrioritisation,
  type AbortSignalLike,
  type Answer,
  type AskInput,
  type ExplainInput,
  type ExplainerPort,
  type ExplainerResult,
  type Explanation,
  type PrioritiseInput,
  type Prioritisation,
  type ScanReport,
} from "@talos/core";
import {
  askTurns,
  explainTurns,
  failure,
  parseJson,
  prioritiseTurns,
  resolveModel,
  type ChatTurn,
  type ReportSource,
} from "./explainer-shared";

export const DEFAULT_OLLAMA_MODEL = "llama3.1";
export const OLLAMA_MODEL_PATTERN = /^[a-z0-9._:-]+$/;
/** Fixed so the CSP stays static. */
export const OLLAMA_CHAT_URL = "http://127.0.0.1:11434/api/chat";

const REQUEST_TIMEOUT_MS = 60_000;

export interface OllamaExplainerOptions {
  readonly reportSource: ReportSource;
  readonly model?: string;
  readonly systemPrompt?: string;
  readonly fetchImpl?: typeof fetch;
}

type Validator<T> = (raw: unknown, report: ScanReport) => ExplainerResult<T>;

export class OllamaExplainerAdapter implements ExplainerPort {
  readonly id = "ollama" as const;
  readonly model: string;
  private readonly reportSource: ReportSource;
  private readonly systemPrompt: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaExplainerOptions) {
    this.reportSource = options.reportSource;
    this.model = resolveModel(options.model, OLLAMA_MODEL_PATTERN, DEFAULT_OLLAMA_MODEL);
    this.systemPrompt = options.systemPrompt ?? buildSystemPrompt(MACOS_CATALOG);
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  explain(input: ExplainInput, signal?: AbortSignalLike): Promise<ExplainerResult<Explanation>> {
    return this.request(explainTurns(input), EXPLANATION_JSON_SCHEMA, validateExplanation, signal);
  }

  prioritise(input: PrioritiseInput, signal?: AbortSignalLike): Promise<ExplainerResult<Prioritisation>> {
    return this.request(prioritiseTurns(input), PRIORITISATION_JSON_SCHEMA, validatePrioritisation, signal);
  }

  ask(input: AskInput, signal?: AbortSignalLike): Promise<ExplainerResult<Answer>> {
    return this.request(askTurns(input), ANSWER_JSON_SCHEMA, validateAnswer, signal);
  }

  private async request<T>(
    turns: readonly ChatTurn[],
    schema: Record<string, unknown>,
    validate: Validator<T>,
    signal: AbortSignalLike | undefined,
  ): Promise<ExplainerResult<T>> {
    const report = await this.reportSource();
    if (report === null) return failure("unknown");

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", onAbort);

    const body = {
      model: this.model,
      stream: false,
      format: schema,
      messages: [{ role: "system", content: this.systemPrompt }, ...turns],
    };

    let text: string;
    try {
      const response = await this.fetchImpl(OLLAMA_CHAT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return failure("unknown");
      const json: unknown = await response.json();
      const content = (json as { message?: { content?: unknown } } | null)?.message?.content;
      if (typeof content !== "string") return failure("rejected_output");
      text = content;
    } catch {
      return failure(timedOut ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    const parsed = parseJson(text);
    if (!parsed.ok) return failure("rejected_output");
    return validate(parsed.value, report);
  }
}
