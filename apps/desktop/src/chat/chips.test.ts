import { describe, expect, it } from "vitest";
import { ACTIVITY, CHAT } from "../guided/copy";
import { seedForStep } from "./cards";
import type { ChipFacts } from "./chips";
import { MAX_CHIP_CHARS, MAX_CHIPS, chipsFor } from "./chips";
import { reduce } from "./reduce";
import { ACT_ITEM, AT, REPLY, openedAction, planFor, run, stepById } from "./testing";

const PLAN = planFor(true);
const FACTS: ChipFacts = { fixable: true, anyUndone: true, urgentOrHigh: true, urgentLive: true, onDeviceCard: false, ruleCard: true };
const labels = (state: ReturnType<typeof run>, facts: ChipFacts = FACTS) => chipsFor(state, facts).map((c) => c.label);

describe("chipsFor", () => {
  const opened = run([openedAction(PLAN)]);

  it("the opening with the urgent card live drops What is urgent?; without it the chip returns; nothing critical asks what first", () => {
    expect(labels(opened)).toEqual([CHAT.chips.doThemAll, CHAT.chips.fixWhatYouCan, CHAT.chips.showList, ACTIVITY.chips.writeUp]);
    expect(labels(opened, { ...FACTS, urgentLive: false })).toEqual([CHAT.chips.doThemAll, CHAT.chips.fixWhatYouCan, CHAT.chips.whatIsUrgent, ACTIVITY.chips.writeUp]);
    expect(labels(opened, { ...FACTS, urgentOrHigh: false })).toEqual([CHAT.chips.doThemAll, CHAT.chips.fixWhatYouCan, CHAT.chips.whatFirst, ACTIVITY.chips.writeUp]);
    expect(labels(opened, { ...FACTS, fixable: false, urgentLive: false })).toEqual([CHAT.chips.doThemAll, CHAT.chips.whatIsUrgent, ACTIVITY.chips.writeUp, CHAT.chips.showList]);
    expect(labels(opened, { ...FACTS, fixable: false, anyUndone: false })).toEqual([CHAT.chips.showList, CHAT.chips.checkAgain]);
  });

  it("What is urgent? and What should I do first? never both appear, and never more than four chips of 25 characters", () => {
    for (const urgentOrHigh of [true, false]) {
      for (const urgentLive of [true, false]) {
        const chips = chipsFor(opened, { ...FACTS, urgentOrHigh, urgentLive });
        expect(chips.length).toBeLessThanOrEqual(MAX_CHIPS);
        expect(chips.some((c) => c.id === "what_is_urgent") && chips.some((c) => c.id === "what_first")).toBe(false);
        for (const chip of chips) expect(chip.label.length).toBeLessThanOrEqual(MAX_CHIP_CHARS);
      }
    }
  });

  it("after a result: What's next?, the list and Check again; What's next? goes when nothing is left", () => {
    const started = reduce(opened, { type: "card_started", cardId: opened.live as string });
    expect(labels(started)).toEqual([]);
    const done = reduce(started, { type: "card_result", at: AT, cardId: opened.live as string, outcome: "fixed", line: "Done.", rows: [] });
    expect(labels(done)).toEqual([CHAT.chips.whatsNext, CHAT.chips.showList, CHAT.chips.checkAgain]);
    expect(labels(done, { ...FACTS, anyUndone: false })).toEqual([CHAT.chips.showList, CHAT.chips.checkAgain]);
  });

  it("after an app answer offering a card: Why?, What's next?, the list; derived on this Mac leads with Leave it alone; a batch has no rule to ask about", () => {
    const offer = reduce(opened, { type: "app_answered", at: AT, answer: { headline: CHAT.firstLead, body: null, label: "answer", cards: [seedForStep(stepById(PLAN, "show:TL-MAC-026"))] } });
    expect(labels(offer)).toEqual([CHAT.chips.why, CHAT.chips.whatsNext, CHAT.chips.showList]);
    expect(labels(offer, { ...FACTS, onDeviceCard: true })).toEqual([CHAT.chips.leaveAlone, ACTIVITY.chips.whatIf, CHAT.chips.whatsNext, CHAT.chips.showList]);
    const batch = reduce(opened, { type: "app_answered", at: AT, answer: { headline: CHAT.firstLead, body: null, label: "answer", cards: [seedForStep(stepById(PLAN, "batch"))] } });
    expect(labels(batch, { ...FACTS, ruleCard: false })).toEqual([CHAT.chips.whatsNext, CHAT.chips.showList]);
  });

  it("a card promoted after a result keeps the result's chips; the lock card never offers Why? or Leave it alone", () => {
    const listed = reduce(opened, { type: "app_answered", at: AT, answer: { headline: null, body: null, label: "answer", cards: [seedForStep(stepById(PLAN, "batch")), seedForStep(stepById(PLAN, "fix:TL-MAC-022:/Users/alice/Public"))] } });
    const started = reduce(listed, { type: "card_started", cardId: listed.live as string });
    const done = reduce(started, { type: "card_result", at: AT, cardId: listed.live as string, outcome: "fixed", line: "Done.", rows: [] });
    expect(done.live).not.toBe(listed.live);
    expect(labels(done)).toEqual([CHAT.chips.whatsNext, CHAT.chips.showList, CHAT.chips.checkAgain]);
    const lock = reduce(opened, { type: "lock_shown", at: AT, ruleIds: ["TL-MAC-003", "TL-MAC-011"] });
    expect(labels(lock, { ...FACTS, ruleCard: false })).toEqual([CHAT.chips.whatsNext, CHAT.chips.showList, CHAT.chips.checkAgain]);
    expect(labels(lock, { ...FACTS, ruleCard: false, onDeviceCard: true })).not.toContain(CHAT.chips.leaveAlone);
  });

  it("while a turn streams there are no chips; with the composer under a limit the action chips stay and Why? goes", () => {
    const streaming = reduce(opened, { type: "person_sent", at: AT, text: "why", turnId: "t1" });
    expect(labels(streaming)).toEqual([]);
    const ready = reduce(streaming, { type: "model_ready", at: AT, turnId: "t1", result: REPLY, cards: [seedForStep(stepById(PLAN, "batch"))], related: [], lockedMeta: null });
    expect(labels(ready)[0]).toBe(CHAT.chips.why);
    const limited = reduce(ready, { type: "availability_changed", state: "limit_reached", until: null });
    expect(labels(limited)).toEqual([CHAT.chips.whatsNext, CHAT.chips.showList]);
  });

  it("after the end message and after the watch's act-now card", () => {
    const end = reduce(opened, { type: "end_reached", at: AT, title: "Your Mac is in good shape.", body: null, groups: [], brief: null });
    expect(labels(end, { ...FACTS, anyUndone: false })).toEqual([ACTIVITY.chips.writeUp, CHAT.chips.showList, CHAT.chips.checkAgain]);
    const noticed = reduce(opened, { type: "watch_noticed", at: AT, item: ACT_ITEM, changedAt: null });
    expect(labels(noticed, { ...FACTS, ruleCard: false })).toEqual([CHAT.chips.whatsNext, CHAT.chips.showList]);
  });
});

/* AGENT part B region: the rows of docs/DESIGN-AGENT.md 2j. */
describe("chipsFor: the agent rows", () => {
  const opened = run([openedAction(PLAN)]);
  const everyState = () => {
    const started = reduce(opened, { type: "card_started", cardId: opened.live as string });
    const fixed = reduce(started, { type: "card_result", at: AT, cardId: opened.live as string, outcome: "fixed", line: "Done.", rows: [] });
    const snoozed = reduce(opened, { type: "card_result", at: AT, cardId: opened.live as string, outcome: "snoozed", line: "OK.", rows: [] });
    const whatIf = reduce(opened, { type: "app_answered", at: AT, answer: { headline: "What if I leave it?", body: null, label: "what_if", cards: [seedForStep(stepById(PLAN, "show:TL-MAC-001"))] } });
    const end = reduce(opened, { type: "end_reached", at: AT, title: "Done.", body: null, groups: [], brief: null });
    const noticed = reduce(opened, { type: "watch_noticed", at: AT, item: ACT_ITEM, changedAt: null });
    return [opened, started, fixed, snoozed, whatIf, end, noticed];
  };

  it("after Do this later: Ask me again tomorrow, What if I leave it?, What's next?, the list, also when the next card was promoted", () => {
    const listed = reduce(opened, { type: "app_answered", at: AT, answer: { headline: null, body: null, label: "answer", cards: [seedForStep(stepById(PLAN, "show:TL-MAC-001")), seedForStep(stepById(PLAN, "show:TL-MAC-026"))] } });
    const snoozed = reduce(listed, { type: "card_result", at: AT, cardId: listed.live as string, outcome: "snoozed", line: "OK.", rows: [] });
    expect(snoozed.live).not.toBe(listed.live);
    expect(labels(snoozed)).toEqual([ACTIVITY.chips.remindTomorrow, ACTIVITY.chips.whatIf, CHAT.chips.whatsNext, CHAT.chips.showList]);
    const last = reduce(opened, { type: "card_result", at: AT, cardId: opened.live as string, outcome: "snoozed", line: "OK.", rows: [] });
    expect(labels(last, { ...FACTS, anyUndone: false })).toEqual([ACTIVITY.chips.remindTomorrow, ACTIVITY.chips.whatIf, CHAT.chips.showList]);
  });

  it("after a what-if answer: Leave it alone, What's next?, the list, and the what-if chip is not repeated", () => {
    const answered = reduce(opened, { type: "app_answered", at: AT, answer: { headline: "What if I leave it?", body: null, label: "what_if", cards: [seedForStep(stepById(PLAN, "show:TL-MAC-001"))] } });
    expect(labels(answered)).toEqual([CHAT.chips.leaveAlone, CHAT.chips.whatsNext, CHAT.chips.showList]);
  });

  it("never more than four chips, every label at or under 25 characters, in every state", () => {
    for (const state of everyState()) {
      for (const onDeviceCard of [true, false]) {
        const chips = chipsFor(state, { ...FACTS, onDeviceCard });
        expect(chips.length).toBeLessThanOrEqual(MAX_CHIPS);
        for (const chip of chips) expect(chip.label.length, chip.label).toBeLessThanOrEqual(MAX_CHIP_CHARS);
      }
    }
  });
});
