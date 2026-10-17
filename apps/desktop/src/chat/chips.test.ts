import { describe, expect, it } from "vitest";
import { CHAT } from "../guided/copy";
import { seedForStep } from "./cards";
import type { ChipFacts } from "./chips";
import { MAX_CHIP_CHARS, MAX_CHIPS, chipsFor } from "./chips";
import { reduce } from "./reduce";
import { ACT_ITEM, AT, REPLY, openedAction, planFor, run, stepById } from "./testing";

const PLAN = planFor(true);
const FACTS: ChipFacts = { fixable: true, anyUndone: true, urgentOrHigh: true, urgentLive: true, onDeviceCard: false };
const labels = (state: ReturnType<typeof run>, facts: ChipFacts = FACTS) => chipsFor(state, facts).map((c) => c.label);

describe("chipsFor", () => {
  const opened = run([openedAction(PLAN)]);

  it("the opening with the urgent card live drops What is urgent?; without it the chip returns; nothing critical asks what first", () => {
    expect(labels(opened)).toEqual([CHAT.chips.doThemAll, CHAT.chips.fixWhatYouCan, CHAT.chips.showList]);
    expect(labels(opened, { ...FACTS, urgentLive: false })).toEqual([CHAT.chips.doThemAll, CHAT.chips.fixWhatYouCan, CHAT.chips.whatIsUrgent, CHAT.chips.showList]);
    expect(labels(opened, { ...FACTS, urgentOrHigh: false })).toEqual([CHAT.chips.doThemAll, CHAT.chips.fixWhatYouCan, CHAT.chips.whatFirst, CHAT.chips.showList]);
    expect(labels(opened, { ...FACTS, fixable: false, urgentLive: false })).toEqual([CHAT.chips.doThemAll, CHAT.chips.whatIsUrgent, CHAT.chips.showList]);
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

  it("after an app answer offering a card: Why?, What's next?, the list; derived on this Mac leads with Leave it alone", () => {
    const offer = reduce(opened, { type: "app_answered", at: AT, answer: { headline: CHAT.firstLead, body: null, label: "answer", cards: [seedForStep(stepById(PLAN, "batch"))] } });
    expect(labels(offer)).toEqual([CHAT.chips.why, CHAT.chips.whatsNext, CHAT.chips.showList]);
    expect(labels(offer, { ...FACTS, onDeviceCard: true })).toEqual([CHAT.chips.leaveAlone, CHAT.chips.whatsNext, CHAT.chips.showList]);
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
    expect(labels(end, { ...FACTS, anyUndone: false })).toEqual([CHAT.chips.showList, CHAT.chips.checkAgain]);
    const noticed = reduce(opened, { type: "watch_noticed", at: AT, item: ACT_ITEM, changedAt: null });
    expect(labels(noticed)).toEqual([CHAT.chips.why, CHAT.chips.whatsNext, CHAT.chips.showList]);
  });
});
