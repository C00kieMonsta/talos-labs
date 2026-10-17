import { describe, expect, it } from "vitest";
import type { AskInput, Turn } from "../../src/ports/explainer-port";
import { evaluate } from "../../src/engine/evaluate";
import { toExplainerContext } from "../../src/explainer/context";
import {
  CHATGPT_MODEL_PATTERN,
  DEFAULT_CHATGPT_MODEL,
  RESPONSES_MAX_OUTPUT_TOKENS,
  askTurns,
  claudePromptFor,
  explainTurns,
  prioritiseTurns,
  responsesRequestBody,
  strictSchema,
} from "../../src/explainer/remote";
import type { RemoteTask, RemoteTurn } from "../../src/explainer/remote";
import { ANSWER_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA } from "../../src/explainer/schemas";
import { buildSystemPrompt } from "../../src/explainer/system-prompt";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor } from "../helpers";
import { CANARY, CANARY_PROFILE as PROFILE, INJECT } from "../helpers/canary-state";

const report = evaluate(CANARY, MACOS_CATALOG, ctxFor(CANARY));
const context = toExplainerContext(report, MACOS_CATALOG, PROFILE);
const instructions = buildSystemPrompt(MACOS_CATALOG);

/** A validated answer from an earlier turn, as the UI stores it in the history. */
const PRIOR_ANSWER = JSON.stringify({ answer: "Start with disk encryption.", relatedRuleIds: ["TL-MAC-001"], outsideScope: false });
const HISTORY: readonly Turn[] = [
  { role: "user", text: "Which should I do first?" },
  { role: "assistant", text: PRIOR_ANSWER },
];
const ASK: AskInput = { context, history: HISTORY, question: "What about backups?" };

const TURNS: Readonly<Record<RemoteTask, readonly RemoteTurn[]>> = {
  explain: explainTurns({ context, ruleId: "TL-MAC-001" }),
  prioritise: prioritiseTurns({ context }),
  ask: askTurns(ASK),
};

/** One row per remote adapter: the exact bytes that leave the Mac for each task. */
const ADAPTERS = [
  { id: "chatgpt", body: (task: RemoteTask) => JSON.stringify(responsesRequestBody(task, "gpt-5", instructions, TURNS[task])) },
  { id: "claude_plan", body: (task: RemoteTask) => claudePromptFor(TURNS[task]) },
] as const;

/** A line only the catalogue carries. */
const CATALOG_MARKER = "Why it matters:";
const RULE_TITLE = MACOS_CATALOG.rules[0]?.title ?? "";

describe("remote request canary", () => {
  it("the canary report carries the injected strings", () => {
    expect(JSON.stringify(report)).toContain(INJECT);
    expect(RULE_TITLE.length).toBeGreaterThan(0);
    expect(instructions).toContain(CATALOG_MARKER);
    expect(instructions).toContain(RULE_TITLE);
  });

  for (const adapter of ADAPTERS) {
    for (const task of ["explain", "prioritise", "ask"] as const) {
      it(`${adapter.id} ${task}: no injected string reaches the request body`, () => {
        const body = adapter.body(task);
        expect(body).not.toContain(INJECT);
        expect(body).not.toContain("IGNORE");
      });
    }
  }

  for (const task of ["explain", "prioritise", "ask"] as const) {
    it(`chatgpt ${task}: catalogue text is in instructions only, never in the input turns`, () => {
      const body = JSON.parse(ADAPTERS[0].body(task)) as { instructions: string; input: RemoteTurn[] };
      expect(body.instructions).toBe(instructions);
      const turns = JSON.stringify(body.input);
      expect(turns).not.toContain(CATALOG_MARKER);
      expect(turns).not.toContain(RULE_TITLE);
    });

    it(`claude_plan ${task}: the prompt carries no catalogue text`, () => {
      const body = ADAPTERS[1].body(task);
      expect(body).not.toContain(CATALOG_MARKER);
      expect(body).not.toContain(RULE_TITLE);
    });
  }

  it("the ask body keeps the validated history and the question", () => {
    const turns = TURNS.ask;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[1]?.content).toBe(PRIOR_ANSWER);
    expect(turns[2]?.content).toContain('"question":"What about backups?"');
  });
});

describe("turn envelopes", () => {
  it("explainTurns pins the task, ruleId, context key order", () => {
    const turns = TURNS.explain;
    expect(turns).toHaveLength(1);
    expect(turns[0]?.role).toBe("user");
    expect(turns[0]?.content.startsWith('{"task":"explain","ruleId":"TL-MAC-001","context":{"schemaVersion":1,"os":"macos",')).toBe(true);
    expect(turns[0]?.content).toBe(JSON.stringify({ task: "explain", ruleId: "TL-MAC-001", context }));
  });

  it("prioritiseTurns and askTurns pin their envelopes", () => {
    expect(TURNS.prioritise).toEqual([{ role: "user", content: JSON.stringify({ task: "prioritise", context }) }]);
    expect(TURNS.ask[2]).toEqual({ role: "user", content: JSON.stringify({ task: "ask", context, question: "What about backups?" }) });
  });

  it("askTurns drops leading assistant turns and ends on the question", () => {
    const turns = askTurns({ ...ASK, history: [{ role: "assistant", text: PRIOR_ANSWER }, ...HISTORY] });
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(askTurns({ ...ASK, history: [] })).toHaveLength(1);
  });

  it("claudePromptFor wraps the turns in one JSON document", () => {
    expect(claudePromptFor(TURNS.prioritise)).toBe(JSON.stringify({ turns: TURNS.prioritise }));
    expect(JSON.parse(claudePromptFor(TURNS.ask))).toEqual({ turns: TURNS.ask });
  });
});

describe("responsesRequestBody", () => {
  it("builds the strict streaming request for every task", () => {
    const schemas = { explain: EXPLANATION_JSON_SCHEMA, prioritise: PRIORITISATION_JSON_SCHEMA, ask: ANSWER_JSON_SCHEMA } as const;
    for (const task of ["explain", "prioritise", "ask"] as const) {
      const body = responsesRequestBody(task, "gpt-5", instructions, TURNS[task]);
      expect(body).toEqual({
        model: "gpt-5",
        instructions,
        input: TURNS[task],
        store: false,
        stream: true,
        max_output_tokens: RESPONSES_MAX_OUTPUT_TOKENS,
        reasoning: { effort: "low" },
        text: { format: { type: "json_schema", name: task, schema: strictSchema(schemas[task]), strict: true } },
      });
      expect(JSON.stringify(body.text?.format.schema)).not.toContain("minLength");
    }
    expect(RESPONSES_MAX_OUTPUT_TOKENS).toBe(4000);
  });

  it("plainOutput omits reasoning and text and nothing else", () => {
    const body = responsesRequestBody("explain", "gpt-5", instructions, TURNS.explain, { plainOutput: true });
    expect(body).toEqual({ model: "gpt-5", instructions, input: TURNS.explain, store: false, stream: true, max_output_tokens: 4000 });
    expect("reasoning" in body).toBe(false);
    expect("text" in body).toBe(false);
  });

  it("pins the JSON key order", () => {
    const text = JSON.stringify(responsesRequestBody("ask", "gpt-5", "i", []));
    expect(text).toBe('{"model":"gpt-5","instructions":"i","input":[],"store":false,"stream":true,"max_output_tokens":4000,"reasoning":{"effort":"low"},"text":{"format":{"type":"json_schema","name":"ask","schema":' + JSON.stringify(strictSchema(ANSWER_JSON_SCHEMA)) + ',"strict":true}}}');
  });
});

describe("ChatGPT model id", () => {
  it("the default is empty, meaning the account's first slug", () => {
    expect(DEFAULT_CHATGPT_MODEL).toBe("");
    expect(CHATGPT_MODEL_PATTERN.test(DEFAULT_CHATGPT_MODEL)).toBe(false);
  });

  it("the pattern accepts slugs and rejects spaces, uppercase and overlong ids", () => {
    for (const ok of ["gpt-5", "gpt-5.1-mini", "o4", "a".repeat(64)]) expect(CHATGPT_MODEL_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["GPT-5", "gpt 5", "-gpt", ".x", "a".repeat(65), "gpt_5"]) expect(CHATGPT_MODEL_PATTERN.test(bad), bad).toBe(false);
  });
});
