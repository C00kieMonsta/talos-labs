import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRequire } from "node:module";
import type { AiAvailability, GuidedPlan, ScanReport, WatchItem, WatchState } from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { AppContext } from "../app/context";
import type { AiConnectController } from "../scan/ai-connect";
import { CONNECT_POLL_MS } from "../scan/ai-connect";
import { StatefulProvider, fakeAdapters, fakeConnectController, fakeContextValue } from "../app/testing";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import type { WatchController } from "../watch/watch-controller";
import { INERT_WATCH, WatchControllerContext } from "../watch/watch-controller";
import { EndScreen, urgencyLine } from "./EndScreen";
import { END, FISHY, NEXT, WATCH, WATCH_ON } from "./copy";
import type { FishyController } from "./fishy/controller";
import { FishyContext, INERT_FISHY } from "./fishy/controller";
import { guidedFor } from "./plan";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

const REPORT: ScanReport = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-16T10:00:00.000Z", os: "macos" });

function plan(overrides: Partial<GuidedPlan> = {}): GuidedPlan {
  return { reportId: "r1", freeFixes: [], steps: [], leftAlone: [], worthALook: [], technical: [], later: [], locked: [], accepted: [], unreadable: 0, ...overrides };
}

/**
 * The watch is off unless a test says otherwise, so the v0.3 strings hold; `watch` adds a watch controller and the fishy controller.
 * `watchOn` flips the switch and, unless `licensed` says otherwise, the licence that makes the watch active.
 */
function renderEnd(p: GuidedPlan, fixed: readonly GuidedPlan["later"][number][], report: ScanReport | null = REPORT, options: { watchOn?: boolean; licensed?: boolean; watch?: WatchController; fishy?: FishyController } = {}) {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, watch: { ...DEFAULT_SETTINGS.watch, enabled: options.watchOn ?? false } };
  const licensed = options.licensed ?? options.watchOn ?? false;
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: !licensed }, scanState: { kind: "idle", last: report }, settings });
  const onNext = vi.fn();
  const fishy = options.fishy ?? { ...INERT_FISHY, open: vi.fn() };
  const tree = createElement(WatchControllerContext.Provider, { value: options.watch ?? INERT_WATCH }, createElement(FishyContext.Provider, { value: fishy }, createElement(EndScreen, { plan: p, fixed, onCheckAgain: vi.fn(), onNext })));
  render(createElement(AppContext.Provider, { value }, tree));
  return { navigate: value.router.navigate, onNext, fishy };
}

const ACT_ITEM: WatchItem = {
  signalId: "sig.persistence_new",
  kind: "persistence",
  severity: "high",
  points: 6,
  change: "appeared",
  changedAt: "2026-10-16T09:50:00.000Z",
  gated: false,
  snoozedUntil: null,
  hasStartupEntry: true,
  isListener: false,
  actionIds: [],
  modelSentence: null,
  modelProvider: null,
};

function watchWith(rating: WatchState["rating"], items: readonly WatchItem[], licensed = true): WatchController {
  const state: WatchState = { enabled: true, licensed, firstRun: false, hiddenLaunch: false, rating, since: null, lastCheckAt: null, checking: false, cycleIndex: 2, everyMinutes: 60, notify: true, pausedUntil: null, closeWatchUntil: null, unavailable: [], gated: [], items };
  return { ...INERT_WATCH, state };
}

/** The end screen with a connect controller and an AI state, so the "Get things explained" row can be asserted. */
function renderEndWithAi(p: GuidedPlan, options: { availability?: AiAvailability | null; aiEnabled?: boolean; provider?: AppSettings["explainer"]["provider"]; connect?: Partial<AiConnectController>; onConnect?: () => void } = {}) {
  const base = fakeContextValue({
    adapters: fakeAdapters(),
    license: { status: "none" },
    gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: true },
    scanState: { kind: "idle", last: REPORT },
    settings: { ...DEFAULT_SETTINGS, onboarded: true, watch: { ...DEFAULT_SETTINGS.watch, enabled: false }, explainer: { ...DEFAULT_SETTINGS.explainer, aiEnabled: options.aiEnabled ?? true, provider: options.provider ?? "chatgpt" } },
  });
  const value = { ...base, ai: { ...base.ai, availability: options.availability === undefined ? "not_connected" : options.availability, probe: vi.fn(async () => "not_connected" as const), reprobe: vi.fn(() => () => undefined) } };
  const connect = fakeConnectController({ offered: { chatgpt: true, claude_plan: true, apple: false }, connectable: true, askedRecently: false, ...options.connect });
  render(createElement(StatefulProvider, { value, connect }, createElement(EndScreen, { plan: p, fixed: ["TL-MAC-002"], onCheckAgain: vi.fn(), onNext: vi.fn(), onConnect: options.onConnect })));
  return { value, connect };
}

describe("EndScreen", () => {
  it("lists the partial result as labelled 44 px rows with an icon and a chevron, each a control that opens Details", () => {
    const { navigate } = renderEnd(plan({ later: ["TL-MAC-010", "TL-MAC-001"], locked: ["TL-MAC-003", "TL-MAC-022"], leftAlone: ["TL-MAC-014"], technical: ["TL-MAC-029"], unreadable: 1 }), ["TL-MAC-002"]);
    expect(screen.getByRole("heading", { level: 1, name: END.partial })).toBeTruthy();
    expect(screen.getByText("1 thing fixed today.")).toBeTruthy();
    for (const label of [END.next, END.waiting, END.locked, END.leftAlone, END.technical, END.unreadable]) expect(screen.getByRole("heading", { level: 2, name: label })).toBeTruthy();
    expect(document.querySelector(".guided-status-mark .guided-status-disc circle")?.getAttribute("fill")).toBe("url(#talos-mark-gradient)");
    // 001 is the next card, so five rows remain: 010, two locked, one left alone, one technical, the unreadable line.
    const rows = document.querySelectorAll(".guided-end-row");
    expect(rows.length).toBe(6);
    for (const row of rows) expect(row.querySelectorAll("svg").length).toBe(2);
    expect(document.querySelector(".guided-text-button")).toBeNull();
    expect(document.body.textContent).not.toContain("·");
    fireEvent.click(screen.getByRole("button", { name: `${guidedFor("TL-MAC-010").headline} ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-010" });
    fireEvent.click(screen.getByRole("button", { name: `${guidedFor("TL-MAC-022").headline} ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-022" });
    fireEvent.click(screen.getByRole("button", { name: `I couldn't check 1 area. ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "findings" });
    expect(screen.getByRole("button", { name: END.checkAgain }).className).toBe("guided-link");
  });

  it("puts the biggest risk in the next card with the critical cue, its why line and the one primary button", async () => {
    const { onNext, navigate } = renderEnd(plan({ later: ["TL-MAC-010", "TL-MAC-001"], locked: ["TL-MAC-003"] }), ["TL-MAC-002"]);
    const result = await axe.run(document.body, { runOnly: ["nested-interactive", "button-name", "heading-order", "list", "listitem", "aria-valid-attr-value"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    const card = document.querySelector(".guided-next-card");
    expect(card?.className).toBe("guided-next-card guided-next-critical");
    expect(card?.querySelector(".guided-next-headline")?.textContent).toBe(guidedFor("TL-MAC-001").headline);
    expect(card?.querySelector(".guided-next-why")?.textContent).toBe(guidedFor("TL-MAC-001").why);
    expect(screen.getByText(`${guidedFor("TL-MAC-001").headline}. ${END.biggestRisk}`)).toBeTruthy();
    expect(document.querySelectorAll(".button-primary").length).toBe(1);
    expect(screen.queryByRole("button", { name: `${guidedFor("TL-MAC-001").headline} ${END.details}` })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: NEXT.show }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext.mock.calls[0]?.[0]).toMatchObject({ ruleId: "TL-MAC-001", kind: "show", severity: "critical" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reads a high rule's headline as the sentence, offers Unlock for a locked rule, and the calm line with no card for a low rule left alone", () => {
    renderEnd(plan({ locked: ["TL-MAC-022"] }), ["TL-MAC-002"]);
    expect(screen.getByText(`${guidedFor("TL-MAC-022").headline}.`)).toBeTruthy();
    expect(screen.getByRole("button", { name: NEXT.unlock }).className).toContain("button-primary");
    expect(document.querySelector(".guided-next-card")?.className).toBe("guided-next-card guided-next-high");
    cleanup();
    renderEnd(plan({ later: ["TL-MAC-002"] }), []);
    expect(screen.getByRole("button", { name: NEXT.fix })).toBeTruthy();
    cleanup();
    renderEnd(plan({ leftAlone: ["TL-MAC-014"] }), ["TL-MAC-002"]);
    expect(screen.getByText(END.nextTime)).toBeTruthy();
    expect(document.querySelector(".guided-next-card")).toBeNull();
    expect(document.querySelectorAll(".guided-end-row").length).toBe(1);
  });

  it("shows the mark and the next-time line when all done or nothing to fix, with no card and no rows", () => {
    renderEnd(plan(), ["TL-MAC-002"]);
    expect(screen.getByRole("heading", { level: 1, name: END.allDone })).toBeTruthy();
    expect(screen.getByText(END.nextTime)).toBeTruthy();
    expect(document.querySelector(".guided-status-mark")).not.toBeNull();
    expect(document.querySelector(".guided-summary")).toBeNull();
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
    cleanup();
    renderEnd(plan(), [], null);
    expect(screen.getByRole("heading", { level: 1, name: END.nothing })).toBeTruthy();
    expect(document.querySelector(".guided-status-mark")).toBeNull();
    expect(document.querySelector(".guided-summary")).toBeNull();
  });

  it("says it could not check when nothing was read, with no card, and keeps the unreadable row as the route to Details", () => {
    renderEnd(plan({ unreadable: 31 }), []);
    expect(screen.getByRole("heading", { level: 1, name: END.unreadableAll })).toBeTruthy();
    expect(screen.getByText(END.tryAgain)).toBeTruthy();
    expect(screen.queryByText(END.nothing)).toBeNull();
    expect(document.querySelector(".guided-status-mark")).toBeNull();
    expect(document.querySelector(".guided-next-card")).toBeNull();
    expect(screen.getByRole("button", { name: `I couldn't check 31 areas. ${END.details}` })).toBeTruthy();
    cleanup();
    renderEnd(plan({ unreadable: 2 }), []);
    expect(screen.getByRole("heading", { level: 1, name: END.unreadableSome })).toBeTruthy();
    expect(screen.getByRole("button", { name: `I couldn't check 2 areas. ${END.details}` })).toBeTruthy();
  });

  it("adds the Get things explained row under the groups when no AI is connected, as one control with the subtitle in its name", async () => {
    const { connect, value } = renderEndWithAi(plan({ later: ["TL-MAC-010"], locked: ["TL-MAC-022"] }));
    expect(connect.ensureOffered).toHaveBeenCalledTimes(1);
    expect(value.ai.probe).not.toHaveBeenCalled();
    const row = screen.getByRole("button", { name: `${END.explained}. ${END.explainedSub}` });
    expect(row.className).toBe("guided-end-row guided-end-row-connect");
    expect(row.getAttribute("aria-label")).not.toContain(END.details);
    // The visible words sit inside the name in order, with a space between the two lines, so axe accepts the label.
    expect(row.textContent).toBe(`${END.explained} ${END.explainedSub}`);
    const result = await axe.run(row, { runOnly: ["label-content-name-mismatch", "button-name"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    expect(row.querySelectorAll("svg").length).toBe(2);
    expect(row.querySelector(".guided-end-row-text")?.firstChild?.textContent).toBe(END.explained);
    expect(row.querySelector(".guided-end-row-sub")?.textContent).toBe(END.explainedSub);
    expect(row.closest("ul")?.className).toBe("guided-end-list");
    expect(row.closest(".guided-summary")).not.toBeNull();
    // The row comes after every group and never inside the next card.
    const summary = document.querySelector(".guided-summary") as HTMLElement;
    expect(summary.lastElementChild?.contains(row)).toBe(true);
    expect(document.querySelector(".guided-next-card")?.contains(row)).toBe(false);
    expect(document.body.textContent).not.toContain("·");
    expect(document.body.textContent).not.toContain("›");
    // One row for 022 (010 is the next card), plus the connect row.
    expect(document.querySelectorAll(".guided-end-row").length).toBe(2);
    expect(document.querySelectorAll(".button-primary").length).toBe(1);
    fireEvent.click(row);
    expect(connect.open).toHaveBeenCalledWith({ name: "guided" });
    expect(screen.getByRole("button", { name: END.checkAgain }).className).toBe("guided-link");
  });

  it("renders the summary for the row alone, prefers the onConnect prop, and probes once when the state is unknown", () => {
    const onConnect = vi.fn();
    const { connect } = renderEndWithAi(plan(), { onConnect });
    expect(screen.getByRole("heading", { level: 1, name: END.allDone })).toBeTruthy();
    expect(document.querySelector(".guided-summary")).not.toBeNull();
    expect(document.querySelectorAll(".guided-end-row").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: `${END.explained}. ${END.explainedSub}` }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(connect.open).not.toHaveBeenCalled();
    cleanup();
    const { value } = renderEndWithAi(plan(), { availability: null });
    expect(value.ai.probe).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".guided-end-row-connect")).toBeNull();
    expect(value.ai.reprobe).not.toHaveBeenCalled();
  });

  it("re-probes a connecting state until it settles, like the other AI surfaces", () => {
    const { value } = renderEndWithAi(plan(), { availability: "connecting" });
    expect(value.ai.reprobe).toHaveBeenCalledWith(CONNECT_POLL_MS);
    expect(value.ai.probe).not.toHaveBeenCalled();
    cleanup();
    const off = renderEndWithAi(plan(), { availability: "connecting", aiEnabled: false });
    expect(off.value.ai.reprobe).not.toHaveBeenCalled();
    cleanup();
    const settled = renderEndWithAi(plan(), { availability: "not_connected" });
    expect(settled.value.ai.reprobe).not.toHaveBeenCalled();
  });

  it("swaps the next-time and try-again sentences for the watch's own while the watch is on, in the helper and on screen", () => {
    expect(urgencyLine(null)).toBe(END.nextTime);
    expect(urgencyLine(null, false)).toBe(END.nextTime);
    expect(urgencyLine(null, true)).toBe(WATCH_ON.nextTime);
    renderEnd(plan(), ["TL-MAC-002"], REPORT, { watchOn: true });
    expect(screen.getByText(WATCH_ON.nextTime)).toBeTruthy();
    expect(screen.queryByText(END.nextTime)).toBeNull();
    cleanup();
    renderEnd(plan(), ["TL-MAC-002"], REPORT, { watchOn: false });
    expect(screen.getByText(END.nextTime)).toBeTruthy();
    cleanup();
    renderEnd(plan({ unreadable: 31 }), [], REPORT, { watchOn: true });
    expect(screen.getByText(WATCH_ON.tryAgain)).toBeTruthy();
    expect(screen.queryByText(END.tryAgain)).toBeNull();
    cleanup();
    renderEnd(plan({ unreadable: 31 }), [], REPORT, { watchOn: false });
    expect(screen.getByText(END.tryAgain)).toBeTruthy();
    cleanup();
    // A high rule's headline is not swapped: only the calm line belongs to the watch.
    renderEnd(plan({ locked: ["TL-MAC-022"] }), ["TL-MAC-002"], REPORT, { watchOn: true });
    expect(screen.getByText(`${guidedFor("TL-MAC-022").headline}.`)).toBeTruthy();
  });

  it("puts the watch's act-now item in the critical card with the evidence sentence and See what to do as the one primary, opening the fishy flow", () => {
    const { fishy, onNext } = renderEnd(plan({ later: ["TL-MAC-010", "TL-MAC-001"], locked: ["TL-MAC-022"] }), ["TL-MAC-002"], REPORT, { watchOn: true, watch: watchWith("act_now", [ACT_ITEM]) });
    // Nothing above the card reads calm: the title is the watch's status word, the sentence the item's headline.
    expect(screen.getByRole("heading", { level: 1, name: WATCH.act })).toBeTruthy();
    expect(screen.getByText(`${FISHY.noticed.headline.persistence}.`)).toBeTruthy();
    expect(screen.queryByText(WATCH_ON.nextTime)).toBeNull();
    expect(screen.queryByText(END.partial)).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: END.next })).toBeTruthy();
    const card = document.querySelector(".guided-next-card") as HTMLElement;
    expect(card.className).toContain("guided-next-card guided-next-critical");
    expect(card.querySelector(".guided-next-headline")?.textContent).toBe(FISHY.noticed.headline.persistence);
    expect(card.querySelector(".guided-next-why")?.textContent).toBe(FISHY.evidence);
    expect(document.querySelectorAll(".button-primary").length).toBe(1);
    expect(document.querySelectorAll(".guided-next-card").length).toBe(1);
    expect(screen.queryByRole("button", { name: NEXT.show })).toBeNull();
    // The plan's next rule keeps its row, since its own card is not drawn.
    expect(screen.getByRole("button", { name: `${guidedFor("TL-MAC-001").headline} ${END.details}` })).toBeTruthy();
    expect(document.querySelectorAll(".guided-end-row").length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: FISHY.noticed.primary }));
    expect(fishy.open).toHaveBeenCalledWith({ name: "guided" }, "noticed");
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: END.checkAgain }).className).toBe("guided-link");
  });

  it("unlicensed, the switch alone changes nothing: the calm line stays the plan's and an act-now state draws no card", () => {
    renderEnd(plan(), ["TL-MAC-002"], REPORT, { watchOn: true, licensed: false, watch: watchWith("act_now", [ACT_ITEM], false) });
    expect(screen.getByText(END.nextTime)).toBeTruthy();
    expect(screen.queryByText(WATCH_ON.nextTime)).toBeNull();
    expect(document.querySelector(".guided-next-card")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: WATCH.act })).toBeNull();
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
    cleanup();
    // A state that still carries items but reports licensed false is treated as empty too.
    renderEnd(plan(), ["TL-MAC-002"], REPORT, { watchOn: true, licensed: true, watch: watchWith("act_now", [ACT_ITEM], false) });
    expect(document.querySelector(".guided-next-card")).toBeNull();
    expect(screen.getByText(WATCH_ON.nextTime)).toBeTruthy();
  });

  it("draws the act-now card alone when nothing else is open, and never for keep-an-eye or an act-now state with no item", () => {
    renderEnd(plan(), ["TL-MAC-002"], REPORT, { watchOn: true, watch: watchWith("act_now", [ACT_ITEM]) });
    expect(document.querySelector(".guided-summary")).not.toBeNull();
    expect(document.querySelector(".guided-next-card.guided-next-critical")).not.toBeNull();
    expect(document.querySelectorAll(".button-primary").length).toBe(1);
    expect(screen.getByRole("heading", { level: 1, name: WATCH.act })).toBeTruthy();
    expect(screen.queryByText(END.allDone)).toBeNull();
    expect(screen.queryByText(WATCH_ON.nextTime)).toBeNull();
    expect(screen.getByText(`${FISHY.noticed.headline.persistence}.`)).toBeTruthy();
    cleanup();
    // With nothing fixed either, the calm "Nothing needs fixing." never sits above the card.
    renderEnd(plan(), [], REPORT, { watchOn: true, watch: watchWith("act_now", [{ ...ACT_ITEM, kind: "listener", signalId: "sig.listener_new_ports" }]) });
    expect(screen.queryByText(END.nothing)).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: WATCH.act })).toBeTruthy();
    expect(screen.getByText(`${FISHY.noticed.headline.listener}.`)).toBeTruthy();
    cleanup();
    renderEnd(plan({ later: ["TL-MAC-010", "TL-MAC-001"] }), ["TL-MAC-002"], REPORT, { watchOn: true, watch: watchWith("keep_an_eye", [ACT_ITEM]) });
    expect(document.querySelector(".guided-next-headline")?.textContent).toBe(guidedFor("TL-MAC-001").headline);
    expect(screen.queryByText(FISHY.evidence)).toBeNull();
    cleanup();
    renderEnd(plan(), ["TL-MAC-002"], REPORT, { watchOn: true, watch: watchWith("act_now", []) });
    expect(document.querySelector(".guided-next-card")).toBeNull();
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
  });

  it("draws the row for the states where nothing is connected, including On this Mac on a Mac that cannot run it", () => {
    for (const [availability, provider] of [
      ["plan_not_eligible", "chatgpt"],
      ["not_offered", "claude_plan"],
      ["device_not_eligible", "apple"],
    ] as const) {
      renderEndWithAi(plan(), { availability, provider });
      expect(document.querySelector(".guided-end-row-connect"), `${availability} on ${provider}`).not.toBeNull();
      cleanup();
    }
    // The same Mac with no row to connect: no pitch.
    renderEndWithAi(plan(), { availability: "device_not_eligible", provider: "apple", connect: { connectable: false, offered: { chatgpt: false, claude_plan: false, apple: false } } });
    expect(document.querySelector(".guided-end-row-connect")).toBeNull();
  });

  it("skips the row for 14 days after Not now, when nothing can be connected, when AI is off, and in every other state", () => {
    renderEndWithAi(plan({ later: ["TL-MAC-010"] }), { connect: { askedRecently: true } });
    expect(document.querySelector(".guided-end-row-connect")).toBeNull();
    expect(document.querySelectorAll(".guided-end-row").length).toBe(0);
    cleanup();
    renderEndWithAi(plan(), { connect: { connectable: false, offered: { chatgpt: false, claude_plan: false, apple: false } } });
    expect(document.querySelector(".guided-end-row-connect")).toBeNull();
    expect(document.querySelector(".guided-summary")).toBeNull();
    cleanup();
    const { connect, value } = renderEndWithAi(plan(), { aiEnabled: false });
    expect(document.querySelector(".guided-end-row-connect")).toBeNull();
    expect(connect.ensureOffered).not.toHaveBeenCalled();
    expect(value.ai.probe).not.toHaveBeenCalled();
    for (const availability of ["available", "connecting", "needs_sign_in", "limit_reached", "provider_unavailable", "device_not_eligible", "apple_intelligence_not_enabled", "model_not_ready", "helper_unavailable", "off"] as const) {
      cleanup();
      renderEndWithAi(plan(), { availability });
      expect(document.querySelector(".guided-end-row-connect"), availability).toBeNull();
    }
    for (const availability of ["apple_intelligence_not_enabled", "model_not_ready", "helper_unavailable", "available"] as const) {
      cleanup();
      renderEndWithAi(plan(), { availability, provider: "apple" });
      expect(document.querySelector(".guided-end-row-connect"), availability).toBeNull();
    }
  });
});

describe("EndScreen and the rules the person chose to leave", () => {
  it("lists them under Things you chose to leave, after the locked group and before the left-alone one, each row opening Details", () => {
    const { navigate } = renderEnd(plan({ later: ["TL-MAC-010"], locked: ["TL-MAC-022"], accepted: ["TL-MAC-001", "TL-MAC-003"], leftAlone: ["TL-MAC-014"] }), ["TL-MAC-002"]);
    expect(screen.getByRole("heading", { level: 1, name: END.partial })).toBeTruthy();
    const labels = Array.from(document.querySelectorAll(".guided-end-group:not(.guided-next) .guided-end-label")).map((n) => n.textContent);
    expect(labels).toEqual([END.locked, END.chosen, END.leftAlone]);
    const group = document.querySelector("section[aria-labelledby='guided-end-accepted']") as HTMLElement;
    expect(group.querySelectorAll(".guided-end-row").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: `${guidedFor("TL-MAC-001").headline} ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-001" });
    expect(document.body.textContent).not.toMatch(/accept/i);
  });

  it("never makes the accepted rule the next card, even at the most points", () => {
    renderEnd(plan({ later: ["TL-MAC-010"], accepted: ["TL-MAC-001"] }), []);
    expect(document.querySelector(".guided-next-headline")?.textContent).toBe(guidedFor("TL-MAC-010").headline);
    expect(screen.getByRole("button", { name: `${guidedFor("TL-MAC-001").headline} ${END.details}` })).toBeTruthy();
  });

  it("reads Nothing left for me to do. with an accepted low and nothing fixed, and the calm next-time line", () => {
    renderEnd(plan({ accepted: ["TL-MAC-014"] }), []);
    expect(screen.getByRole("heading", { level: 1, name: END.nothingLeft })).toBeTruthy();
    expect(screen.queryByText(END.nothing)).toBeNull();
    expect(screen.getByText(END.nextTime)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: END.chosen })).toBeTruthy();
    expect(document.querySelector(".guided-next-card")).toBeNull();
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
  });

  it("reads Your Mac is safer than it was. with an accepted high and one fixed, never in good shape", () => {
    renderEnd(plan({ accepted: ["TL-MAC-022"] }), ["TL-MAC-002"]);
    expect(screen.getByRole("heading", { level: 1, name: END.partial })).toBeTruthy();
    expect(screen.queryByText(END.allDone)).toBeNull();
    expect(document.body.textContent).not.toContain("in good shape");
    expect(document.body.textContent).not.toContain("Nothing needs fixing");
    expect(screen.getByRole("heading", { level: 2, name: END.chosen })).toBeTruthy();
  });

  it("keeps Nothing to fix in what I could check. with an accepted critical, nothing fixed and one unreadable area, the group under it", () => {
    renderEnd(plan({ accepted: ["TL-MAC-001"], unreadable: 1 }), []);
    expect(screen.getByRole("heading", { level: 1, name: END.unreadableSome })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: END.chosen })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${guidedFor("TL-MAC-001").headline} ${END.details}` })).toBeTruthy();
    expect(screen.queryByText(END.nothing)).toBeNull();
    expect(screen.queryByText(END.allDone)).toBeNull();
  });
});
