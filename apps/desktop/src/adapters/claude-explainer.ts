import Anthropic from "@anthropic-ai/sdk";
import {
  ANSWER_JSON_SCHEMA,
  EXPLANATION_JSON_SCHEMA,
  MACOS_CATALOG,
  PRIORITISATION_JSON_SCHEMA,
  buildExplainerSystemPrompt,
  validateAnswer,
  validateExplanation,
  explainerEligibleRuleIds,

  validatePrioritisation,
  type AiAvailability,
  type Answer,
  type AskInput,
  type ExplainInput,
  type ExplainOptions,
  type ExplainerPort,
  type ExplainerResult,
  type Explanation,
  type PrioritiseInput,
  type Prioritisation,
  type ScanReport,
  type SecretStorePort,
} from "@talos/core";
import {
  acceptedIds,
  askTurns,
  explainTurns,
  failure,
  parseJson,
  prioritiseTurns,
  resolveModel,
  toAbortSignal,
  type ChatTurn,
  type ReportSource,
} from "./explainer-shared";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";
export const CLAUDE_MODEL_PATTERN = /^claude-[a-z0-9-]+$/;

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 16_000;

export interface ClaudeExplainerOptions {
  readonly secrets: SecretStorePort;
  readonly reportSource: ReportSource;
  readonly model?: string;
  readonly systemPrompt?: string;
}

type Effort = NonNullable<Anthropic.OutputConfig["effort"]>;

type Validator<T> = (raw: unknown, report: ScanReport) => ExplainerResult<T>;

export class ClaudeExplainerAdapter implements ExplainerPort {
  readonly id = "claude" as const;
  readonly model: string;
  private readonly secrets: SecretStorePort;
  private readonly reportSource: ReportSource;
  private readonly systemPrompt: string;

  constructor(options: ClaudeExplainerOptions) {
    this.secrets = options.secrets;
    this.reportSource = options.reportSource;
    this.model = resolveModel(options.model, CLAUDE_MODEL_PATTERN, DEFAULT_CLAUDE_MODEL);
    this.systemPrompt = options.systemPrompt ?? buildExplainerSystemPrompt(MACOS_CATALOG);
  }

  /** A configured Developer-mode provider is taken to be reachable; a failed call reports the reason. */
  async availability(_fresh?: boolean): Promise<AiAvailability> {
    return "available";
  }

  explain(input: ExplainInput, options?: ExplainOptions<Explanation>): Promise<ExplainerResult<Explanation>> {
    return this.request(explainTurns(input), EXPLANATION_JSON_SCHEMA, "low", validateExplanation, options);
  }

  prioritise(input: PrioritiseInput, options?: ExplainOptions<Prioritisation>): Promise<ExplainerResult<Prioritisation>> {
    return this.request(prioritiseTurns(input), PRIORITISATION_JSON_SCHEMA, "low", validatePrioritisationFor(input), options);
  }

  ask(input: AskInput, options?: ExplainOptions<Answer>): Promise<ExplainerResult<Answer>> {
    return this.request(askTurns(input), ANSWER_JSON_SCHEMA, "medium", validateAnswer, options);
  }

  private async request<T>(
    turns: readonly ChatTurn[],
    schema: Record<string, unknown>,
    effort: Effort,
    validate: Validator<T>,
    options: ExplainOptions<T> | undefined,
  ): Promise<ExplainerResult<T>> {
    const signal = options?.signal;
    const apiKey = await this.secrets.get("anthropic_api_key");
    if (apiKey === null || apiKey.length === 0) return failure("no_api_key");

    const report = await this.reportSource();
    if (report === null) return failure("unknown");

    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(
        {
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: [{ type: "text", text: this.systemPrompt, cache_control: { type: "ephemeral" } }],
          messages: turns.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.content })),
          output_config: { effort, format: { type: "json_schema", schema } },
        },
        { signal: toAbortSignal(signal) ?? null },
      );
    } catch (error) {
      return failure(mapError(error));
    }

    if (response.stop_reason === "refusal") return failure("refused");

    const text = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    if (text === undefined) return failure("rejected_output");

    const parsed = parseJson(text.text);
    if (!parsed.ok) return failure("rejected_output");

    const result = validate(parsed.value, report);
    // A non-streaming provider shows its whole answer as one partial.
    if (result.ok) options?.onPartial?.(result.value);
    return result;
  }
}

/** Most specific class first. Never string-matches messages. */
function mapError(error: unknown): "auth" | "timeout" | "network" | "unknown" {
  if (error instanceof Anthropic.AuthenticationError) return "auth";
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.APIConnectionError) return "network";
  return "unknown";
}

/** The order may only name rules the prompt showed: every eligible rule less the ones the person chose to leave. */
function validatePrioritisationFor(input: PrioritiseInput): Validator<Prioritisation> {
  return (raw, report) => validatePrioritisation(raw, report, explainerEligibleRuleIds(report, acceptedIds(input.context)));
}
