import { describe, expect, it } from "vitest";
import { INTENT_KINDS } from "../../src/chat/intents";
import { cardKindFor, dividerBefore, DIVIDER_GAP_MS, exchangeLabel, historyFor, intentToCard, type HistoryMessage } from "../../src/chat/transcript";

const STRINGS = { you: "You asked", app: "Talos Labs" };

const APP_MESSAGE_KINDS = ["show_list", "investigate", "close_watch", "remind_rule", "what_if"];

describe("cardKindFor", () => {
  it("maps every kind, null for show_list and the four app-message kinds, write_up to its own card", () => {
    for (const kind of INTENT_KINDS) {
      expect(cardKindFor(kind) === null, kind).toBe(APP_MESSAGE_KINDS.includes(kind));
    }
    expect(cardKindFor("write_up")).toBe("write_up");
    expect(cardKindFor("fix_rule")).toBe("fix");
    expect(cardKindFor("fix_batch")).toBe("batch");
    expect(cardKindFor("show_where")).toBe("show");
    expect(cardKindFor("explain_rule")).toBe("explain");
    expect(cardKindFor("open_details")).toBe("details");
    expect(cardKindFor("snooze_rule")).toBe("snooze");
    expect(cardKindFor("accept_rule")).toBe("accept");
    expect(cardKindFor("open_watch")).toBe("watch");
  });
});

describe("historyFor", () => {
  it("keeps typed person texts and finished model texts in order and nothing else", () => {
    const messages: HistoryMessage[] = [
      { kind: "app", text: "I found 7 things to fix." },
      { kind: "person", text: "What is urgent?", source: "chip" },
      { kind: "card", text: "The firewall is off" },
      { kind: "person", text: "Why does the disk matter?", source: "typed" },
      { kind: "model", text: "Your disk is not locked, so a lost bag means lost files.", streaming: false },
      { kind: "row", text: "Details: Your disk is not locked" },
      { kind: "notice", text: "Still waiting for ChatGPT." },
      { kind: "person", text: "and the firewall?", source: "typed" },
      { kind: "model", text: "It keeps other", streaming: true },
      { kind: "person", text: "", source: "typed" },
      { kind: "person", text: "no source" },
    ];
    expect(historyFor(messages)).toEqual([
      { role: "user", text: "Why does the disk matter?" },
      { role: "assistant", text: "Your disk is not locked, so a lost bag means lost files." },
      { role: "user", text: "and the firewall?" },
    ]);
  });
});

describe("exchangeLabel", () => {
  it("clips at 60 characters, collapses newlines, and names the app for null", () => {
    expect(exchangeLabel(null, STRINGS)).toBe("Talos Labs");
    expect(exchangeLabel("Why does the disk matter?", STRINGS)).toBe("You asked Why does the disk matter?");
    const long = exchangeLabel("a".repeat(100), STRINGS);
    expect(long).toBe(`You asked ${"a".repeat(60)}`);
    const multi = exchangeLabel("first line\n\n  second line\r\nthird", STRINGS);
    expect(multi).toBe("You asked first line second line third");
    expect(multi).not.toMatch(/[\r\n]/);
  });
});

describe("dividerBefore", () => {
  it("is true past ten minutes and false at exactly ten", () => {
    expect(DIVIDER_GAP_MS).toBe(600_000);
    expect(dividerBefore(0, 600_001)).toBe(true);
    expect(dividerBefore(0, 600_000)).toBe(false);
    expect(dividerBefore(1_000, 500)).toBe(false);
  });
});

describe("intentToCard", () => {
  it("draws the card kind with [ruleId], the batch's own ids, or [] for the kinds without a rule", () => {
    expect(intentToCard({ kind: "fix_rule", ruleId: "TL-MAC-002" }, "high")).toEqual({ kind: "fix", ruleId: "TL-MAC-002", ruleIds: ["TL-MAC-002"], severity: "high" });
    expect(intentToCard({ kind: "fix_batch", ruleId: null }, null, ["TL-MAC-002", "TL-MAC-003"])).toEqual({ kind: "batch", ruleId: null, ruleIds: ["TL-MAC-002", "TL-MAC-003"], severity: null });
    expect(intentToCard({ kind: "rescan", ruleId: null }, null)).toEqual({ kind: "rescan", ruleId: null, ruleIds: [], severity: null });
    expect(intentToCard({ kind: "show_list", ruleId: null }, null)).toBeNull();
    expect(intentToCard({ kind: "write_up", ruleId: null }, null)).toEqual({ kind: "write_up", ruleId: null, ruleIds: [], severity: null });
    expect(intentToCard({ kind: "remind_rule", ruleId: "TL-MAC-002", when: "sunday" }, "high")).toBeNull();
  });
});
