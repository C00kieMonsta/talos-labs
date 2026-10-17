import type { AskInput, ExplainInput, ExplainerContext, PrioritiseInput, Turn } from "../ports/explainer-port";
import { clampHistory, clampQuestion } from "./limits";
import { ANSWER_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA } from "./schemas";

/**
 * Request bodies for the remote providers (ChatGPT over the Responses API, Claude through
 * Claude Code). Built here so the canary test covers the literal bytes that leave the Mac.
 * Dependency-free: the desktop adapters only add the transport.
 */

export type RemoteTask = "explain" | "prioritise" | "ask";

export interface RemoteTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

interface TaskEnvelope {
  readonly task: RemoteTask;
  readonly context: ExplainerContext;
  readonly ruleId?: string;
  readonly question?: string;
}

function envelope(e: TaskEnvelope): string {
  return JSON.stringify(e);
}

export function explainTurns(input: ExplainInput): readonly RemoteTurn[] {
  return [{ role: "user", content: envelope({ task: "explain", ruleId: input.ruleId, context: input.context }) }];
}

export function prioritiseTurns(input: PrioritiseInput): readonly RemoteTurn[] {
  return [{ role: "user", content: envelope({ task: "prioritise", context: input.context }) }];
}

/** Validated history first, the clamped question last, never an assistant turn at the end. */
export function askTurns(input: AskInput): readonly RemoteTurn[] {
  const history: readonly Turn[] = clampHistory(input.history);
  const firstUser = history.findIndex((t) => t.role === "user");
  const usable = firstUser === -1 ? [] : history.slice(firstUser);
  const turns: RemoteTurn[] = usable.map((t) => ({ role: t.role, content: t.text }));
  turns.push({
    role: "user",
    content: envelope({ task: "ask", context: input.context, question: clampQuestion(input.question) }),
  });
  return turns;
}

/** The whole conversation as one JSON document, written to Claude Code's stdin. */
export function claudePromptFor(turns: readonly RemoteTurn[]): string {
  return JSON.stringify({ turns });
}

const UNSUPPORTED_IN_STRICT = new Set(["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "pattern", "format"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (isRecord(value)) return strip(value);
  return value;
}

function strip(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_IN_STRICT.has(key)) continue;
    if (key === "properties" && isRecord(value)) {
      // Property names are not keywords; only their schemas are stripped.
      const props: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(value)) props[name] = walk(sub);
      out[key] = props;
      continue;
    }
    out[key] = walk(value);
  }
  return out;
}

/** The schema without the keywords OpenAI's strict mode rejects; required and additionalProperties stay. */
export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return strip(schema);
}

export const RESPONSES_MAX_OUTPUT_TOKENS = 4000;

const SCHEMAS: Readonly<Record<RemoteTask, Record<string, unknown>>> = {
  explain: EXPLANATION_JSON_SCHEMA,
  prioritise: PRIORITISATION_JSON_SCHEMA,
  ask: ANSWER_JSON_SCHEMA,
};

export interface ResponsesRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: readonly RemoteTurn[];
  readonly store: false;
  readonly stream: true;
  readonly max_output_tokens: number;
  readonly reasoning?: { readonly effort: "low" };
  readonly text?: {
    readonly format: {
      readonly type: "json_schema";
      readonly name: RemoteTask;
      readonly schema: Record<string, unknown>;
      readonly strict: true;
    };
  };
}

/** The POST body for the Responses API. plainOutput drops reasoning and the schema for accounts that reject them. */
export function responsesRequestBody(
  task: RemoteTask,
  model: string,
  instructions: string,
  turns: readonly RemoteTurn[],
  options: { readonly plainOutput?: boolean } = {},
): ResponsesRequest {
  const base = {
    model,
    instructions,
    input: turns,
    store: false as const,
    stream: true as const,
    max_output_tokens: RESPONSES_MAX_OUTPUT_TOKENS,
  };
  if (options.plainOutput === true) return base;
  return {
    ...base,
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: task, schema: strictSchema(SCHEMAS[task]), strict: true } },
  };
}

export const CHATGPT_MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** Empty means the account's first model slug, which Rust returns with every chatgpt_token. */
export const DEFAULT_CHATGPT_MODEL = "";
