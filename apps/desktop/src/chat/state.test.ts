import { describe, expect, it } from "vitest";
import type { ExplainerFailure } from "@talos/core";
import { AI_UNAVAILABLE_COPY } from "../app/labels";
import { CHAT, END, EXPLAIN, FISHY, SHOW } from "../guided/copy";
import { seedForStep } from "./cards";
import { reduce } from "./reduce";
import type { ChatAction, ChatMessage, ChatState } from "./state";
import { initialChatState } from "./state";
import { ACT_ITEM, AT, REPLY, openedAction, planFor, run, stepById, undoneOf } from "./testing";

const PLAN_L = planFor(true);
const PLAN_F = planFor(false);

const FAILURES: readonly ExplainerFailure[] = ["not_configured", "no_api_key", "network", "auth", "timeout", "rejected_output", "refused", "unknown", "unavailable", "too_long", "cancelled", "busy", "needs_sign_in", "limit_reached", "provider_unavailable"];

function cards(state: ChatState) {
  return state.messages.filter((m): m is Extract<ChatMessage, { kind: "card" }> => m.kind === "card");
}

function kinds(state: ChatState): string[] {
  return state.messages.map((m) => m.kind);
}

const sent: ChatAction = { type: "person_sent", at: AT, text: "Why does the disk matter?", turnId: "t1" };

describe("reduce: the opening", () => {
  it("draws the plan sentence, the urgent line and the critical step's card as live, with no call", () => {
    const state = run([openedAction(PLAN_L)]);
    const app = state.messages[0];
    expect(app?.kind).toBe("app");
    if (app?.kind !== "app") return;
    expect(app.headline).toMatch(/^I found \d+ things to fix\.$/);
    expect(app.urgent).toBe(true);
    const live = cards(state).find((c) => c.live);
    expect(live?.card.ruleId).toBe("TL-MAC-001");
    expect(state.live).toBe(live?.id);
    expect(state.announce.text).toBe(app.headline);
  });

  it("falls back to the batch card, then the first step, when nothing is critical", () => {
    const noCritical = undoneOf(PLAN_L).filter((s) => !(s.kind === "show" && s.ruleId === "TL-MAC-001"));
    const batch = run([openedAction(PLAN_L, { undone: noCritical })]);
    expect(cards(batch).find((c) => c.live)?.card.kind).toBe("batch");
    expect((batch.messages[0] as Extract<ChatMessage, { kind: "app" }>).urgent).toBe(false);
    const noBatch = noCritical.filter((s) => s.kind !== "batch");
    const first = run([openedAction(PLAN_L, { undone: noBatch })]);
    expect(cards(first).find((c) => c.live)?.step?.id).toBe(noBatch[0]?.id);
  });

  it("with nothing to fix says so and draws no card; with a diff the since rows come first", () => {
    const nothing = run([openedAction(PLAN_L, { undone: [], plan: { ...PLAN_L, steps: [] } })]);
    expect((nothing.messages[0] as Extract<ChatMessage, { kind: "app" }>).headline).toBe(END.nothing);
    expect(cards(nothing)).toHaveLength(0);
    const diff = { fixed: ["TL-MAC-002" as const], appeared: ["TL-MAC-029" as const], unreadable: [] };
    const since = run([openedAction(PLAN_L, { diff })]);
    const app = since.messages[0] as Extract<ChatMessage, { kind: "app" }>;
    expect(app.rows.map((r) => r.icon)).toEqual(["ok", "bullet"]);
    expect(app.since).toBe(diff);
  });

  it("carries the brief as a model block when given, and brief_ready inserts it under the opening later", () => {
    const withBrief = run([openedAction(PLAN_L, { brief: { text: "Your Mac goes out with you.", provider: "chatgpt" } })]);
    expect(kinds(withBrief).slice(0, 2)).toEqual(["app", "model"]);
    const later = run([openedAction(PLAN_L), { type: "brief_ready", at: AT, text: "Later.", provider: "chatgpt" }]);
    expect(kinds(later).slice(0, 3)).toEqual(["app", "model", "card"]);
    expect(later.messages[1]?.kind === "model" && later.messages[1].streaming).toBe(false);
  });

  it("opened again replaces the transcript; cleared empties it and keeps the composer", () => {
    const twice = run([openedAction(PLAN_L), sent, openedAction(PLAN_F)]);
    expect(kinds(twice)).toEqual(["app", "card"]);
    expect(twice.stream.kind).toBe("idle");
    const cleared = run([openedAction(PLAN_L), { type: "availability_changed", state: "limit_reached", until: null }, { type: "cleared" }]);
    expect(cleared.messages).toEqual([]);
    expect(cleared.composer.kind).toBe("limit");
  });
});

describe("reduce: model turns", () => {
  it("person_sent appends the turn and an empty streaming block, counts the call and announces Writing", () => {
    const state = run([openedAction(PLAN_L), sent]);
    expect(kinds(state).slice(-2)).toEqual(["person", "model"]);
    expect(state.stream).toEqual({ kind: "waiting", turnId: "t1", since: AT });
    expect(state.composer.kind).toBe("busy");
    expect(state.calls).toBe(1);
    expect(state.announce.text).toBe(CHAT.writing);
    const model = state.messages[state.messages.length - 1];
    expect(model?.kind === "model" && model.streaming && model.text === "").toBe(true);
  });

  it("a second send while a turn streams is ignored; a partial for another turn is ignored", () => {
    const state = run([openedAction(PLAN_L), sent, { ...sent, turnId: "t2" }, { type: "model_partial", at: AT + 1, turnId: "t2", text: "nope" }]);
    expect(kinds(state).filter((k) => k === "person")).toHaveLength(1);
    expect(state.messages.find((m) => m.kind === "model")?.kind === "model" && state.messages.find((m) => m.kind === "model" && m.text === "nope")).toBeFalsy();
  });

  it("partials grow the block, still-waiting flags it and the next partial clears it, ready lands the cards", () => {
    const partial = run([openedAction(PLAN_L), sent, { type: "model_still_waiting", turnId: "t1" }]);
    expect(partial.messages.at(-1)?.kind === "model" && partial.messages.at(-1)?.kind === "model" && (partial.messages.at(-1) as Extract<ChatMessage, { kind: "model" }>).stillWaiting).toBe(true);
    expect(partial.announce.text).toBe(CHAT.stillWaiting.chatgpt);
    const grown = reduce(partial, { type: "model_partial", at: AT + 100, turnId: "t1", text: "The disk" });
    const block = grown.messages.at(-1) as Extract<ChatMessage, { kind: "model" }>;
    expect(block.text).toBe("The disk");
    expect(block.stillWaiting).toBe(false);
    expect(grown.stream).toEqual({ kind: "streaming", turnId: "t1", since: AT, lastPartialAt: AT + 100 });
    const seed = seedForStep(stepById(PLAN_L, "show:TL-MAC-026"));
    const ready = reduce(grown, { type: "model_ready", at: AT + 200, turnId: "t1", result: { ...REPLY, outsideScope: true }, cards: [seed], related: [seed], lockedMeta: CHAT.moreLockedOne });
    expect(kinds(ready).slice(-4)).toEqual(["model", "card", "row", "notice"]);
    expect(ready.stream.kind).toBe("idle");
    expect(ready.composer.kind).toBe("ready");
    expect(cards(ready).filter((c) => c.live)).toHaveLength(1);
    expect(cards(ready).find((c) => c.live)?.card.ruleId).toBe("TL-MAC-026");
    expect((ready.messages.find((m) => m.kind === "model" && m.turnId === "t1") as Extract<ChatMessage, { kind: "model" }>).outsideScope).toBe(true);
    expect(ready.announce.text).toContain(CHAT.doneWriting);
  });

  it("stopped removes the block, keeps the turn with the meta and Send again, and frees the composer", () => {
    const state = run([openedAction(PLAN_L), sent, { type: "model_partial", at: AT, turnId: "t1", text: "The" }, { type: "stopped", at: AT, turnId: "t1" }]);
    expect(kinds(state).filter((k) => k === "model")).toHaveLength(0);
    const person = state.messages.find((m) => m.kind === "person") as Extract<ChatMessage, { kind: "person" }>;
    expect(person.stopped).toBe(true);
    expect(person.resend).toBe(true);
    expect(state.stream.kind).toBe("idle");
    expect(state.composer.kind).toBe("ready");
    expect(state.announce.text).toBe(CHAT.stopped);
    // Stopped for a turn that is not running is ignored.
    expect(reduce(state, { type: "stopped", at: AT, turnId: "t9" })).toBe(state);
  });

  it("model_failed covers every ExplainerFailure, leaves the stream idle and never marks the turn stopped", () => {
    for (const reason of FAILURES) {
      const state = run([openedAction(PLAN_L), sent, { type: "model_partial", at: AT, turnId: "t1", text: "The" }, { type: "model_failed", at: AT, turnId: "t1", reason, until: null }]);
      expect(state.stream.kind, reason).toBe("idle");
      expect(kinds(state).filter((k) => k === "model"), reason).toHaveLength(0);
      const person = state.messages.find((m) => m.kind === "person") as Extract<ChatMessage, { kind: "person" }>;
      const notice = state.messages.at(-1);
      if (reason === "cancelled") {
        expect(person.stopped).toBe(true);
        continue;
      }
      expect(person.stopped, reason).toBe(false);
      expect(notice?.kind, reason).toBe("notice");
      if (notice?.kind !== "notice") continue;
      expect(state.announce.text).toBe(notice.text);
      switch (reason) {
        case "limit_reached":
          expect(state.composer).toEqual({ kind: "limit", provider: "chatgpt", until: null });
          expect(notice.text).toBe(`${EXPLAIN.limit.chatgpt} ${EXPLAIN.limitBack}`);
          expect(notice.wayOut).toBeNull();
          break;
        case "needs_sign_in":
        case "auth":
        case "no_api_key":
        case "not_configured":
          expect(state.composer).toEqual({ kind: "signed_out", provider: "chatgpt" });
          expect(notice.wayOut?.kind).toBe("link");
          break;
        case "provider_unavailable":
        case "timeout":
        case "network":
        case "unavailable":
        case "busy":
          expect(state.composer.kind).toBe("ready");
          expect(notice.text).toBe(EXPLAIN.didNotAnswer.chatgpt);
          expect(notice.wayOut).toEqual({ kind: "chip", label: CHAT.tryAgain, action: "try_again" });
          expect(person.resend).toBe(true);
          break;
        case "too_long":
          expect(notice.text).toBe(CHAT.tooLong);
          break;
        default:
          expect(notice.text).toBe(CHAT.couldNotUse);
          expect(state.composer.kind).toBe("ready");
      }
    }
  });

  it("names Claude's reset time, and the on-device line on this Mac", () => {
    const until = "2026-10-16T15:00:00.000Z";
    const claude = run([openedAction(PLAN_L, { provider: "claude_plan" }), sent, { type: "model_failed", at: AT, turnId: "t1", reason: "limit_reached", until }], "claude_plan");
    expect((claude.messages.at(-1) as Extract<ChatMessage, { kind: "notice" }>).text).toMatch(new RegExp(`^${EXPLAIN.limit.claude_plan} ${EXPLAIN.limitBackAtPrefix}.+\\.$`));
    const apple = run([openedAction(PLAN_L, { provider: "apple" }), sent, { type: "model_failed", at: AT, turnId: "t1", reason: "timeout", until: null }], "apple");
    expect((apple.messages.at(-1) as Extract<ChatMessage, { kind: "notice" }>).text).toBe(AI_UNAVAILABLE_COPY.helper_unavailable);
  });

  it("availability back to available after a limit re-enables the field and marks every failed turn for resend", () => {
    const limited = run([openedAction(PLAN_L), sent, { type: "model_failed", at: AT, turnId: "t1", reason: "limit_reached", until: null }]);
    const back = reduce(limited, { type: "availability_changed", state: "available", until: null });
    expect(back.composer.kind).toBe("ready");
    expect((back.messages.find((m) => m.kind === "person") as Extract<ChatMessage, { kind: "person" }>).resend).toBe(true);
    expect(reduce(back, { type: "availability_changed", state: "available", until: null })).toBe(back);
    expect(reduce(back, { type: "availability_changed", state: "needs_sign_in", until: null }).composer.kind).toBe("signed_out");
    expect(reduce(back, { type: "availability_changed", state: "off", until: null }).composer.kind).toBe("ready");
  });
});

describe("reduce: cards, rows, the lock and the watch", () => {
  const opened = run([openedAction(PLAN_L)]);
  const liveId = opened.live as string;
  const batch = seedForStep(stepById(PLAN_L, "batch"));
  const share = seedForStep(stepById(PLAN_L, "fix:TL-MAC-022:/Users/alice/Public"));

  it("app_answered lands the first card live, demotes the old idle card to a row and keeps the rest as rows", () => {
    const state = reduce(opened, { type: "app_answered", at: AT, answer: { headline: null, body: null, label: "answer", cards: [batch, share] } });
    expect(kinds(state)).toEqual(["app", "row", "app", "card", "row"]);
    expect(cards(state).filter((c) => c.live)).toHaveLength(1);
    expect(state.live).not.toBe(liveId);
    expect(state.messages[1]?.kind === "row" && state.messages[1].headline).toBe("Your disk is not locked");
  });

  it("card_started sets working and clears live; a second card cannot start; live is null while working", () => {
    const state = reduce(opened, { type: "card_started", cardId: liveId });
    expect(state.working).toBe(liveId);
    expect(state.live).toBeNull();
    const second = reduce(reduce(state, { type: "card_appended", at: AT, seed: batch }), { type: "card_started", cardId: "m9" });
    expect(second.working).toBe(liveId);
    expect(reduce(state, { type: "card_started", cardId: "nope" })).toBe(state);
  });

  it("card_result resolves the working card, announces the line and promotes the next row to live", () => {
    const listed = reduce(opened, { type: "app_answered", at: AT, answer: { headline: null, body: null, label: "answer", cards: [batch, share] } });
    const working = reduce(listed, { type: "card_started", cardId: listed.live as string });
    const done = reduce(working, { type: "card_result", at: AT, cardId: working.working as string, outcome: "fixed", line: "Done. 3 things fixed.", rows: [] });
    expect(done.working).toBeNull();
    const resolved = cards(done).find((c) => c.result === "Done. 3 things fixed.");
    expect(resolved?.state).toBe("resolved");
    expect(resolved?.live).toBe(false);
    // The first row (the disk, demoted by app_answered) stepped up as a new live card at the end.
    expect(done.messages.at(-1)?.kind).toBe("card");
    expect(cards(done).find((c) => c.live)?.card.ruleId).toBe("TL-MAC-001");
    expect(kinds(done).filter((k) => k === "row")).toHaveLength(1);
    expect(done.announce.text).toBe("Done. 3 things fixed.");
    // A result for a card that is not working or idle is ignored.
    expect(reduce(done, { type: "card_result", at: AT, cardId: resolved?.id as string, outcome: "fixed", line: "x", rows: [] })).toBe(done);
  });

  it("a failed result keeps the card live with its primary; pane_opened keeps it working; walking defers promotion", () => {
    const working = reduce(opened, { type: "card_started", cardId: liveId });
    const failed = reduce(working, { type: "card_result", at: AT, cardId: liveId, outcome: "did_not_change", line: "That did not work.", rows: [], failure: { error: "command_failed", batch: false } });
    expect(cards(failed)[0]?.state).toBe("failed");
    expect(failed.live).toBe(liveId);
    const paneOpened = reduce(working, { type: "card_result", at: AT, cardId: liveId, outcome: "pane_opened", line: SHOW.opened, rows: [] });
    expect(cards(paneOpened)[0]?.state).toBe("working");
    expect(paneOpened.working).toBe(liveId);
    const listed = reduce(opened, { type: "app_answered", at: AT, answer: { headline: null, body: null, label: "answer", cards: [batch, share], walking: true } });
    expect(listed.walking).toBe(true);
    const walking = reduce(listed, { type: "card_started", cardId: listed.live as string });
    const settled = reduce(walking, { type: "card_result", at: AT, cardId: listed.live as string, outcome: "fixed", line: "Done.", rows: [] });
    expect(settled.live).toBeNull();
    expect(kinds(settled).filter((k) => k === "row")).toHaveLength(2);
    const promoted = reduce(settled, { type: "row_promoted", at: AT, rowId: "m5" });
    expect(promoted.live).not.toBeNull();
    expect(kinds(promoted).filter((k) => k === "row")).toHaveLength(1);
  });

  it("card_stale collapses an idle card and frees live; the lock card shows once and collapses to OK", () => {
    const stale = reduce(opened, { type: "card_stale", cardId: liveId, line: CHAT.staleDone });
    expect(cards(stale)[0]?.state).toBe("stale");
    expect(stale.live).toBeNull();
    const lock = reduce(stale, { type: "lock_shown", at: AT, ruleIds: ["TL-MAC-003", "TL-MAC-011"] });
    expect(lock.lockShown).toBe(true);
    expect(cards(lock).find((c) => c.live)?.card.kind).toBe("lock");
    expect(reduce(lock, { type: "lock_shown", at: AT, ruleIds: [] })).toBe(lock);
    const dismissed = reduce(lock, { type: "lock_dismissed" });
    expect(cards(dismissed).find((c) => c.card.kind === "lock")?.result).toBe(CHAT.ok);
    expect(dismissed.live).toBeNull();
  });

  it("watch_noticed appends the act-now card live, demotes the idle card, with and without a time", () => {
    const noticed = reduce(opened, { type: "watch_noticed", at: AT, item: ACT_ITEM, changedAt: ACT_ITEM.changedAt });
    expect(kinds(noticed)).toEqual(["app", "row", "card"]);
    const card = cards(noticed)[0];
    expect(card?.card.kind).toBe("watch");
    expect(card?.live).toBe(true);
    expect(card?.noticedAt).toBe(ACT_ITEM.changedAt);
    expect(noticed.announce.text).toBe(CHAT.actHeadline.replace("{headline}", "a new program started running on its own"));
    const noTime = reduce(opened, { type: "watch_noticed", at: AT, item: { ...ACT_ITEM, changedAt: null }, changedAt: null });
    expect(cards(noTime)[0]?.noticedAt).toBeNull();
    const returned = reduce(noticed, { type: "watch_returned", at: AT, ran: true });
    expect((returned.messages.at(-1) as Extract<ChatMessage, { kind: "app" }>).body).toBe(FISHY.recover.body);
    expect(reduce(noticed, { type: "watch_returned", at: AT, ran: false })).toBe(noticed);
  });

  it("the end message, the guard, drafts and the counter", () => {
    const end = reduce(opened, { type: "end_reached", at: AT, title: END.allDone, body: END.nextTime, groups: [{ label: END.waiting, rows: [] }], brief: null });
    expect((end.messages.at(-1) as Extract<ChatMessage, { kind: "app" }>).label).toBe("end");
    expect(end.announce.text).toBe(END.allDone);
    const guard = reduce(opened, { type: "guard_refused", at: AT, text: CHAT.guard });
    expect(guard.messages.at(-1)).toMatchObject({ kind: "notice", text: CHAT.guard, wayOut: null });
    const draft = reduce(opened, { type: "draft_received", text: "why", autoSend: false });
    expect(draft.draft).toBe("why");
    expect(reduce(draft, { type: "draft_consumed" }).draft).toBeNull();
    expect(reduce(opened, { type: "counter_near_limit", left: 60 }).announce.text).toBe("60 left");
    expect(reduce(opened, { type: "chip_pressed", at: AT, chipId: "show_list", text: CHAT.chips.showList }).messages.at(-1)).toMatchObject({ kind: "person", source: "chip" });
  });

  it("never throws on an event that does not apply to the empty state", () => {
    const empty = initialChatState("chatgpt");
    const actions: ChatAction[] = [
      { type: "model_partial", at: AT, turnId: "x", text: "" },
      { type: "model_ready", at: AT, turnId: "x", result: REPLY, cards: [], related: [], lockedMeta: null },
      { type: "model_failed", at: AT, turnId: "x", reason: "unknown", until: null },
      { type: "stopped", at: AT, turnId: "x" },
      { type: "card_started", cardId: "x" },
      { type: "card_result", at: AT, cardId: "x", outcome: "fixed", line: "", rows: [] },
      { type: "row_promoted", at: AT, rowId: "x" },
      { type: "card_stale", cardId: "x", line: "" },
      { type: "lock_dismissed" },
      { type: "brief_ready", at: AT, text: "", provider: "chatgpt" },
      { type: "walk_ended" },
      { type: "cleared" },
    ];
    for (const action of actions) expect(reduce(empty, action), action.type).toStrictEqual(empty);
  });
});
