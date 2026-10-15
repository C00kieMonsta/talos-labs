import Anthropic from "@anthropic-ai/sdk";
import { ANSWER_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA, type SecretStorePort } from "@talos/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeExplainerAdapter, DEFAULT_CLAUDE_MODEL } from "./claude-explainer";
import { TEST_CONTEXT, TEST_REPORT, VALID_ANSWER, VALID_EXPLANATION, VALID_PRIORITISATION } from "./test-fixtures";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class MockAnthropic extends actual.Anthropic {
    override messages = { create: createMock } as unknown as InstanceType<typeof actual.Anthropic>["messages"];
  }
  return { ...actual, default: MockAnthropic, Anthropic: MockAnthropic };
});

function textResponse(payload: unknown, stopReason: Anthropic.StopReason = "end_turn"): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_CLAUDE_MODEL,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    diagnostics: null,
    content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload), citations: null }],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      iterations: null,
      speed: null,
      output_tokens_details: null,
    } as unknown as Anthropic.Usage,
  } as unknown as Anthropic.Message;
}

function secrets(key: string | null): SecretStorePort {
  return { get: vi.fn(async () => key), set: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) };
}

function adapter(key: string | null = "sk-ant-test", model?: string): ClaudeExplainerAdapter {
  return new ClaudeExplainerAdapter({
    secrets: secrets(key),
    reportSource: async () => TEST_REPORT,
    systemPrompt: "SYSTEM PROMPT",
    ...(model === undefined ? {} : { model }),
  });
}

const explainInput = { context: TEST_CONTEXT, ruleId: "TL-MAC-001" as const };

beforeEach(() => {
  createMock.mockReset();
});

describe("ClaudeExplainerAdapter request shape", () => {
  it("sends the system prompt first with cache_control and a json_schema output format", async () => {
    createMock.mockResolvedValueOnce(textResponse(VALID_EXPLANATION));
    const result = await adapter().explain(explainInput);
    expect(result).toEqual({ ok: true, value: VALID_EXPLANATION });

    expect(createMock).toHaveBeenCalledTimes(1);
    const [params, options] = createMock.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming, { signal?: unknown }];
    expect(params.model).toBe(DEFAULT_CLAUDE_MODEL);
    expect(params.max_tokens).toBe(16000);
    expect(params.system).toEqual([{ type: "text", text: "SYSTEM PROMPT", cache_control: { type: "ephemeral" } }]);
    expect(params.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: EXPLANATION_JSON_SCHEMA } });
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("tools");
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0]?.role).toBe("user");
    const body = JSON.parse(params.messages[0]?.content as string) as { task: string; ruleId: string; context: unknown };
    expect(body.task).toBe("explain");
    expect(body.ruleId).toBe("TL-MAC-001");
    expect(body.context).toEqual(TEST_CONTEXT);
    expect(options).toHaveProperty("signal");
  });

  it("uses the prioritisation schema for prioritise", async () => {
    createMock.mockResolvedValueOnce(textResponse(VALID_PRIORITISATION));
    const result = await adapter().prioritise({ context: TEST_CONTEXT });
    expect(result).toEqual({ ok: true, value: VALID_PRIORITISATION });
    const [params] = createMock.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming];
    expect(params.output_config?.format).toEqual({ type: "json_schema", schema: PRIORITISATION_JSON_SCHEMA });
  });

  it("builds ask from clamped history plus the question, ending on a user turn", async () => {
    createMock.mockResolvedValueOnce(textResponse(VALID_ANSWER));
    const history = [
      { role: "user" as const, text: "Is my disk safe?" },
      { role: "assistant" as const, text: "No, FileVault is off." },
    ];
    const result = await adapter().ask({ context: TEST_CONTEXT, history, question: "What should I do first?" });
    expect(result).toEqual({ ok: true, value: VALID_ANSWER });
    const [params] = createMock.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming];
    expect(params.output_config).toEqual({ effort: "medium", format: { type: "json_schema", schema: ANSWER_JSON_SCHEMA } });
    expect(params.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(params.messages[0]?.content).toBe("Is my disk safe?");
    expect(params.messages[1]?.content).toBe("No, FileVault is off.");
    const last = JSON.parse(params.messages[2]?.content as string) as { task: string; question: string };
    expect(last.task).toBe("ask");
    expect(last.question).toBe("What should I do first?");
  });

  it("clamps a 10 kB question to the limit", async () => {
    createMock.mockResolvedValueOnce(textResponse(VALID_ANSWER));
    await adapter().ask({ context: TEST_CONTEXT, history: [], question: "x".repeat(10_000) });
    const [params] = createMock.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming];
    const last = JSON.parse(params.messages[0]?.content as string) as { question: string };
    expect(last.question.length).toBeLessThanOrEqual(2000);
  });

  it("falls back to the default model when the override is malformed", async () => {
    createMock.mockResolvedValueOnce(textResponse(VALID_EXPLANATION));
    await adapter("sk-ant-test", "gpt-4; rm -rf").explain(explainInput);
    const [params] = createMock.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming];
    expect(params.model).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("keeps a well-formed model override", async () => {
    createMock.mockResolvedValueOnce(textResponse(VALID_EXPLANATION));
    await adapter("sk-ant-test", "claude-sonnet-5").explain(explainInput);
    const [params] = createMock.mock.calls[0] as [Anthropic.MessageCreateParamsNonStreaming];
    expect(params.model).toBe("claude-sonnet-5");
  });
});

describe("ClaudeExplainerAdapter failure mapping", () => {
  it("returns no_api_key without calling the API when the keychain is empty", async () => {
    const result = await adapter(null).explain(explainInput);
    expect(result).toEqual({ ok: false, reason: "no_api_key" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("maps AuthenticationError to auth", async () => {
    createMock.mockRejectedValueOnce(new Anthropic.AuthenticationError(401, { type: "error" }, "invalid x-api-key", new Headers()));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "auth" });
  });

  it("maps APIConnectionTimeoutError to timeout", async () => {
    createMock.mockRejectedValueOnce(new Anthropic.APIConnectionTimeoutError());
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "timeout" });
  });

  it("maps APIConnectionError to network", async () => {
    createMock.mockRejectedValueOnce(new Anthropic.APIConnectionError({ message: "fetch failed" }));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "network" });
  });

  it("maps RateLimitError and other APIErrors to unknown", async () => {
    createMock.mockRejectedValueOnce(new Anthropic.RateLimitError(429, { type: "error" }, "slow down", new Headers()));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "unknown" });
    createMock.mockRejectedValueOnce(new Anthropic.InternalServerError(500, { type: "error" }, "boom", new Headers()));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "unknown" });
  });

  it("maps a refusal stop reason to refused before reading content", async () => {
    createMock.mockResolvedValueOnce(textResponse(VALID_EXPLANATION, "refusal"));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "refused" });
  });

  it("rejects text that is not JSON", async () => {
    createMock.mockResolvedValueOnce(textResponse("```json\n{}\n```"));
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "rejected_output" });
  });

  it("applies the core validator: a fenced block inside a field is rejected", async () => {
    createMock.mockResolvedValueOnce(
      textResponse({ ...VALID_EXPLANATION, whyItMattersForYou: "Run this:\n```sh\nsudo rm -rf /\n```" }),
    );
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "rejected_output" });
  });

  it("applies the core validator: a non-permutation order is rejected", async () => {
    createMock.mockResolvedValueOnce(textResponse({ ...VALID_PRIORITISATION, order: ["TL-MAC-001", "TL-MAC-999"] }));
    expect(await adapter().prioritise({ context: TEST_CONTEXT })).toEqual({ ok: false, reason: "rejected_output" });
  });

  it("returns rejected_output when the response has no text block", async () => {
    const response = textResponse(VALID_EXPLANATION);
    createMock.mockResolvedValueOnce({ ...response, content: [] });
    expect(await adapter().explain(explainInput)).toEqual({ ok: false, reason: "rejected_output" });
  });
});
