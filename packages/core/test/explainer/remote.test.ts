import { describe, expect, it } from "vitest";
import type { AskInput, Turn } from "../../src/ports/explainer-port";
import { evaluate } from "../../src/engine/evaluate";
import { toExplainerContext } from "../../src/explainer/context";
import { toWatchContext } from "../../src/explainer/watch-context";
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
  watchRequestBody,
  watchTurns,
  WATCH_INSTRUCTIONS_BLOCK,
  buildWatchInstructions,
} from "../../src/explainer/remote";
import type { RemoteTask, RemoteTurn } from "../../src/explainer/remote";
import { ANSWER_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA, WATCH_JSON_SCHEMA } from "../../src/explainer/schemas";
import { ACCEPTED_SENTENCE, buildExplainerSystemPrompt, buildSystemPrompt } from "../../src/explainer/system-prompt";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor } from "../helpers";
import { EMPTY_WATCH_MEMORY } from "../../src/watch/memory";
import { CANARY, CANARY_NEXT, CANARY_PROFILE as PROFILE, INJECT } from "../helpers/canary-state";

const report = evaluate(CANARY, MACOS_CATALOG, ctxFor(CANARY));
const context = toExplainerContext(report, MACOS_CATALOG, PROFILE);
const instructions = buildExplainerSystemPrompt(MACOS_CATALOG);
const watchContext = toWatchContext({
  previousReport: report,
  report: evaluate(CANARY_NEXT, MACOS_CATALOG, ctxFor(CANARY_NEXT)),
  readings: [{ signalId: "sig.persistence_set", kind: "digest", value: null, previous: null, change: "changed", changedAt: "2026-10-15T09:50:00.000Z", freshness: "fresh", previousFreshness: "fresh", gateAnswer: null }],
  memory: EMPTY_WATCH_MEMORY,
  recent: [],
  now: "2026-10-15T10:00:00.000Z",
  os: "macos",
  osVersion: CANARY_NEXT.host.osVersion,
  profile: PROFILE,
  cycle: { index: 1, minutesSinceFullCheck: 10, minutesSinceLastChange: 10, probesLeft: 3 },
  lastVerdict: null,
});
const watchInstructions = buildWatchInstructions();
const TASKS = ["explain", "prioritise", "ask", "watch"] as const;
/** The WatchDetails field names, which may never appear in any body. */
const DETAILS_FIELDS = ["plistPath", "label", "programPath", "port", "processName", "wifiAvailable"];

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
  watch: watchTurns(watchContext),
};

/** One row per remote adapter: the exact bytes that leave the Mac for each task. The watch body is the Rust caller's. */
const ADAPTERS = [
  { id: "chatgpt", body: (task: RemoteTask) => JSON.stringify(task === "watch" ? watchRequestBody("gpt-5", watchInstructions, watchContext) : responsesRequestBody(task, "gpt-5", instructions, TURNS[task])) },
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
    for (const task of TASKS) {
      it(`${adapter.id} ${task}: no injected string and no WatchDetails field name reaches the request body`, () => {
        const body = adapter.body(task);
        expect(body).not.toContain(INJECT);
        expect(body).not.toContain("IGNORE");
        for (const field of DETAILS_FIELDS) expect(body, field).not.toContain(`"${field}"`);
      });
    }
  }

  it("the watch pair carries the injected strings on both sides and the context none", () => {
    expect(JSON.stringify(CANARY_NEXT)).toContain(INJECT);
    expect(JSON.stringify(watchContext)).not.toContain(INJECT);
    expect(watchContext.osVersion).toBe("unknown");
  });

  for (const task of TASKS) {
    it(`chatgpt ${task}: catalogue text is in instructions only, never in the input turns`, () => {
      const body = JSON.parse(ADAPTERS[0].body(task)) as { instructions: string; input: RemoteTurn[] };
      expect(body.instructions).toBe(task === "watch" ? watchInstructions : instructions);
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

  it("watchTurns is one user turn with the task and the context, and the instructions add one block", () => {
    expect(TURNS.watch).toEqual([{ role: "user", content: JSON.stringify({ task: "watch", context: watchContext }) }]);
    expect(WATCH_INSTRUCTIONS_BLOCK).toBe("You rate, and choose probes and actions by id. You cannot run anything. The ids are the only vocabulary.");
    expect(watchInstructions).toBe(`${buildSystemPrompt(MACOS_CATALOG)}\n\n${WATCH_INSTRUCTIONS_BLOCK}`);
    expect(watchInstructions).not.toContain(ACCEPTED_SENTENCE);
    expect(instructions).toContain(ACCEPTED_SENTENCE);
  });

  it("prioritiseTurns drops an accepted row; explainTurns and askTurns keep it with the flag", () => {
    const marked = toExplainerContext(report, MACOS_CATALOG, PROFILE, ["TL-MAC-001"]);
    const sent = JSON.parse(prioritiseTurns({ context: marked })[0]?.content ?? "{}") as { context: { findings: { ruleId: string; accepted: boolean }[] } };
    expect(sent.context.findings.some((f) => f.accepted)).toBe(false);
    expect(sent.context.findings.map((f) => f.ruleId)).not.toContain("TL-MAC-001");
    expect(sent.context.findings).toHaveLength(marked.findings.length - 1);
    expect(prioritiseTurns({ context: marked })[0]?.content).not.toContain('"accepted":true');
    const explained = JSON.parse(explainTurns({ context: marked, ruleId: "TL-MAC-001" })[0]?.content ?? "{}") as { context: { findings: { ruleId: string; accepted: boolean }[] } };
    expect(explained.context.findings.find((f) => f.ruleId === "TL-MAC-001")?.accepted).toBe(true);
    const asked = JSON.parse(askTurns({ ...ASK, context: marked }).at(-1)?.content ?? "{}") as { context: { findings: { ruleId: string; accepted: boolean }[] } };
    expect(asked.context.findings.find((f) => f.ruleId === "TL-MAC-001")?.accepted).toBe(true);
    expect(asked.context.findings).toHaveLength(marked.findings.length);
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

  it("stream and maxOutputTokens are options; the watch body is non-streaming at 1200 tokens", () => {
    const body = responsesRequestBody("watch", "gpt-5", watchInstructions, TURNS.watch, { stream: false, maxOutputTokens: 1200 });
    expect(body.stream).toBe(false);
    expect(body.max_output_tokens).toBe(1200);
    expect(body.text?.format).toEqual({ type: "json_schema", name: "watch", schema: strictSchema(WATCH_JSON_SCHEMA), strict: true });
    expect(watchRequestBody("gpt-5", watchInstructions, watchContext)).toEqual(body);
    expect(JSON.stringify(watchRequestBody("gpt-5", "i", watchContext)).startsWith('{"model":"gpt-5","instructions":"i","input":[{"role":"user","content":"{\\"task\\":\\"watch\\"')).toBe(true);
    expect(responsesRequestBody("ask", "gpt-5", "i", [], { plainOutput: true, stream: false, maxOutputTokens: 7 })).toEqual({ model: "gpt-5", instructions: "i", input: [], store: false, stream: false, max_output_tokens: 7 });
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
