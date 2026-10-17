import { afterEach, describe, expect, it, vi } from "vitest";
import type { SectionProgress } from "@talos/core";
import {
  ALL_UNAVAILABLE,
  DEV_MACHINE,
  MACOS_CATALOG,
  SECTION_KEYS,
  evaluate,
  explainerEligibleRuleIds,
  toExplainerContext,
  validateAnswer,
  validateExplanation,
  validatePrioritisation,
} from "@talos/core";
import { DEFAULT_SETTINGS } from "../settings";
import { createDemoAdapters, DEMO_EXPLAIN_DELAY_MS, DEMO_LICENSE_KEY, DEMO_LICENSE_KEY_PASTED, DEMO_LICENSE_PAYLOAD } from "./demo";

const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
const context = toExplainerContext(report, MACOS_CATALOG, DEFAULT_SETTINGS.profile);

function expectedProgress(statusFor: (key: (typeof SECTION_KEYS)[number]) => "ok" | "unavailable"): SectionProgress[] {
  return SECTION_KEYS.flatMap((key): SectionProgress[] => [
    { key, status: "started" },
    { key, status: statusFor(key) },
  ]);
}

afterEach(() => {
  vi.useRealTimers();
  delete window.__talosDemoCalls;
});

describe("createDemoAdapters: systemState", () => {
  it("emits started then ok for every section in SECTION_KEYS order and resolves the fixture", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", collectDelayMs: 0 });
    const seen: SectionProgress[] = [];
    const state = await adapters.systemState.collect({ onProgress: (p) => seen.push(p) });
    expect(state).toBe(DEV_MACHINE);
    expect(seen).toEqual(expectedProgress(() => "ok"));
  });

  it("reports unavailable sections as unavailable", async () => {
    const adapters = createDemoAdapters({ fixture: "all-unavailable", collectDelayMs: 0 });
    const seen: SectionProgress[] = [];
    const state = await adapters.systemState.collect({ onProgress: (p) => seen.push(p) });
    expect(state).toBe(ALL_UNAVAILABLE);
    expect(seen).toEqual(expectedProgress(() => "unavailable"));
  });

  it("rejects with cancelled when the signal aborts mid-scan and stops emitting", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", collectDelayMs: 5 });
    const controller = new AbortController();
    const seen: SectionProgress[] = [];
    const pending = adapters.systemState.collect({
      signal: controller.signal,
      onProgress: (p) => {
        seen.push(p);
        if (p.key === "firewall" && p.status === "started") controller.abort();
      },
    });
    await expect(pending).rejects.toThrow("cancelled");
    expect(seen.at(-1)).toEqual({ key: "firewall", status: "started" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen.length).toBe(3);
  });

  it("rejects at once when the signal is already aborted", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", collectDelayMs: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(adapters.systemState.collect({ signal: controller.signal })).rejects.toThrow("cancelled");
  });

  it("returns one fixture section from collectSection and no Full Disk Access", async () => {
    const adapters = createDemoAdapters({ fixture: "hardened", collectDelayMs: 0 });
    const section = await adapters.systemState.collectSection("firewall");
    expect(section.status).toBe("ok");
    expect(await adapters.systemState.capabilities()).toEqual({ fullDiskAccess: false, automation: null, bundled: true });
  });

  it("reports bundled=false only when asked", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", collectDelayMs: 0, bundled: false });
    expect(await adapters.systemState.capabilities()).toEqual({ fullDiskAccess: false, automation: null, bundled: false });
  });

  it("collectSection rejects with cancelled when the signal aborts during the delay", async () => {
    const adapters = createDemoAdapters({ fixture: "hardened", collectDelayMs: 50 });
    const controller = new AbortController();
    const pending = adapters.systemState.collectSection("firewall", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("collectSection rejects at once when the signal is already aborted", async () => {
    const adapters = createDemoAdapters({ fixture: "hardened", collectDelayMs: 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(adapters.systemState.collectSection("ssh", { signal: controller.signal })).rejects.toThrow("cancelled");
  });
});

describe("createDemoAdapters: licence, secrets, reports", () => {
  it("accepts only TL1.DEMO and remove clears it", async () => {
    const { license } = createDemoAdapters({ fixture: "dev-machine" });
    expect(await license.current()).toEqual({ status: "none" });
    expect(await license.install("TL1.nope.nope")).toEqual({ status: "invalid", reason: "signature" });
    expect(await license.current()).toEqual({ status: "none" });
    expect(await license.install(` ${DEMO_LICENSE_KEY}\n`)).toEqual({ status: "valid", payload: DEMO_LICENSE_PAYLOAD });
    expect(await license.current()).toEqual({ status: "valid", payload: DEMO_LICENSE_PAYLOAD });
    await license.remove();
    expect(await license.current()).toEqual({ status: "none" });
  });

  it("keeps secrets and the last report in memory", async () => {
    const { secrets, reports } = createDemoAdapters({ fixture: "dev-machine" });
    expect(await secrets.get("anthropic_api_key")).toBeNull();
    await secrets.set("anthropic_api_key", "sk-demo");
    expect(await secrets.get("anthropic_api_key")).toBe("sk-demo");
    await secrets.delete("anthropic_api_key");
    expect(await secrets.get("anthropic_api_key")).toBeNull();

    expect(await reports.loadLast()).toBeNull();
    await reports.saveLast(report);
    expect(await reports.loadLast()).toBe(report);
  });

  it("records pane, buy page and restart calls on window instead of opening anything", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine" });
    await adapters.openSettingsPane("firewall");
    await adapters.fixes.openBuyPage();
    await adapters.restart();
    expect(window.__talosDemoCalls).toEqual([{ kind: "openSettingsPane", arg: "firewall" }, { kind: "openBuyPage" }, { kind: "restart" }]);
    expect(JSON.stringify(window.__talosDemoCalls)).not.toMatch(/https?:/);
  });

  it("accepts the pasted demo key too", async () => {
    const { license } = createDemoAdapters({ fixture: "dev-machine" });
    expect((await license.install(DEMO_LICENSE_KEY_PASTED)).status).toBe("valid");
  });
});

describe("createDemoAdapters: explainer", () => {
  function settings(provider: typeof DEFAULT_SETTINGS.explainer.provider) {
    return { ...DEFAULT_SETTINGS.explainer, provider };
  }

  async function settled<T>(pending: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(DEMO_EXPLAIN_DELAY_MS);
    return pending;
  }

  it("returns NoExplainer when AI is switched off, and the Apple fake otherwise", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine" });
    expect((await adapters.createExplainer({ ...settings("apple"), aiEnabled: false })).id).toBe("none");
    expect((await adapters.createExplainer(settings("apple"))).id).toBe("apple");
  });

  it("answers after the delay with outputs that pass the core validators", async () => {
    vi.useFakeTimers();
    const adapters = createDemoAdapters({ fixture: "dev-machine" });
    const explainer = await adapters.createExplainer(settings("claude"));
    expect(explainer.id).toBe("claude");

    const explained = await settled(explainer.explain({ context, ruleId: "TL-MAC-001" }));
    expect(explained.ok).toBe(true);
    if (!explained.ok) return;
    expect(validateExplanation(explained.value, report).ok).toBe(true);
    expect(explained.value.urgency).toBe("today");
    expect(explained.value.whyItMattersForYou).toContain("Your disk is not encrypted");

    const prioritised = await settled(explainer.prioritise({ context }));
    expect(prioritised.ok).toBe(true);
    if (!prioritised.ok) return;
    expect(validatePrioritisation(prioritised.value, report, explainerEligibleRuleIds(report)).ok).toBe(true);
    expect([...prioritised.value.order].sort()).toEqual([...explainerEligibleRuleIds(report)].sort());
    expect(prioritised.value.order[0]).toBe("TL-MAC-001");
    expect(prioritised.value.startWith.length).toBeGreaterThan(0);

    const answered = await settled(explainer.ask({ context, history: [], question: "What first?" }));
    expect(answered.ok).toBe(true);
    if (!answered.ok) return;
    expect(validateAnswer(answered.value, report).ok).toBe(true);
    expect(answered.value.relatedRuleIds).toContain("TL-MAC-001");
  });

  it("returns the ChatGPT and Claude fakes for their providers, with availability from the demo connect", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine" });
    const chatgpt = await adapters.createExplainer(settings("chatgpt"));
    const claude = await adapters.createExplainer(settings("claude_plan"));
    expect(chatgpt.id).toBe("chatgpt");
    expect(claude.id).toBe("claude_plan");
    expect(await chatgpt.availability()).toBe("not_connected");
    expect(await claude.availability()).toBe("not_connected");
    // The same instance comes back, so a connect done in the demo is seen by the explainer in use.
    expect(await adapters.createExplainer(settings("chatgpt"))).toBe(chatgpt);
    await expect(chatgpt.explain({ context, ruleId: "TL-MAC-001" })).resolves.toEqual({ ok: false, reason: "not_configured" });
  });

  it("seeds the named provider's state from ai and ai_until and leaves the Apple fake alone", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", provider: "claude_plan", ai: "limit_reached", aiUntil: "2026-10-16T18:00:00.000Z" });
    const claude = await adapters.createExplainer(settings("claude_plan"));
    expect(await claude.availabilityDetail?.()).toEqual({ state: "limit_reached", until: "2026-10-16T18:00:00.000Z" });
    await expect(claude.explain({ context, ruleId: "TL-MAC-001" })).resolves.toEqual({ ok: false, reason: "limit_reached" });
    expect(await (await adapters.createExplainer(settings("chatgpt"))).availability()).toBe("not_connected");
    expect(await (await adapters.createExplainer(settings("apple"))).availability()).toBe("available");
    expect(await adapters.aiConnect.offered()).toEqual({ chatgpt: true, claude_plan: true, apple: true });
    const off = createDemoAdapters({ fixture: "dev-machine", provider: "chatgpt", ai: "not_offered" });
    expect(await off.aiConnect.offered()).toEqual({ chatgpt: false, claude_plan: true, apple: true });
    expect(await (await off.createExplainer(settings("chatgpt"))).availability()).toBe("not_offered");
  });

  it("a connected provider streams word by word and passes the validators; Disconnect flips the demo flag", async () => {
    vi.useFakeTimers();
    const adapters = createDemoAdapters({ fixture: "dev-machine", provider: "chatgpt", ai: "available" });
    const chatgpt = await adapters.createExplainer(settings("chatgpt"));
    expect(await chatgpt.availability()).toBe("available");
    const partials: unknown[] = [];
    const pending = chatgpt.explain({ context, ruleId: "TL-MAC-001" }, { onPartial: (p) => partials.push(p) });
    await vi.advanceTimersByTimeAsync(60_000);
    const explained = await pending;
    expect(explained.ok).toBe(true);
    if (!explained.ok) return;
    expect(validateExplanation(explained.value, report).ok).toBe(true);
    expect(partials.length).toBeGreaterThan(3);
    const prioritised = chatgpt.prioritise({ context });
    await vi.advanceTimersByTimeAsync(5000);
    const order = await prioritised;
    expect(order.ok && validatePrioritisation(order.value, report, explainerEligibleRuleIds(report)).ok).toBe(true);
    const asked = chatgpt.ask({ context, history: [], question: "What first?" });
    await vi.advanceTimersByTimeAsync(60_000);
    const answer = await asked;
    expect(answer.ok && validateAnswer(answer.value, report).ok).toBe(true);

    await adapters.aiConnect.disconnect("chatgpt");
    expect(window.__talosDemoCalls).toEqual([{ kind: "aiDisconnect", arg: "chatgpt" }]);
    expect(await chatgpt.availability()).toBe("not_connected");
    await expect(chatgpt.explain({ context, ruleId: "TL-MAC-001" })).resolves.toEqual({ ok: false, reason: "not_configured" });
    // Secrets are untouched by a demo disconnect.
    expect(await adapters.secrets.get("anthropic_api_key")).toBeNull();
  });

  it("a demo connect turns the provider available for the explainer in use", async () => {
    vi.useFakeTimers();
    const adapters = createDemoAdapters({ fixture: "dev-machine", connectDelayMs: 10 });
    const claude = await adapters.createExplainer(settings("claude_plan"));
    await adapters.aiConnect.start("claude_plan");
    expect(await claude.availability()).toBe("connecting");
    await vi.advanceTimersByTimeAsync(10);
    expect(await adapters.aiConnect.poll("claude_plan")).toEqual({ stage: "done" });
    expect(await claude.availability()).toBe("available");
    expect(window.__talosDemoCalls).toEqual([{ kind: "aiConnectStart", arg: "claude_plan" }]);
  });

  it("the provider fakes honour the configured failure", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", provider: "chatgpt", ai: "available", explainerFailure: "provider_unavailable" });
    const chatgpt = await adapters.createExplainer(settings("chatgpt"));
    await expect(chatgpt.explain({ context, ruleId: "TL-MAC-001" })).resolves.toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("identifies as ollama for that provider", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine" });
    expect((await adapters.createExplainer(settings("ollama"))).id).toBe("ollama");
  });

  it("fails every call with the configured reason", async () => {
    vi.useFakeTimers();
    const adapters = createDemoAdapters({ fixture: "dev-machine", explainerFailure: "network" });
    const explainer = await adapters.createExplainer(settings("claude"));
    await expect(settled(explainer.explain({ context, ruleId: "TL-MAC-001" }))).resolves.toEqual({ ok: false, reason: "network" });
    await expect(settled(explainer.prioritise({ context }))).resolves.toEqual({ ok: false, reason: "network" });
    await expect(settled(explainer.ask({ context, history: [], question: "Why?" }))).resolves.toEqual({ ok: false, reason: "network" });
  });

  it("gives a calm answer when nothing fails", async () => {
    vi.useFakeTimers();
    const clean = { ...context, findings: [] };
    const adapters = createDemoAdapters({ fixture: "hardened" });
    const explainer = await adapters.createExplainer(settings("claude"));
    const answered = await settled(explainer.ask({ context: clean, history: [], question: "What first?" }));
    expect(answered.ok && answered.value.relatedRuleIds).toEqual([]);
    const prioritised = await settled(explainer.prioritise({ context: clean }));
    expect(prioritised.ok && prioritised.value.order).toEqual([]);
  });
});
