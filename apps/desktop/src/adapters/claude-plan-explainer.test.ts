import { describe, expect, it, vi } from "vitest";
import { MACOS_CATALOG, buildChatInstructions, buildExplainerSystemPrompt, chatTurns, claudePromptFor, explainTurns } from "@talos/core";
import type { ChatResult, Explanation } from "@talos/core";
import type { StreamEvent } from "./apple-explainer";
import { ClaudePlanExplainerAdapter, LIMIT_TTL_MS, mapClaudePlanError } from "./claude-plan-explainer";
import { TEST_CHAT_CALL, TEST_CONTEXT, TEST_REPORT, VALID_ANSWER, VALID_CHAT, VALID_EXPLANATION, VALID_PRIORITISATION } from "./test-fixtures";

const NOW = "2026-10-16T12:00:00.000Z";

interface Generated {
  id: string;
  task: string;
  instructions: string;
  prompt: string;
}

/** A fake ai:stream bus: the test emits events for the id the adapter sent to claude_generate. */
function bus(script: (id: string, emit: (e: Omit<StreamEvent, "id">) => void) => void | Promise<void>, status: unknown = { state: "available", until: null }, clock: () => string = () => NOW) {
  let handler: ((e: StreamEvent) => void) | null = null;
  const requests: Generated[] = [];
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (cmd === "ai_provider_status") return status;
    if (cmd === "claude_generate") {
      const request = args?.["request"] as Generated;
      requests.push(request);
      const emit = (e: Omit<StreamEvent, "id">) => handler?.({ id: request.id, ...e });
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
  const adapter = new ClaudePlanExplainerAdapter({ reportSource: async () => TEST_REPORT, invoke, listen, now: clock });
  return { adapter, invoke, listen, requests, emit: (e: StreamEvent) => handler?.(e) };
}

const explainInput = { context: TEST_CONTEXT, ruleId: "TL-MAC-001" as const };
/** TEST_CONTEXT with 001 marked as left alone by the person. */
const ACCEPTED_CONTEXT = { ...TEST_CONTEXT, findings: TEST_CONTEXT.findings.map((f) => (f.ruleId === "TL-MAC-001" ? { ...f, accepted: true } : f)) };
const PRIORITISATION_WITHOUT_001 = { order: ["TL-MAC-002", "TL-MAC-023"], reasons: [{ ruleId: "TL-MAC-002", reason: "The firewall is quick." }], startWith: ["TL-MAC-002"] } as const;

describe("ClaudePlanExplainerAdapter", () => {
  it("sends the frozen instructions and the core envelope on claude_generate, never a flag or a program", async () => {
    const b = bus((_id, emit) => emit({ kind: "done", json: VALID_EXPLANATION }));
    expect(await b.adapter.explain(explainInput)).toEqual({ ok: true, value: VALID_EXPLANATION });
    expect(b.requests).toHaveLength(1);
    const request = b.requests[0] as Generated;
    expect(request.id).toMatch(/^[a-z0-9]{1,16}$/);
    expect(request.task).toBe("explain");
    expect(request.instructions).toBe(buildExplainerSystemPrompt(MACOS_CATALOG));
    expect(request.prompt).toBe(claudePromptFor(explainTurns(explainInput)));
    expect(Object.keys(request).sort()).toEqual(["id", "instructions", "prompt", "task"]);
    expect(request.prompt).not.toContain("--");
    expect(request.prompt).not.toContain("Why it matters:");
    expect(b.listen).toHaveBeenCalledWith("ai:stream", expect.any(Function));
    // Listening started before the command was sent.
    expect(b.listen.mock.invocationCallOrder[0]).toBeLessThan(b.invoke.mock.invocationCallOrder.find((_, i) => b.invoke.mock.calls[i]?.[0] === "claude_generate") ?? 0);
  });

  it("forwards partial snapshots and validates done per task", async () => {
    const b = bus((_id, emit) => {
      emit({ kind: "partial", json: { whyItMattersForYou: "Anyone" } });
      emit({ kind: "partial", json: { whyItMattersForYou: "Anyone who picks", whatCouldHappen: "A" } });
      emit({ kind: "done", json: VALID_EXPLANATION });
    });
    const partials: Partial<Explanation>[] = [];
    expect(await b.adapter.explain(explainInput, { onPartial: (p) => partials.push(p) })).toEqual({ ok: true, value: VALID_EXPLANATION });
    expect(partials).toEqual([{ whyItMattersForYou: "Anyone" }, { whyItMattersForYou: "Anyone who picks", whatCouldHappen: "A" }]);
    const p = bus((_id, emit) => emit({ kind: "done", json: VALID_PRIORITISATION }));
    expect(await p.adapter.prioritise({ context: TEST_CONTEXT })).toEqual({ ok: true, value: VALID_PRIORITISATION });
    expect(p.requests[0]?.task).toBe("prioritise");
    const short = bus((_id, emit) => emit({ kind: "done", json: { ...VALID_PRIORITISATION, order: ["TL-MAC-001"] } }));
    expect((await short.adapter.prioritise({ context: TEST_CONTEXT })).ok).toBe(false);
    const a = bus((_id, emit) => emit({ kind: "done", json: VALID_ANSWER }));
    expect(await a.adapter.ask({ context: TEST_CONTEXT, history: [], question: "What first?" })).toEqual({ ok: true, value: VALID_ANSWER });
    expect(a.requests[0]?.task).toBe("ask");
  });

  it("a command-like partial cancels and yields rejected_output; a wrong done is rejected", async () => {
    const b = bus((_id, emit) => {
      emit({ kind: "partial", json: { whyItMattersForYou: "sudo rm -rf / now" } });
      emit({ kind: "done", json: VALID_EXPLANATION });
    });
    expect(await b.adapter.explain(explainInput)).toEqual({ ok: false, reason: "rejected_output" });
    expect(b.invoke).toHaveBeenCalledWith("claude_cancel", { id: b.requests[0]?.id });
    const wrong = bus((_id, emit) => emit({ kind: "done", json: { ...VALID_EXPLANATION, ruleId: "TL-MAC-999" } }));
    expect((await wrong.adapter.explain(explainInput)).ok).toBe(false);
  });

  it("an abort sends claude_cancel and maps to cancelled; later events for the id are ignored", async () => {
    let release: () => void = () => undefined;
    const b = bus(() => new Promise<void>((r) => { release = r; }));
    const controller = new AbortController();
    const partials: unknown[] = [];
    const pending = b.adapter.explain(explainInput, { signal: controller.signal, onPartial: (p) => partials.push(p) });
    await vi.waitFor(() => expect(b.requests.length).toBe(1));
    b.emit({ id: "other", kind: "partial", json: { whyItMattersForYou: "x" } });
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
    expect(b.invoke).toHaveBeenCalledWith("claude_cancel", { id: b.requests[0]?.id });
    b.emit({ id: b.requests[0]?.id ?? "", kind: "done", json: VALID_EXPLANATION });
    expect(partials).toEqual([]);
    release();
    const already = bus(() => undefined);
    const aborted = new AbortController();
    aborted.abort();
    expect(await already.adapter.explain(explainInput, { signal: aborted.signal })).toEqual({ ok: false, reason: "cancelled" });
    expect(already.requests).toHaveLength(0);
  });

  it("maps every stream error code and caches the provider states with until", async () => {
    expect(mapClaudePlanError("needs_sign_in")).toBe("needs_sign_in");
    expect(mapClaudePlanError("limit_reached")).toBe("limit_reached");
    expect(mapClaudePlanError("provider_unavailable")).toBe("provider_unavailable");
    expect(mapClaudePlanError("plan_not_eligible")).toBe("provider_unavailable");
    expect(mapClaudePlanError("rejected_output")).toBe("rejected_output");
    expect(mapClaudePlanError("timeout")).toBe("timeout");
    expect(mapClaudePlanError("cancelled")).toBe("cancelled");
    expect(mapClaudePlanError("busy")).toBe("busy");
    expect(mapClaudePlanError("internal")).toBe("unknown");
    expect(mapClaudePlanError(undefined)).toBe("unknown");
    expect(mapClaudePlanError("whatever")).toBe("unknown");

    const limit = bus((_id, emit) => emit({ kind: "error", code: "limit_reached", until: "2026-10-16T18:00:00.000Z" }));
    expect(await limit.adapter.explain(explainInput)).toEqual({ ok: false, reason: "limit_reached" });
    expect(await limit.adapter.availabilityDetail()).toEqual({ state: "limit_reached", until: "2026-10-16T18:00:00.000Z" });
    expect(limit.invoke).not.toHaveBeenCalledWith("ai_provider_status", expect.anything());
    // A fresh probe (Disconnect, a new sign-in) drops the reset time too and takes Rust's answer.
    expect(await limit.adapter.availabilityDetail(true)).toEqual({ state: "available", until: null });
    expect(limit.invoke).toHaveBeenLastCalledWith("ai_provider_status", { provider: "claude_plan", fresh: true });

    // The allowance comes back on its own: past `until` a cached probe falls through to Rust, which keeps its own TTL.
    let t = Date.parse(NOW);
    const expiring = bus((_id, emit) => emit({ kind: "error", code: "limit_reached", until: "2026-10-16T18:00:00.000Z" }), { state: "available", until: null }, () => new Date(t).toISOString());
    expect(await expiring.adapter.explain(explainInput)).toEqual({ ok: false, reason: "limit_reached" });
    t = Date.parse("2026-10-16T17:59:59.000Z");
    expect(await expiring.adapter.availabilityDetail()).toEqual({ state: "limit_reached", until: "2026-10-16T18:00:00.000Z" });
    expect(expiring.invoke).not.toHaveBeenCalledWith("ai_provider_status", expect.anything());
    t = Date.parse("2026-10-16T18:00:01.000Z");
    expect(await expiring.adapter.availabilityDetail()).toEqual({ state: "available", until: null });
    expect(expiring.invoke).toHaveBeenLastCalledWith("ai_provider_status", { provider: "claude_plan", fresh: false });
    // With no time from the provider the cached limit lasts the TTL.
    t = Date.parse(NOW);
    const bare = bus((_id, emit) => emit({ kind: "error", code: "limit_reached" }), { state: "available", until: null }, () => new Date(t).toISOString());
    expect(await bare.adapter.explain(explainInput)).toEqual({ ok: false, reason: "limit_reached" });
    t += LIMIT_TTL_MS - 1;
    expect(await bare.adapter.availabilityDetail()).toEqual({ state: "limit_reached", until: null });
    t += 1;
    expect(await bare.adapter.availabilityDetail()).toEqual({ state: "available", until: null });

    const signedOut = bus((_id, emit) => emit({ kind: "error", code: "needs_sign_in" }));
    expect(await signedOut.adapter.explain(explainInput)).toEqual({ ok: false, reason: "needs_sign_in" });
    expect(await signedOut.adapter.availability()).toBe("needs_sign_in");
    expect(await signedOut.adapter.availability(true)).toBe("available");

    const plan = bus((_id, emit) => emit({ kind: "error", code: "plan_not_eligible" }));
    expect(await plan.adapter.explain(explainInput)).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(await plan.adapter.availability()).toBe("plan_not_eligible");
    expect(await plan.adapter.availability(true)).toBe("available");

    const down = bus((_id, emit) => emit({ kind: "error", code: "provider_unavailable" }));
    expect(await down.adapter.explain(explainInput)).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(await down.adapter.availability()).toBe("provider_unavailable");
    expect(await down.adapter.availability(true)).toBe("available");
  });

  it("maps a rejected claude_generate", async () => {
    for (const [code, reason] of [["busy", "busy"], ["not_connected", "not_configured"], ["not_offered", "not_configured"], ["prompt_too_long", "unknown"]] as const) {
      const b = bus(() => undefined);
      b.invoke.mockImplementation(async (cmd) => {
        if (cmd === "claude_generate") throw code;
        return undefined;
      });
      expect(await b.adapter.explain(explainInput), code).toEqual({ ok: false, reason });
    }
  });

  it("availability asks ai_provider_status for claude_plan and tolerates bad answers", async () => {
    const b = bus(() => undefined, { state: "not_connected", until: null });
    expect(await b.adapter.availability()).toBe("not_connected");
    expect(b.invoke).toHaveBeenCalledWith("ai_provider_status", { provider: "claude_plan", fresh: false });
    const bad = bus(() => undefined, "nonsense");
    expect(await bad.adapter.availability(true)).toBe("provider_unavailable");
    const dead = bus(() => undefined);
    dead.invoke.mockRejectedValue("boom");
    expect(await dead.adapter.availability()).toBe("provider_unavailable");
    expect(ClaudePlanExplainerAdapter.shared(async () => null)).toBe(ClaudePlanExplainerAdapter.shared(async () => null));
    expect(ClaudePlanExplainerAdapter.shared(async () => null).id).toBe("claude_plan");
  });
});

describe("ClaudePlanExplainerAdapter chat", () => {
  it("sends the chat instructions and the chat envelope as task chat, forwards whole partials and validates the intents", async () => {
    const b = bus((_id, emit) => {
      emit({ kind: "partial", json: { reply: "Your disk" } });
      emit({ kind: "done", json: VALID_CHAT });
    });
    const partials: Partial<ChatResult>[] = [];
    expect(await b.adapter.chat(TEST_CHAT_CALL, { onPartial: (p) => partials.push(p) })).toEqual({ ok: true, value: { ...VALID_CHAT, locked: [] } });
    const request = b.requests[0] as Generated;
    expect(request.task).toBe("chat");
    expect(request.instructions).toBe(buildChatInstructions(MACOS_CATALOG));
    expect(request.prompt).toBe(claudePromptFor(chatTurns(TEST_CHAT_CALL.input)));
    expect(request.prompt).not.toContain("Why it matters:");
    expect(partials).toEqual([{ reply: "Your disk" }]);
    const other = bus((_id, emit) => emit({ kind: "done", json: VALID_EXPLANATION }));
    await other.adapter.explain(explainInput);
    expect((other.requests[0] as Generated).instructions).toBe(buildExplainerSystemPrompt(MACOS_CATALOG));
  });

  it("an app-voice partial cancels the request as rejected_output and records the cancel", async () => {
    const b = bus((_id, emit) => {
      emit({ kind: "partial", json: { reply: "Done. I have turned" } });
      emit({ kind: "done", json: VALID_CHAT });
    });
    const partials: unknown[] = [];
    expect(await b.adapter.chat(TEST_CHAT_CALL, { onPartial: (p) => partials.push(p) })).toEqual({ ok: false, reason: "rejected_output" });
    expect(b.invoke).toHaveBeenCalledWith("claude_cancel", { id: (b.requests[0] as Generated).id });
    expect(partials).toEqual([]);
    const foreign = bus((_id, emit) => emit({ kind: "done", json: { ...VALID_CHAT, intents: [{ kind: "fix_rule", ruleId: "TL-MAC-999" }] } }));
    expect(await foreign.adapter.chat(TEST_CHAT_CALL)).toEqual({ ok: true, value: { ...VALID_CHAT, intents: [], locked: [] } });
  });
});

describe("ClaudePlanExplainerAdapter and the rules the person chose to leave", () => {
  it("rejects an order that names an accepted rule, accepts one without it, and never shows the accepted row", async () => {
    const named = bus((_id, emit) => emit({ kind: "done", json: VALID_PRIORITISATION }));
    expect(await named.adapter.prioritise({ context: ACCEPTED_CONTEXT })).toEqual({ ok: false, reason: "rejected_output" });
    expect(named.requests[0]?.instructions).toContain("A finding marked accepted");
    expect(named.requests[0]?.prompt).not.toContain("TL-MAC-001");
    const without = bus((_id, emit) => emit({ kind: "done", json: PRIORITISATION_WITHOUT_001 }));
    expect(await without.adapter.prioritise({ context: ACCEPTED_CONTEXT })).toEqual({ ok: true, value: PRIORITISATION_WITHOUT_001 });
  });
});
