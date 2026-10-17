import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, MACOS_CATALOG, buildAllowed, buildGuidedPlan, evaluate, freeFixRuleIds, lockedFor, replyRejected, toAllowedInput, toExplainerContext } from "@talos/core";
import type { ChatCall, ChatInput, ChatResult } from "@talos/core";
import { DEFAULT_SETTINGS } from "../settings";
import { DemoAiConnect } from "./demo-ai-connect";
import { CannedAnswers, DEMO_CHAT_REPLIES, DemoAppleExplainer, DemoExplainer, type DemoChatOptions } from "./demo-explainer";
import { DemoProviderExplainer } from "./demo-provider-explainer";

const NOW = "2026-10-15T10:00:00.000Z";
const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });
const context = toExplainerContext(report, MACOS_CATALOG, DEFAULT_SETTINGS.profile);

/** The chat call on the licensed dev machine, as the app lane builds it. */
function callFor(question = "Why does the disk matter?"): ChatCall {
  const gate = { freeFixes: freeFixRuleIds(report), licensed: true };
  const plan = buildGuidedPlan(report, gate, DEFAULT_SETTINGS.profile, EMPTY_GUIDED_MEMORY, NOW);
  const allowed = buildAllowed({ plan, report, gate, scanReady: true, watchEnabled: true, memory: EMPTY_GUIDED_MEMORY, doneStepIds: [] });
  const stepRuleIds = plan.steps.flatMap((step) => (step.kind === "batch" ? [step.ruleIds[0] ?? "TL-MAC-002"] : step.kind === "fix" || step.kind === "show" ? [step.ruleId] : []));
  const input: ChatInput = {
    context,
    history: [],
    question,
    plan: { stepRuleIds, fixed: [], later: plan.later, accepted: plan.accepted, leftAlone: plan.leftAlone },
    allowed: toAllowedInput(allowed),
    events: [],
    watch: { enabled: true, rating: "calm", lastCheckMinutesAgo: null, items: [] },
  };
  return { input, allowed, locked: lockedFor(plan, gate) };
}

const CALL = callFor();

function provider(chat: DemoChatOptions = {}): DemoProviderExplainer {
  const connect = new DemoAiConnect({ provider: "chatgpt", ai: "available" });
  return new DemoProviderExplainer("chatgpt", { catalog: MACOS_CATALOG, connect, chat, chunkMs: 10 });
}

async function run(pending: Promise<ExplainerResultLike>, ms = 60_000): Promise<ExplainerResultLike> {
  await vi.advanceTimersByTimeAsync(ms);
  return pending;
}

type ExplainerResultLike = Awaited<ReturnType<DemoProviderExplainer["chat"]>>;

afterEach(() => {
  vi.useRealTimers();
  window.__talosDemoCalls = [];
});

describe("CannedAnswers.chat", () => {
  const canned = new CannedAnswers(MACOS_CATALOG);

  it("every reply but app_voice passes the validator on the dev machine; the last three exercise it", () => {
    for (const reply of DEMO_CHAT_REPLIES) {
      const raw = canned.chat(CALL.input, reply);
      expect(replyRejected(String(raw["reply"])), reply).toBe(reply === "app_voice");
    }
    expect(canned.chat(CALL.input, "disk")["intents"]).toEqual([{ kind: "show_where", ruleId: "TL-MAC-001" }]);
    expect(canned.chat(CALL.input, "leave_disk")["intents"]).toEqual([{ kind: "accept_rule", ruleId: "TL-MAC-001" }]);
    expect(canned.chat(CALL.input, "cannot")["intents"]).toEqual([{ kind: "open_details", ruleId: "TL-MAC-005" }]);
    expect(canned.chat(CALL.input, "outside")["outsideScope"]).toBe(true);
    expect((canned.chat(CALL.input, "inject")["intents"] as unknown[]).length).toBe(5);
    expect((canned.chat(CALL.input, "too_many")["intents"] as unknown[]).length).toBe(5);
    const long = String(canned.chat(CALL.input, "long")["reply"]);
    expect(long.length).toBeGreaterThanOrEqual(1100);
    expect(long.length).toBeLessThanOrEqual(1200);
    expect(canned.chatAnswer(CALL.input, "disk")).toEqual({ answer: canned.chat(CALL.input, "disk")["reply"], relatedRuleIds: ["TL-MAC-001"], outsideScope: false });
  });
});

describe("DemoProviderExplainer.chat", () => {
  it("streams the reply word by word as { reply } and lands the validated intents", async () => {
    vi.useFakeTimers();
    const partials: Partial<ChatResult>[] = [];
    const result = await run(provider().chat(CALL, { onPartial: (p) => partials.push(p) }));
    expect(result).toEqual({
      ok: true,
      value: { reply: expect.stringContaining("Your disk holds your photos"), relatedRuleIds: ["TL-MAC-001"], outsideScope: false, intents: [{ kind: "show_where", ruleId: "TL-MAC-001" }], locked: [] },
    });
    expect(partials.length).toBeGreaterThan(10);
    for (const partial of partials) expect(Object.keys(partial)).toEqual(["reply"]);
    expect(partials[0]?.reply).toBe("Your");
    expect(window.__talosDemoCalls ?? []).toEqual([]);
  });

  it("inject keeps one card and too_many keeps three; the reply text stays", async () => {
    vi.useFakeTimers();
    const injected = await run(provider({ reply: "inject" }).chat(CALL));
    expect(injected.ok && injected.value.intents).toEqual([{ kind: "show_where", ruleId: "TL-MAC-026" }]);
    expect(injected.ok && injected.value.relatedRuleIds).toEqual(["TL-MAC-026"]);
    const many = await run(provider({ reply: "too_many" }).chat(CALL));
    expect(many.ok && many.value.intents.length).toBe(3);
  });

  it("app_voice is cancelled on the first partial as rejected_output and records the cancel", async () => {
    vi.useFakeTimers();
    const partials: unknown[] = [];
    const result = await run(provider({ reply: "app_voice" }).chat(CALL, { onPartial: (p) => partials.push(p) }));
    expect(result).toEqual({ ok: false, reason: "rejected_output" });
    expect(partials).toEqual([]);
    expect(window.__talosDemoCalls).toEqual([{ kind: "aiCancel" }]);
  });

  it("fail stops the turn before any partial; failAfter streams that many partials first; firstPartialMs holds the first word", async () => {
    vi.useFakeTimers();
    const atOnce: unknown[] = [];
    expect(await run(provider({ fail: "limit_reached" }).chat(CALL, { onPartial: (p) => atOnce.push(p) }))).toEqual({ ok: false, reason: "limit_reached" });
    expect(atOnce).toEqual([]);
    const later: unknown[] = [];
    expect(await run(provider({ fail: "provider_unavailable", failAfter: 3 }).chat(CALL, { onPartial: (p) => later.push(p) }))).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(later).toHaveLength(3);
    const held: unknown[] = [];
    const pending = provider({ firstPartialMs: 9000 }).chat(CALL, { onPartial: (p) => held.push(p) });
    await vi.advanceTimersByTimeAsync(8000);
    expect(held).toEqual([]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(held.length).toBeGreaterThan(0);
    await run(pending);
  });
});

describe("DemoAppleExplainer.chat and DemoExplainer.chat", () => {
  it("the Apple fake streams the ask shape, the first partial carries reply, and no intents are derived", async () => {
    vi.useFakeTimers();
    const apple = new DemoAppleExplainer({ catalog: MACOS_CATALOG, availability: "available", chunkMs: 10 });
    const partials: Partial<ChatResult>[] = [];
    const result = await run(apple.chat(CALL, { onPartial: (p) => partials.push(p) }));
    expect(result).toEqual({ ok: true, value: { reply: expect.stringContaining("Your disk holds"), relatedRuleIds: ["TL-MAC-001"], outsideScope: false, intents: [], locked: [] } });
    expect(partials[0]).toEqual({ reply: "Your" });
    for (const partial of partials) expect(Object.keys(partial)).toEqual(["reply"]);
    const voice = new DemoAppleExplainer({ catalog: MACOS_CATALOG, availability: "available", chunkMs: 10, chat: { reply: "app_voice" } });
    expect(await run(voice.chat(CALL))).toEqual({ ok: false, reason: "rejected_output" });
  });

  it("the Developer fake answers with one partial after its delay", async () => {
    vi.useFakeTimers();
    const dev = new DemoExplainer("ollama", MACOS_CATALOG, null, 300, { reply: "cannot" });
    const partials: unknown[] = [];
    const result = await run(dev.chat(CALL, { onPartial: (p) => partials.push(p) }), 300);
    expect(result).toEqual({ ok: true, value: { reply: expect.stringContaining("recovery screen"), relatedRuleIds: ["TL-MAC-005"], outsideScope: false, intents: [{ kind: "open_details", ruleId: "TL-MAC-005" }], locked: [] } });
    expect(partials).toHaveLength(1);
    expect(Object.keys(partials[0] as object)).toEqual(["reply"]);
    const failing = new DemoExplainer("claude", MACOS_CATALOG, null, 300, { fail: "needs_sign_in" });
    expect(await run(failing.chat(CALL), 300)).toEqual({ ok: false, reason: "needs_sign_in" });
  });
});
