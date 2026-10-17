import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AskInput, Turn } from "../../src/ports/explainer-port";
import { SAFE_STRING_PATTERN } from "../../src/ports/explainer-port";
import { SIGNAL_IDS } from "../../src/ports/watch-port";
import { buildAllowed, toAllowedInput } from "../../src/chat/allowed";
import { CHAT_EVENTS, type ChatInput } from "../../src/chat/input";
import { evaluate } from "../../src/engine/evaluate";
import { toExplainerContext } from "../../src/explainer/context";
import { toWatchContext } from "../../src/explainer/watch-context";
import {
  CHATGPT_MODEL_PATTERN,
  DEFAULT_CHATGPT_MODEL,
  RESPONSES_MAX_OUTPUT_TOKENS,
  askTurns,
  chatTurns,
  claudePromptFor,
  explainTurns,
  plainNamesBlock,
  prioritiseTurns,
  responsesRequestBody,
  strictSchema,
  watchRequestBody,
  watchTurns,
  CHAT_INSTRUCTIONS_BLOCK,
  WATCH_INSTRUCTIONS_BLOCK,
  buildChatInstructions,
  buildWatchInstructions,
} from "../../src/explainer/remote";
import type { RemoteTask, RemoteTurn } from "../../src/explainer/remote";
import { ANSWER_JSON_SCHEMA, CHAT_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA, WATCH_JSON_SCHEMA } from "../../src/explainer/schemas";
import { ACCEPTED_SENTENCE, buildExplainerSystemPrompt, buildSystemPrompt } from "../../src/explainer/system-prompt";
import { EMPTY_GUIDED_MEMORY } from "../../src/guided/memory";
import { buildGuidedPlan } from "../../src/guided/plan";
import { freeFixRuleIds } from "../../src/license/entitled";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor, NOW } from "../helpers";
import { EMPTY_WATCH_MEMORY } from "../../src/watch/memory";
import { CANARY, CANARY_NEXT, CANARY_PROFILE as PROFILE, INJECT, inj } from "../helpers/canary-state";

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
const chatInstructions = buildChatInstructions();
const TASKS = ["explain", "prioritise", "ask", "watch", "chat"] as const;
/** The WatchDetails field names, which may never appear in any body. */
const DETAILS_FIELDS = ["plistPath", "label", "programPath", "port", "processName", "filePath", "signature", "wifiAvailable"];

/** A validated answer from an earlier turn, as the UI stores it in the history. */
const PRIOR_ANSWER = JSON.stringify({ answer: "Start with disk encryption.", relatedRuleIds: ["TL-MAC-001"], outsideScope: false });
const HISTORY: readonly Turn[] = [
  { role: "user", text: "Which should I do first?" },
  { role: "assistant", text: PRIOR_ANSWER },
];
const ASK: AskInput = { context, history: HISTORY, question: "What about backups?" };

/** The chat input on the canary report: the plan and allow-lists from the real builders, every event once, the watch ids only. */
function chatInputFor(question: string): ChatInput {
  const gate = { freeFixes: freeFixRuleIds(report), licensed: true };
  const plan = buildGuidedPlan(report, gate, PROFILE, EMPTY_GUIDED_MEMORY, NOW);
  const watchItems = watchContext.signals.map((signal) => signal.signalId);
  const allowed = buildAllowed({ plan, report, gate, scanReady: true, watchEnabled: true, memory: EMPTY_GUIDED_MEMORY, doneStepIds: [], watchItems });
  const stepRuleIds = plan.steps.flatMap((step) => (step.kind === "batch" ? [step.ruleIds[0] ?? "TL-MAC-002"] : step.kind === "fix" || step.kind === "show" ? [step.ruleId] : []));
  return {
    context,
    history: HISTORY,
    question,
    plan: { stepRuleIds, fixed: [], later: plan.later, accepted: plan.accepted, leftAlone: plan.leftAlone },
    allowed: toAllowedInput(allowed),
    events: CHAT_EVENTS.map((kind, i) => ({ kind, ruleIds: [stepRuleIds[0] ?? "TL-MAC-001"], turnsAgo: i })),
    watch: {
      enabled: true,
      rating: "keep_an_eye",
      lastCheckMinutesAgo: 10,
      items: watchContext.signals.map((signal) => ({ signalId: signal.signalId, kind: "persistence" as const, change: signal.change })),
    },
  };
}
const CHAT = chatInputFor("Why does the disk matter?");

const TURNS: Readonly<Record<RemoteTask, readonly RemoteTurn[]>> = {
  explain: explainTurns({ context, ruleId: "TL-MAC-001" }),
  prioritise: prioritiseTurns({ context }),
  ask: askTurns(ASK),
  watch: watchTurns(watchContext),
  chat: chatTurns(CHAT),
};

/** One row per remote adapter: the exact bytes that leave the Mac for each task. The watch body is the Rust caller's. */
const ADAPTERS = [
  { id: "chatgpt", body: (task: RemoteTask) => JSON.stringify(task === "watch" ? watchRequestBody("gpt-5", watchInstructions, watchContext) : responsesRequestBody(task, "gpt-5", task === "chat" ? chatInstructions : instructions, TURNS[task])) },
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
      expect(body.instructions).toBe(task === "watch" ? watchInstructions : task === "chat" ? chatInstructions : instructions);
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

  /** The words the chat envelope may never carry: licence state, the password dialog, every path field. */
  const CHAT_FORBIDDEN = ["licensed", "locked", "unlocked", "wrong_password", "cancelled", "/Users", "sharePath", "plistPath", "label"];

  for (const adapter of ADAPTERS) {
    it(`${adapter.id} chat: the envelope carries ids and enums only, none of the forbidden words`, () => {
      const body = adapter.body("chat");
      // The ChatGPT body wraps the instructions too, whose plain names say "locked"; the envelope is the turns.
      const turns = adapter.id === "chatgpt" ? JSON.stringify((JSON.parse(body) as { input: unknown }).input) : body;
      expect(turns).toContain('{\\"task\\":\\"chat\\"');
      for (const word of CHAT_FORBIDDEN) expect(turns, word).not.toContain(word);
      const last = JSON.parse(TURNS.chat.at(-1)?.content ?? "{}") as { plan: Record<string, string[]>; allowed: Record<string, string[]>; events: { ruleIds: string[] }[]; watch: { items: { signalId: string }[] } };
      const known = new Set<string>(report.results.map((r) => r.ruleId));
      const ids = [...Object.values(last.plan).flat(), ...Object.entries(last.allowed).filter(([k]) => k !== "kinds" && k !== "investigate").flatMap(([, v]) => v), ...last.events.flatMap((e) => e.ruleIds)];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(id, id).toMatch(SAFE_STRING_PATTERN);
        expect(known.has(id), id).toBe(true);
      }
      // Signal ids run past SAFE_STRING_PATTERN's 32 characters; membership in SIGNAL_IDS is the check.
      for (const id of last.allowed["investigate"] ?? []) expect(SIGNAL_IDS as readonly string[]).toContain(id);
      expect(last.allowed["remind"]?.length).toBeGreaterThan(0);
      expect(last.allowed["whatIf"]?.length).toBeGreaterThan(0);
      expect(last.watch.items.length).toBeGreaterThan(0);
      for (const item of last.watch.items) expect(SIGNAL_IDS as readonly string[]).toContain(item.signalId);
    });
  }

  it("the injected question appears only inside \"question\":", () => {
    const turns = chatTurns(chatInputFor(inj("question")));
    const last = turns.at(-1)?.content ?? "";
    const marker = `"question":${JSON.stringify(inj("question"))}`;
    expect(last).toContain(marker);
    expect(last.split(INJECT)).toHaveLength(2);
    expect(JSON.stringify(turns.slice(0, -1))).not.toContain(INJECT);
    for (const adapter of ADAPTERS) {
      const body = adapter.body("chat");
      expect(body).not.toContain(INJECT);
    }
  });

  it("the chat block reaches neither the watch instructions nor their fixture, and the chat instructions equal their own", () => {
    const dir = join(__dirname, "..", "..", "fixtures");
    const pinnedWatch = readFileSync(join(dir, "watch-instructions.txt"), "utf8");
    expect(pinnedWatch.startsWith(buildSystemPrompt(MACOS_CATALOG))).toBe(true);
    for (const text of [pinnedWatch, watchInstructions]) {
      expect(text).not.toContain(CHAT_INSTRUCTIONS_BLOCK);
      expect(text).not.toContain("Plain names");
      expect(text).not.toContain("`intents`");
    }
    expect(readFileSync(join(dir, "chat-instructions.txt"), "utf8")).toBe(chatInstructions);
  });

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

  it("chatTurns keeps the clamped history, ends on the envelope, and takes the ask word for plainOutput", () => {
    const turns = TURNS.chat;
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[1]?.content).toBe(PRIOR_ANSWER);
    const last = JSON.parse(turns[2]?.content ?? "{}") as Record<string, unknown>;
    expect(Object.keys(last)).toEqual(["task", "context", "question", "plan", "allowed", "events", "watch"]);
    expect(last["task"]).toBe("chat");
    expect(last["question"]).toBe("Why does the disk matter?");
    expect(Object.keys(last["allowed"] as object)).toEqual(["fix", "batch", "show", "explain", "details", "snooze", "accept", "investigate", "remind", "whatIf", "kinds"]);
    expect(Object.keys(last["plan"] as object)).toEqual(["stepRuleIds", "fixed", "later", "accepted", "leftAlone"]);
    const asked = JSON.parse(chatTurns(CHAT, "ask").at(-1)?.content ?? "{}") as Record<string, unknown>;
    expect(asked["task"]).toBe("ask");
    expect({ ...asked, task: "chat" }).toEqual(last);
    const long = chatTurns({ ...CHAT, question: "q".repeat(600), history: Array.from({ length: 9 }, (_, i) => ({ role: i % 2 === 0 ? ("user" as const) : ("assistant" as const), text: `${i}` })) });
    // Nine turns clamp to six, the leading assistant turn is dropped, the envelope closes: six turns.
    expect(long).toHaveLength(6);
    expect(long[0]?.content).toBe("4");
    expect((JSON.parse(long.at(-1)?.content ?? "{}") as { question: string }).question.length).toBe(500);
    expect(chatTurns({ ...CHAT, history: [{ role: "assistant", text: PRIOR_ANSWER }] })).toHaveLength(1);
  });

  it("buildChatInstructions is the frozen prompt, the chat block and every guided headline, under 2,000 characters of names", () => {
    expect(chatInstructions).toBe(`${buildSystemPrompt(MACOS_CATALOG)}\n\n${CHAT_INSTRUCTIONS_BLOCK}\n\n${plainNamesBlock()}`);
    expect(chatInstructions.startsWith(watchInstructions.slice(0, watchInstructions.length - WATCH_INSTRUCTIONS_BLOCK.length))).toBe(true);
    expect(CHAT_INSTRUCTIONS_BLOCK.startsWith("For the chat task: answer the person in plain British English and plain words.")).toBe(true);
    expect(CHAT_INSTRUCTIONS_BLOCK).toContain("use `accept_rule`");
    // The register and the paragraph rule, as decided on 2026-10-17.
    expect(CHAT_INSTRUCTIONS_BLOCK).toContain('you are not Talos Labs: call it "the app"');
    expect(CHAT_INSTRUCTIONS_BLOCK).toContain("Never say that you did, will do, are doing, or have changed anything on the Mac");
    expect(CHAT_INSTRUCTIONS_BLOCK).toContain("Answer a greeting with one friendly sentence and then what you can help with.");
    expect(CHAT_INSTRUCTIONS_BLOCK).toContain("short paragraphs of at most three sentences, with a blank line between paragraphs");
    expect(CHAT_INSTRUCTIONS_BLOCK).toContain("Leave `relatedRuleIds` empty for a greeting or small talk.");
    expect(CHAT_INSTRUCTIONS_BLOCK).not.toContain("second person");
    expect(chatInstructions).not.toContain("IGNORE");
    for (const rule of MACOS_CATALOG.rules) expect(plainNamesBlock()).toContain(`${rule.id}: ${rule.guided.headline}`);
    expect(plainNamesBlock().length).toBeGreaterThan(900);
    expect(plainNamesBlock().length).toBeLessThan(2000);
    expect(chatInstructions).not.toContain(ACCEPTED_SENTENCE);
  });

  it("claudePromptFor wraps the turns in one JSON document", () => {
    expect(claudePromptFor(TURNS.prioritise)).toBe(JSON.stringify({ turns: TURNS.prioritise }));
    expect(JSON.parse(claudePromptFor(TURNS.ask))).toEqual({ turns: TURNS.ask });
  });
});

describe("responsesRequestBody", () => {
  it("builds the strict streaming request for every task", () => {
    const schemas = { explain: EXPLANATION_JSON_SCHEMA, prioritise: PRIORITISATION_JSON_SCHEMA, ask: ANSWER_JSON_SCHEMA, chat: CHAT_JSON_SCHEMA } as const;
    for (const task of ["explain", "prioritise", "ask", "chat"] as const) {
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
