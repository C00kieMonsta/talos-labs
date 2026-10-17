import { ANSWER_JSON_SCHEMA, CHAT_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, MACOS_CATALOG, PRIORITISATION_JSON_SCHEMA, buildChatInstructions, buildExplainerSystemPrompt, chatTurns } from "@talos/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OLLAMA_MODEL, OLLAMA_CHAT_URL, OllamaExplainerAdapter } from "./ollama-explainer";
import { TEST_CHAT_CALL, TEST_CONTEXT, TEST_REPORT, VALID_ANSWER, VALID_CHAT, VALID_EXPLANATION, VALID_PRIORITISATION } from "./test-fixtures";

const fetchMock = vi.fn<typeof fetch>();

interface ChatBody {
  model: string;
  stream: boolean;
  format: unknown;
  messages: { role: string; content: string }[];
}

function reply(content: unknown, status = 200): Response {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  return new Response(JSON.stringify({ message: { role: "assistant", content: text } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Behaves like a real fetch on abort: rejects at once if already aborted, else when the signal fires. */
function hangUntilAborted(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

function adapter(model?: string): OllamaExplainerAdapter {
  return new OllamaExplainerAdapter({
    reportSource: async () => TEST_REPORT,
    systemPrompt: "SYSTEM PROMPT",
    fetchImpl: fetchMock,
    ...(model === undefined ? {} : { model }),
  });
}

function sentBody(): ChatBody {
  const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
  return JSON.parse(init.body as string) as ChatBody;
}

const explainInput = { context: TEST_CONTEXT, ruleId: "TL-MAC-001" as const };
/** TEST_CONTEXT with 001 marked as left alone by the person. */
const ACCEPTED_CONTEXT = { ...TEST_CONTEXT, findings: TEST_CONTEXT.findings.map((f) => (f.ruleId === "TL-MAC-001" ? { ...f, accepted: true } : f)) };
const PRIORITISATION_WITHOUT_001 = { order: ["TL-MAC-002", "TL-MAC-023"], reasons: [{ ruleId: "TL-MAC-002", reason: "The firewall is quick." }], startWith: ["TL-MAC-002"] } as const;

beforeEach(() => {
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OllamaExplainerAdapter request shape", () => {
  it("posts to the fixed local URL with stream false, the schema as format and the system prompt first", async () => {
    fetchMock.mockResolvedValueOnce(reply(VALID_EXPLANATION));
    const result = await adapter().explain(explainInput);
    expect(result).toEqual({ ok: true, value: VALID_EXPLANATION });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(url).toBe(OLLAMA_CHAT_URL);
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = sentBody();
    expect(body.model).toBe(DEFAULT_OLLAMA_MODEL);
    expect(body.stream).toBe(false);
    expect(body.format).toEqual(EXPLANATION_JSON_SCHEMA);
    expect(body.messages[0]).toEqual({ role: "system", content: "SYSTEM PROMPT" });
    expect(body.messages[1]?.role).toBe("user");
    const user = JSON.parse(body.messages[1]?.content ?? "") as { task: string; ruleId: string; context: unknown };
    expect(user.task).toBe("explain");
    expect(user.ruleId).toBe("TL-MAC-001");
    expect(user.context).toEqual(TEST_CONTEXT);
  });

  it("uses the prioritisation schema for prioritise", async () => {
    fetchMock.mockResolvedValueOnce(reply(VALID_PRIORITISATION));
    expect(await adapter().prioritise({ context: TEST_CONTEXT })).toEqual({ ok: true, value: VALID_PRIORITISATION });
    expect(sentBody().format).toEqual(PRIORITISATION_JSON_SCHEMA);
  });

  it("builds ask from history plus the clamped question", async () => {
    fetchMock.mockResolvedValueOnce(reply(VALID_ANSWER));
    const history = [
      { role: "user" as const, text: "Is my disk safe?" },
      { role: "assistant" as const, text: "No, FileVault is off." },
    ];
    const result = await adapter().ask({ context: TEST_CONTEXT, history, question: "x".repeat(10_000) });
    expect(result).toEqual({ ok: true, value: VALID_ANSWER });
    const body = sentBody();
    expect(body.format).toEqual(ANSWER_JSON_SCHEMA);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    const last = JSON.parse(body.messages[3]?.content ?? "") as { task: string; question: string };
    expect(last.task).toBe("ask");
    expect(last.question.length).toBeLessThanOrEqual(2000);
  });

  it("falls back to the default model when the override fails the pattern", async () => {
    fetchMock.mockResolvedValueOnce(reply(VALID_EXPLANATION));
    await adapter("Llama 3; rm -rf /").explain(explainInput);
    expect(sentBody().model).toBe(DEFAULT_OLLAMA_MODEL);
  });

  it("keeps a well-formed model override", async () => {
    fetchMock.mockResolvedValueOnce(reply(VALID_EXPLANATION));
    await adapter("llama3.1:8b-instruct").explain(explainInput);
    expect(sentBody().model).toBe("llama3.1:8b-instruct");
  });
});

describe("OllamaExplainerAdapter chat", () => {
  it("sends the chat instructions as the system message with the chat schema as format, and one partial", async () => {
    fetchMock.mockResolvedValueOnce(reply(VALID_CHAT));
    const partials: unknown[] = [];
    const result = await adapter().chat(TEST_CHAT_CALL, { onPartial: (p) => partials.push(p) });
    expect(result).toEqual({ ok: true, value: { ...VALID_CHAT, locked: [] } });
    const body = sentBody();
    expect(body.format).toEqual(CHAT_JSON_SCHEMA);
    expect(body.messages[0]).toEqual({ role: "system", content: buildChatInstructions(MACOS_CATALOG) });
    expect(body.messages.slice(1)).toEqual(chatTurns(TEST_CHAT_CALL.input));
    expect(partials).toEqual([{ ...VALID_CHAT, locked: [] }]);
    fetchMock.mockResolvedValueOnce(reply({ ...VALID_CHAT, reply: "The app will fix it" }));
    expect(await adapter().chat(TEST_CHAT_CALL)).toEqual({ ok: false, reason: "rejected_output" });
  });
});

describe("OllamaExplainerAdapter failure mapping", () => {
  it("maps a thrown fetch to network", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "network" });
  });

  it("maps a non-2xx status to unknown", async () => {
    fetchMock.mockResolvedValueOnce(reply("", 404));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "unknown" });
  });

  it("maps the 60 s timeout to timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(hangUntilAborted);
    const pending = adapter().explain(explainInput);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
  });

  it("forwards an external abort and reports it as network", async () => {
    fetchMock.mockImplementationOnce(hangUntilAborted);
    const controller = new AbortController();
    const pending = adapter().explain(explainInput, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "network" });
  });

  it("rejects content that is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(reply("```json\n{}\n```"));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "rejected_output" });
  });

  it("rejects a reply without message.content", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ done: true }), { status: 200 }));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "rejected_output" });
  });

  it("applies the core validator: a fenced block inside a field is rejected", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ ...VALID_EXPLANATION, whatCouldHappen: "Try:\n```sh\nsudo rm -rf /\n```" }),
    );
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "rejected_output" });
  });

  it("applies the core validator: a foreign rule id in the order is rejected", async () => {
    fetchMock.mockResolvedValueOnce(reply({ ...VALID_PRIORITISATION, order: ["TL-MAC-001", "TL-MAC-999"] }));
    expect(await adapter().prioritise({ context: TEST_CONTEXT })).toEqual({ ok: false, reason: "rejected_output" });
  });
});

describe("OllamaExplainerAdapter and the rules the person chose to leave", () => {
  it("defaults to the explainer instructions with the accepted sentence", async () => {
    fetchMock.mockResolvedValueOnce(reply(VALID_EXPLANATION));
    const plain = new OllamaExplainerAdapter({ reportSource: async () => TEST_REPORT, fetchImpl: fetchMock });
    expect(await plain.explain(explainInput)).toEqual({ ok: true, value: VALID_EXPLANATION });
    expect(sentBody().messages[0]).toEqual({ role: "system", content: buildExplainerSystemPrompt(MACOS_CATALOG) });
  });

  it("rejects an order that names an accepted rule, accepts one without it, and never shows the accepted row", async () => {
    fetchMock.mockResolvedValueOnce(reply(VALID_PRIORITISATION));
    expect(await adapter().prioritise({ context: ACCEPTED_CONTEXT })).toEqual({ ok: false, reason: "rejected_output" });
    expect(sentBody().messages[1]?.content).not.toContain("TL-MAC-001");
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(reply(PRIORITISATION_WITHOUT_001));
    expect(await adapter().prioritise({ context: ACCEPTED_CONTEXT })).toEqual({ ok: true, value: PRIORITISATION_WITHOUT_001 });
  });
});
