import type { AllowedInput, ChatEventInput, ChatInput, ChatPlanInput, ChatWatchInput } from "../chat/input";
import type { RuleCatalog } from "../domain/rule";
import type { AskInput, ExplainInput, ExplainerContext, PrioritiseInput, Turn } from "../ports/explainer-port";
import type { WatchContext } from "../ports/watch-port";
import { WATCH_LIMITS } from "../ports/watch-port";
import { MACOS_CATALOG } from "../rules/macos/index";
import { clampChatHistory, clampChatQuestion, clampHistory, clampQuestion } from "./limits";
import { ANSWER_JSON_SCHEMA, CHAT_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA, WATCH_JSON_SCHEMA } from "./schemas";
import { buildSystemPrompt } from "./system-prompt";

/**
 * Request bodies for the remote providers (ChatGPT over the Responses API, Claude through
 * Claude Code). Built here so the canary test covers the literal bytes that leave the Mac.
 * Dependency-free: the desktop adapters only add the transport.
 */

export type RemoteTask = "explain" | "prioritise" | "ask" | "watch" | "chat";

export interface RemoteTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

interface TaskEnvelope {
  readonly task: RemoteTask;
  readonly context: ExplainerContext | WatchContext;
  readonly ruleId?: string;
  readonly question?: string;
  readonly plan?: ChatPlanInput;
  readonly allowed?: AllowedInput;
  readonly events?: readonly ChatEventInput[];
  readonly watch?: ChatWatchInput;
}

function envelope(e: TaskEnvelope): string {
  return JSON.stringify(e);
}

export function explainTurns(input: ExplainInput): readonly RemoteTurn[] {
  return [{ role: "user", content: envelope({ task: "explain", ruleId: input.ruleId, context: input.context }) }];
}

/** Accepted findings leave the document before the model sees it; a proposal about them is never asked for. */
export function prioritiseTurns(input: PrioritiseInput): readonly RemoteTurn[] {
  const context: ExplainerContext = { ...input.context, findings: input.context.findings.filter((f) => !f.accepted) };
  return [{ role: "user", content: envelope({ task: "prioritise", context }) }];
}

/** Validated history first, the clamped question last, never an assistant turn at the end. */
export function askTurns(input: AskInput): readonly RemoteTurn[] {
  const turns = usableTurns(clampHistory(input.history));
  turns.push({
    role: "user",
    content: envelope({ task: "ask", context: input.context, question: clampQuestion(input.question) }),
  });
  return turns;
}

/** Leading assistant turns are dropped so the conversation never opens on the model. */
function usableTurns(history: readonly Turn[]): RemoteTurn[] {
  const firstUser = history.findIndex((t) => t.role === "user");
  const usable = firstUser === -1 ? [] : history.slice(firstUser);
  return usable.map((t) => ({ role: t.role, content: t.text }));
}

/**
 * The chat turn: the clamped history first, then one user turn with the envelope
 * { task, context, question, plan, allowed, events, watch }. The task word is "ask" on the
 * ChatGPT plainOutput path, which answers in the ask shape; the envelope is otherwise the same.
 */
export function chatTurns(input: ChatInput, task: "chat" | "ask" = "chat"): readonly RemoteTurn[] {
  const turns = usableTurns(clampChatHistory(input.history, "remote"));
  turns.push({
    role: "user",
    content: envelope({
      task,
      context: input.context,
      question: clampChatQuestion(input.question),
      plan: input.plan,
      allowed: input.allowed,
      events: input.events,
      watch: input.watch,
    }),
  });
  return turns;
}

/** One user turn: { task: "watch", context }. The watch context is the only document the model receives. */
export function watchTurns(context: WatchContext): readonly RemoteTurn[] {
  return [{ role: "user", content: envelope({ task: "watch", context }) }];
}

/** The one block the watch task adds to the frozen system prompt. */
export const WATCH_INSTRUCTIONS_BLOCK = "You rate, and choose probes and actions by id. You cannot run anything. The ids are the only vocabulary.";

/** The frozen system prompt plus the watch block. Rust reads the same text from fixtures/watch-instructions.txt. */
export function buildWatchInstructions(): string {
  return `${buildSystemPrompt(MACOS_CATALOG)}\n\n${WATCH_INSTRUCTIONS_BLOCK}`;
}

/** The chat task's block, verbatim from DESIGN-CHAT "The system prompt". */
export const CHAT_INSTRUCTIONS_BLOCK = [
  "For the chat task: answer the person in plain British English, in the second person, in at most four short sentences.",
  'Never write as "I", "we" or the app.',
  "Never say that you did, will do, are doing, or have changed anything: you cannot change anything, the app draws the buttons and the person decides.",
  "Never write what to click, type or run; never name a command, a file path or a setting's menu path.",
  "Name actions only in `intents`, as ids from `allowed`, at most three, most useful first; leave `intents` empty when nothing in `allowed` fits.",
  "Other tasks have no `intents` field.",
  "When the person asks to leave something alone, use `accept_rule`.",
  "When the person asks about something the check-up does not cover, set `outsideScope` to true and say so in one sentence.",
].join(" ");

/** Every rule's guided headline by id, so the model can say "your disk is not locked" rather than an id. */
export function plainNamesBlock(catalog: RuleCatalog = MACOS_CATALOG): string {
  const lines = ['Plain names, so you can say "your disk is not locked" rather than an id:'];
  for (const rule of catalog.rules) lines.push(`${rule.id}: ${rule.guided.headline}`);
  return lines.join("\n");
}

/** The frozen system prompt plus the chat block and the plain names; the chat task's instructions only. */
export function buildChatInstructions(catalog: RuleCatalog = MACOS_CATALOG): string {
  return `${buildSystemPrompt(catalog)}\n\n${CHAT_INSTRUCTIONS_BLOCK}\n\n${plainNamesBlock(catalog)}`;
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
  watch: WATCH_JSON_SCHEMA,
  chat: CHAT_JSON_SCHEMA,
};

export interface ResponsesRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: readonly RemoteTurn[];
  readonly store: false;
  readonly stream: boolean;
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

export interface ResponsesOptions {
  /** Drops reasoning and the schema for accounts that reject them. */
  readonly plainOutput?: boolean;
  /** Default true; the watch task reads one plain reply. */
  readonly stream?: boolean;
  /** Default RESPONSES_MAX_OUTPUT_TOKENS. */
  readonly maxOutputTokens?: number;
}

/** The POST body for the Responses API. */
export function responsesRequestBody(
  task: RemoteTask,
  model: string,
  instructions: string,
  turns: readonly RemoteTurn[],
  options: ResponsesOptions = {},
): ResponsesRequest {
  const base = {
    model,
    instructions,
    input: turns,
    store: false as const,
    stream: options.stream ?? true,
    max_output_tokens: options.maxOutputTokens ?? RESPONSES_MAX_OUTPUT_TOKENS,
  };
  if (options.plainOutput === true) return base;
  return {
    ...base,
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: task, schema: strictSchema(SCHEMAS[task]), strict: true } },
  };
}

/** The non-streaming watch request Rust sends from ai/chatgpt_watch.rs; the fixture pins both bodies. */
export function watchRequestBody(model: string, instructions: string, context: WatchContext): ResponsesRequest {
  return responsesRequestBody("watch", model, instructions, watchTurns(context), { stream: false, maxOutputTokens: WATCH_LIMITS.maxOutputTokens });
}

export const CHATGPT_MODEL_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** Empty means the account's first model slug, which Rust returns with every chatgpt_token. */
export const DEFAULT_CHATGPT_MODEL = "";
