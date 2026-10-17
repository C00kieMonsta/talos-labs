import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_MACHINE, MACOS_CATALOG, buildOnDeviceChatInstructions, buildOnDevicePrompt, evaluate, toExplainerContext } from "@talos/core";
import type { ChatResult, Explanation } from "@talos/core";
import { DEFAULT_SETTINGS } from "../settings";
import { AppleExplainerAdapter, mapAiError, snapshotHasCommandText } from "./apple-explainer";
import type { StreamEvent } from "./apple-explainer";
import { TEST_CHAT_CALL } from "./test-fixtures";

const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
const context = toExplainerContext(report, MACOS_CATALOG, DEFAULT_SETTINGS.profile);
const EXPLANATION: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Your disk holds your photos.", whatCouldHappen: "A thief reads it.", urgency: "today" };

/** A fake ai:stream bus: the test emits events for the id the adapter sent to ai_generate. */
function bus(script: (id: string, emit: (e: Omit<StreamEvent, "id">) => void) => void | Promise<void>) {
  let handler: ((e: StreamEvent) => void) | null = null;
  let generated: string[] = [];
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "ai_availability") return "available";
    if (cmd === "ai_generate") {
      const request = args?.["request"] as { id: string; task: string; instructions: string; prompt: string };
      generated.push(request.id);
      const emit = (e: Omit<StreamEvent, "id">) => handler?.({ id: request.id, ...e });
      // The engine resolves ai_generate once the stream has ended.
      await script(request.id, emit);
      return undefined;
    }
    return undefined;
  });
  const listen = vi.fn(async (_event: "ai:stream", h: (e: StreamEvent) => void) => {
    handler = h;
    return () => {
      handler = null;
    };
  });
  const adapter = new AppleExplainerAdapter({ reportSource: async () => report, invoke, listen });
  return { adapter, invoke, listen, get ids() { return generated; }, emit: (e: StreamEvent) => handler?.(e) };
}

afterEach(() => vi.useRealTimers());

describe("AppleExplainerAdapter chat", () => {
  /** The chat on the dev machine's report, so the allow-lists and the report agree. */
  const call = { ...TEST_CHAT_CALL, input: { ...TEST_CHAT_CALL.input, context, history: [{ role: "user" as const, text: "earlier" }, { role: "assistant" as const, text: "answer" }, { role: "user" as const, text: "x".repeat(500) }] } };

  it("sends the ask task with the chat instructions and the chat prompt, maps answer partials to reply, and derives no intents", async () => {
    const b = bus((_id, emit) => {
      emit({ kind: "partial", json: { answer: "Your disk" } });
      emit({ kind: "partial", json: { answer: "Your disk is not locked.", relatedRuleIds: ["TL-MAC-001"] } });
      emit({ kind: "done", json: { answer: "Your disk is not locked.", relatedRuleIds: ["TL-MAC-001", "TL-MAC-999"], outsideScope: false } });
    });
    const partials: Partial<ChatResult>[] = [];
    const result = await b.adapter.chat(call, { onPartial: (p) => partials.push(p) });
    expect(result).toEqual({ ok: true, value: { reply: "Your disk is not locked.", relatedRuleIds: ["TL-MAC-001"], outsideScope: false, intents: [], locked: [] } });
    expect(partials).toEqual([{ reply: "Your disk" }, { reply: "Your disk is not locked." }]);
    const request = (b.invoke.mock.calls.find((c) => c[0] === "ai_generate")?.[1] as { request: Record<string, unknown> }).request;
    expect(request["task"]).toBe("ask");
    expect(request["instructions"]).toBe(buildOnDeviceChatInstructions());
    const built = buildOnDevicePrompt("chat", context, MACOS_CATALOG, { question: call.input.question, history: call.input.history.slice(-2).map((t) => ({ ...t, text: t.text.slice(0, 400) })), undoneRuleIds: call.input.plan.stepRuleIds });
    expect(request["prompt"]).toBe(built.text);
    expect(String(request["prompt"]).length).toBeLessThan(5000);
    expect(String(request["prompt"])).toContain('"names":');
    expect(String(request["prompt"])).not.toContain("intents");
  });

  it("an app-voice partial cancels the request as rejected_output and records the cancel", async () => {
    const b = bus((_id, emit) => {
      emit({ kind: "partial", json: { answer: "I've turned on" } });
      emit({ kind: "done", json: { answer: "I've turned on your firewall.", relatedRuleIds: [], outsideScope: false } });
    });
    const partials: unknown[] = [];
    expect(await b.adapter.chat(call, { onPartial: (p) => partials.push(p) })).toEqual({ ok: false, reason: "rejected_output" });
    expect(b.invoke).toHaveBeenCalledWith("ai_cancel", { id: b.ids[0] });
    expect(partials).toEqual([]);
  });
});

describe("AppleExplainerAdapter", () => {
  it("maps the availability states and treats a rejection as helper_unavailable", async () => {
    const ok = bus(() => undefined);
    expect(await ok.adapter.availability()).toBe("available");
    expect(ok.invoke).toHaveBeenCalledWith("ai_availability", { fresh: false });
    const bad = new AppleExplainerAdapter({ reportSource: async () => report, invoke: async () => "nope", listen: async () => () => undefined });
    expect(await bad.availability(true)).toBe("helper_unavailable");
    const dead = new AppleExplainerAdapter({ reportSource: async () => report, invoke: async () => { throw "boom"; }, listen: async () => () => undefined });
    expect(await dead.availability()).toBe("helper_unavailable");
  });

  it("forwards partials in order as whole snapshots and validates done against the report", async () => {
    const b = bus((_id, emit) => {
      emit({ kind: "partial", json: { whyItMattersForYou: "Your disk" } });
      emit({ kind: "partial", json: { whyItMattersForYou: "Your disk holds your photos.", whatCouldHappen: "A thief" } });
      emit({ kind: "done", json: EXPLANATION });
    });
    const partials: Partial<Explanation>[] = [];
    const result = await b.adapter.explain({ context, ruleId: "TL-MAC-001" }, { onPartial: (p) => partials.push(p) });
    expect(result).toEqual({ ok: true, value: EXPLANATION });
    expect(partials).toEqual([{ whyItMattersForYou: "Your disk" }, { whyItMattersForYou: "Your disk holds your photos.", whatCouldHappen: "A thief" }]);
    const request = (b.invoke.mock.calls.find((c) => c[0] === "ai_generate")?.[1] as { request: Record<string, unknown> }).request;
    expect(request["task"]).toBe("explain");
    expect(typeof request["instructions"]).toBe("string");
    expect(String(request["prompt"])).toContain("TL-MAC-001");
    expect(String(request["id"])).toMatch(/^[a-z0-9]{1,16}$/);
  });

  it("a command-like partial cancels the request and yields rejected_output; a done that fails validation is rejected too", async () => {
    const b = bus((_id, emit) => {
      emit({ kind: "partial", json: { whyItMattersForYou: "sudo rm -rf / now" } });
      emit({ kind: "done", json: EXPLANATION });
    });
    const result = await b.adapter.explain({ context, ruleId: "TL-MAC-001" });
    expect(result).toEqual({ ok: false, reason: "rejected_output" });
    expect(b.invoke).toHaveBeenCalledWith("ai_cancel", { id: b.ids[0] });
    const wrong = bus((_id, emit) => emit({ kind: "done", json: { ...EXPLANATION, ruleId: "TL-MAC-999" } }));
    expect((await wrong.adapter.explain({ context, ruleId: "TL-MAC-001" })).ok).toBe(false);
  });

  it("ignores events after a cancel and for other ids, and an abort maps to cancelled", async () => {
    let release: () => void = () => undefined;
    const b = bus(() => new Promise<void>((r) => { release = r; }));
    const controller = new AbortController();
    const partials: unknown[] = [];
    const pending = b.adapter.explain({ context, ruleId: "TL-MAC-001" }, { signal: controller.signal, onPartial: (p) => partials.push(p) });
    await vi.waitFor(() => expect(b.ids.length).toBe(1));
    b.emit({ id: "other", kind: "partial", json: { whyItMattersForYou: "x" } });
    controller.abort();
    const result = await pending;
    expect(result).toEqual({ ok: false, reason: "cancelled" });
    expect(b.invoke).toHaveBeenCalledWith("ai_cancel", { id: b.ids[0] });
    b.emit({ id: b.ids[0] as string, kind: "partial", json: { whyItMattersForYou: "late" } });
    b.emit({ id: b.ids[0] as string, kind: "done", json: EXPLANATION });
    expect(partials).toEqual([]);
    release();
  });

  it("retries once without explanations on context_window, then reports too_long", async () => {
    let calls = 0;
    const prompts: string[] = [];
    const retried = bus((_id, emit) => {
      calls += 1;
      emit({ kind: "error", code: "context_window" });
    });
    retried.invoke.mockImplementation(async (cmd, args) => {
      if (cmd === "ai_availability") return "available";
      if (cmd === "ai_generate") {
        const request = args?.["request"] as { id: string; prompt: string };
        prompts.push(request.prompt);
        retried.ids.push(request.id);
        calls += 1;
        retried.emit({ id: request.id, kind: "error", code: "context_window" });
      }
      return undefined;
    });
    const result = await retried.adapter.prioritise({ context });
    expect(result).toEqual({ ok: false, reason: "too_long" });
    expect(calls).toBe(2);
    expect(prompts[1]?.length ?? 0).toBeLessThanOrEqual(prompts[0]?.length ?? 0);
    const second = bus((_id, emit) => {
      calls += 1;
      if (calls === 1) emit({ kind: "error", code: "context_window" });
      else emit({ kind: "done", json: { order: [], reasons: [], startWith: [] } });
    });
    calls = 0;
    const ok = await second.adapter.prioritise({ context: { ...context, findings: [] } });
    expect(ok.ok).toBe(true);
  });

  it("maps every helper error code and a busy rejection of ai_generate", async () => {
    expect(mapAiError("guardrail")).toBe("refused");
    expect(mapAiError("refusal")).toBe("refused");
    expect(mapAiError("unsupported_language")).toBe("refused");
    expect(mapAiError("assets_unavailable")).toBe("unavailable");
    expect(mapAiError("rate_limited")).toBe("unavailable");
    expect(mapAiError("busy")).toBe("busy");
    expect(mapAiError("decoding")).toBe("rejected_output");
    expect(mapAiError("internal")).toBe("unknown");
    expect(mapAiError("cancelled")).toBe("cancelled");
    expect(mapAiError("context_window")).toBe("too_long");
    expect(mapAiError(undefined)).toBe("unknown");
    expect(mapAiError("whatever")).toBe("unknown");
    const b = bus((_id, emit) => emit({ kind: "error", code: "guardrail" }));
    expect(await b.adapter.ask({ context, history: [], question: "Why?" })).toEqual({ ok: false, reason: "refused" });
    const busy = bus(() => undefined);
    busy.invoke.mockImplementation(async (cmd) => {
      if (cmd === "ai_availability") return "available";
      if (cmd === "ai_generate") throw "busy";
      return undefined;
    });
    expect(await busy.adapter.explain({ context, ruleId: "TL-MAC-001" })).toEqual({ ok: false, reason: "busy" });
  });

  it("snapshotHasCommandText looks into nested strings", () => {
    expect(snapshotHasCommandText({ a: ["fine", { b: "sudo rm -rf /" }] })).toBe(true);
    expect(snapshotHasCommandText({ a: ["fine", 3, true] })).toBe(false);
  });
});

describe("AppleExplainerAdapter and the rules the person chose to leave", () => {
  it("the on-device prioritise prompt keeps every eligible rule but the accepted one, so the validator never allows it", () => {
    const left = toExplainerContext(report, MACOS_CATALOG, DEFAULT_SETTINGS.profile, ["TL-MAC-001"]);
    const built = buildOnDevicePrompt("prioritise", left, MACOS_CATALOG, {});
    expect(built.kept).not.toContain("TL-MAC-001");
    expect(built.text).not.toContain("TL-MAC-001");
    const all = buildOnDevicePrompt("prioritise", context, MACOS_CATALOG, {});
    expect(all.kept).toContain("TL-MAC-001");
    // The budget cap may let one more rule in once 001 is gone; every other kept rule is still there.
    for (const id of all.kept.filter((x) => x !== "TL-MAC-001")) expect(built.kept).toContain(id);
  });
});
