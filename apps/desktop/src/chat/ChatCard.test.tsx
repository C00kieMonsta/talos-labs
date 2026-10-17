// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import type { ActivityEvent } from "@talos/core";
import { DEV_MACHINE } from "@talos/core";
import { AppContext } from "../app/context";
import { fakeAdapters, fakeBatchPlan, fakeContextValue } from "../app/testing";
import { ACTIVITY, CHAT, EXPLAIN, FIX, PAYWALL, PERMISSION, QUESTION } from "../guided/copy";
import type { FixingState } from "../scan/machine";
import { ChatCard } from "./ChatCard";
import { chatActivityRow } from "./ChatActivity";
import type { ChatHandlers } from "./handlers";
import type { ChatMessage } from "./state";
import { ACT_ITEM, AT, REPORT, planFor, stepById } from "./testing";
import { lockCard, seedForStep, watchCard } from "./cards";

afterEach(cleanup);

type Card = Extract<ChatMessage, { kind: "card" }>;
const HANDLERS: ChatHandlers = { send: vi.fn(), chip: vi.fn(), primary: vi.fn(), link: vi.fn(), checkAgain: vi.fn(), promote: vi.fn(), stop: vi.fn(), licenceAccepted: vi.fn(), navigate: vi.fn(), draftConsumed: vi.fn() };
const PLAN = planFor(true);

function mount(message: Card, options: { fixing?: FixingState | null; licensed?: boolean; aiEnabled?: boolean; extra?: readonly ActivityEvent[] } = {}) {
  const licensed = options.licensed ?? true;
  const base = fakeContextValue({
    adapters: fakeAdapters(),
    license: { status: "none" },
    gate: { licensed, freeFixes: [], has: () => licensed, fixLocked: () => !licensed, explainLocked: () => false, watchLocked: !licensed },
    scanState: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: options.fixing ?? null, watching: null },
  });
  const value = { ...base, settings: { ...base.settings, explainer: { ...base.settings.explainer, aiEnabled: options.aiEnabled ?? true } } };
  return render(createElement(AppContext.Provider, { value }, createElement(ChatCard, { message, handlers: HANDLERS, extraRows: options.extra ?? [] })));
}

function card(seed = seedForStep(stepById(PLAN, "batch")), live = true): Card {
  return { id: "c1", kind: "card", at: AT, cardId: "c1", card: seed.card, step: seed.step, item: seed.item, noticedAt: null, state: "idle", live, result: null, rows: [], failure: null };
}

const batchFixing = (phase: FixingState["phase"]): FixingState => ({ kind: "batch", plan: fakeBatchPlan(), phase, step: 0, of: 0, item: null, error: null, outcome: null, byRule: {} });

describe("ChatCard", () => {
  it("draws one primary, one link and the Explain disclosure on an idle batch card, with the cue bar only for critical and high", () => {
    const { container } = mount(card());
    expect(container.querySelectorAll(".button-primary")).toHaveLength(1);
    expect(container.querySelectorAll(".guided-link")).toHaveLength(1);
    expect(container.querySelector(".guided-explain summary")?.textContent).toBe(EXPLAIN.open);
    expect(container.querySelector(".chat-card")?.getAttribute("data-kind")).toBe("batch");
    expect(container.querySelector(".chat-card-high, .chat-card-critical")).not.toBeNull();
    expect(container.querySelector("h2.chat-headline")?.getAttribute("tabindex")).toBe("-1");
    cleanup();
    const medium = mount(card(seedForStep(stepById(PLAN, "show:TL-MAC-026"))));
    expect(medium.container.querySelector(".chat-card-high, .chat-card-critical")).toBeNull();
    expect(medium.container.querySelector(".button-primary")?.textContent).toBe(QUESTION.yes);
    expect(medium.container.querySelector(".guided-link")?.textContent).toBe(QUESTION.no);
  });

  it("while working it has no primary and no link, and shows the rows with at most one running and no spinner beside 'your password'", () => {
    const working: Card = { ...card(), state: "working", live: false };
    const { container } = mount(working, { fixing: batchFixing("waiting_for_password") });
    expect(container.querySelectorAll(".button-primary")).toHaveLength(0);
    expect(container.querySelectorAll(".guided-link")).toHaveLength(0);
    const rows = [...container.querySelectorAll(".chat-activity-row")];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.getAttribute("data-state") === "running")).toHaveLength(1);
    const password = rows.find((r) => r.querySelector(".activity-word")?.textContent === ACTIVITY.words.password);
    expect(password).not.toBeUndefined();
    expect(password?.querySelector(".spin")).toBeNull();
    for (const r of rows) expect(r.querySelector(".activity-word")?.textContent?.length).toBeGreaterThan(0);
  });

  it("resolved: the result line and the done rows, nothing to press; failed: the failure copy with its one primary and later link", () => {
    const resolved: Card = { ...card(), state: "resolved", live: false, result: "Done. 2 things fixed.", rows: [{ ruleId: "TL-MAC-002", ok: true, text: "The firewall is on." }, { ruleId: "TL-MAC-003", ok: false, text: "Stealth", tag: "Did not change" }] };
    const { container } = mount(resolved);
    expect(container.querySelector(".chat-result")?.textContent).toContain("Done. 2 things fixed.");
    expect(container.querySelectorAll(".guided-row")).toHaveLength(2);
    expect(container.querySelectorAll(".button-primary, .guided-link")).toHaveLength(0);
    cleanup();
    const failed: Card = { ...card(seedForStep(stepById(PLAN, "fix:TL-MAC-022:/Users/alice/Public"))), state: "failed", live: true, result: "", failure: { error: "cancelled", batch: false } };
    const f = mount(failed);
    expect(f.container.querySelector(".chat-headline")?.textContent).toBe("You closed the password box.");
    expect(f.container.querySelector(".button-primary")?.textContent).toBe(FIX.tryAgain);
    expect(f.container.querySelector(".guided-link")?.textContent).toBe(FIX.later);
    cleanup();
    const stale: Card = { ...card(), state: "stale", live: false, result: CHAT.staleDone };
    const s = mount(stale);
    expect(s.container.querySelector(".chat-result")?.textContent).toBe(CHAT.staleDone);
    expect(s.container.querySelectorAll(".button-primary, .guided-link, .guided-explain")).toHaveLength(0);
  });

  it("the chooser cards: the 022 folder name, the 029 passphrase form in place of the primary; permission and lock cards", () => {
    const share = mount(card(seedForStep(stepById(PLAN, "fix:TL-MAC-022:/Users/alice/Public"))));
    expect(share.container.querySelector(".chat-card-folder")?.textContent).toBe("Public");
    cleanup();
    const key = mount(card({ card: { kind: "fix", ruleId: "TL-MAC-029", ruleIds: ["TL-MAC-029"], severity: "high" }, step: { id: "fix:TL-MAC-029:/k", kind: "fix", ruleId: "TL-MAC-029", choice: { kind: "ssh_key", path: "/k" }, passphrase: true }, item: null }));
    expect(key.container.querySelector(".passphrase-form")).not.toBeNull();
    expect(key.container.querySelectorAll(".button-primary")).toHaveLength(1);
    expect(key.container.querySelector(".button-primary")?.textContent).toBe(FIX.passphrase);
    cleanup();
    const permission = mount(card(seedForStep(stepById(PLAN, "permission:full_disk_access"))));
    expect(permission.container.querySelector(".button-primary")?.textContent).toBe(PERMISSION.button);
    expect(permission.container.querySelector(".guided-explain")).toBeNull();
    cleanup();
    const lock = mount(card(lockCard(["TL-MAC-003", "TL-MAC-011"])), { licensed: false });
    expect(lock.container.querySelector(".button-primary")?.textContent).toBe(PAYWALL.buy);
    expect(lock.container.querySelector(".licence-field")).not.toBeNull();
    expect(lock.container.querySelector(".guided-link")?.textContent).toBe(PAYWALL.notNow);
    expect(lock.container.querySelectorAll(".button-primary")).toHaveLength(1);
  });

  it("the watch card leads with the alert icon and the chat's own rows draw with their state word", () => {
    const seed = { ...watchCard(ACT_ITEM), noticedAt: ACT_ITEM.changedAt };
    const message: Card = { ...card(seed), noticedAt: ACT_ITEM.changedAt };
    const { container } = mount(message);
    expect(container.querySelector(".chat-card-urgent-icon")).not.toBeNull();
    expect(container.querySelector(".chat-headline")?.textContent).toContain("Act now:");
    cleanup();
    const watching: Card = { ...card(seedForStep(stepById(PLAN, "show:TL-MAC-001"))), state: "working", live: false, result: "I've opened the right page." };
    const w = mount(watching, { extra: [chatActivityRow("c1", "watching", "running", AT)] });
    const row = w.container.querySelector(".chat-activity-row");
    expect(row?.getAttribute("data-activity")).toBe("watching");
    expect(row?.querySelector(".activity-word")?.textContent).toBe(ACTIVITY.words.watching);
    expect(w.container.querySelector(".guided-link")?.textContent).toBe(FIX.checkAgain);
    expect(w.container.querySelectorAll(".button-primary")).toHaveLength(0);
  });
});
