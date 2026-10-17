import { describe, expect, it } from "vitest";
import type { RuleId } from "@talos/core";
import { grammarMatch } from "./grammar";
import type { GrammarContext } from "./grammar";
import { machineText } from "./guard";

/** The dev machine's undone and failing ids: the firewall, the disk, the screen lock, plus App Store updates as a later id. */
const CONTEXT: GrammarContext = { undone: ["TL-MAC-002", "TL-MAC-001", "TL-MAC-010", "TL-MAC-011"], failing: ["TL-MAC-001", "TL-MAC-002", "TL-MAC-010", "TL-MAC-011", "TL-MAC-026"], newestRuleId: "TL-MAC-002" };

const ids = (ids: readonly string[]) => ids as readonly RuleId[];

describe("grammarMatch", () => {
  it("the reminder's two forms resolve through the headline words and synonyms, or the newest card with no phrase", () => {
    expect(grammarMatch("ask me tomorrow", CONTEXT)).toEqual({ kind: "remind", ruleId: "TL-MAC-002", when: "tomorrow" });
    expect(grammarMatch("Remind me on Sunday about the firewall", CONTEXT)).toEqual({ kind: "remind", ruleId: "TL-MAC-002", when: "sunday" });
    expect(grammarMatch("tomorrow, ask me about the disk", CONTEXT)).toEqual({ kind: "remind", ruleId: "TL-MAC-001", when: "tomorrow" });
    expect(grammarMatch("bring this up on Sunday", CONTEXT)).toEqual({ kind: "remind", ruleId: "TL-MAC-002", when: "sunday" });
    expect(grammarMatch("ask me again tomorrow.", CONTEXT)).toEqual({ kind: "remind", ruleId: "TL-MAC-002", when: "tomorrow" });
    expect(grammarMatch("ask me tomorrow", { ...CONTEXT, newestRuleId: null })).toBeNull();
    expect(grammarMatch("remind me about the firewall tomorrow", { ...CONTEXT, undone: ids(["TL-MAC-001"]) })).toBeNull();
    // The newest card's rule is only a target while a reminder may still name it.
    expect(grammarMatch("ask me tomorrow", { ...CONTEXT, newestRuleId: "TL-MAC-026" })).toBeNull();
    expect(grammarMatch("remind me tomorrow about it", CONTEXT)).toEqual({ kind: "remind", ruleId: "TL-MAC-002", when: "tomorrow" });
    expect(grammarMatch("ask me tomorrow about this", CONTEXT)).toEqual({ kind: "remind", ruleId: "TL-MAC-002", when: "tomorrow" });
  });

  it("the what-if question resolves against the failing rules; the write-up forms carry no id", () => {
    expect(grammarMatch("what if I leave the disk alone?", CONTEXT)).toEqual({ kind: "what_if", ruleId: "TL-MAC-001" });
    expect(grammarMatch("What happens if I skip the backup", CONTEXT)).toEqual({ kind: "what_if", ruleId: "TL-MAC-026" });
    expect(grammarMatch("what if I don't turn on the firewall?", CONTEXT)).toEqual({ kind: "what_if", ruleId: "TL-MAC-002" });
    expect(grammarMatch("what if I leave it", CONTEXT)).toEqual({ kind: "what_if", ruleId: "TL-MAC-002" });
    expect(grammarMatch("what if I leave it", { ...CONTEXT, newestRuleId: null })).toBeNull();
    expect(grammarMatch("what if I leave it", { ...CONTEXT, newestRuleId: "TL-MAC-008" })).toBeNull();
    expect(grammarMatch("write this up for my son", CONTEXT)).toEqual({ kind: "write_up" });
    expect(grammarMatch("Write it up", CONTEXT)).toEqual({ kind: "write_up" });
    expect(grammarMatch("give me a summary I can send", CONTEXT)).toEqual({ kind: "write_up" });
  });

  it("look into this and the closer watch route to the gated kinds; a phrase names a failing rule", () => {
    expect(grammarMatch("look into this", CONTEXT)).toEqual({ kind: "investigate", ruleId: "TL-MAC-002" });
    expect(grammarMatch("look closer", { ...CONTEXT, newestRuleId: null })).toEqual({ kind: "investigate", ruleId: null });
    expect(grammarMatch("dig into this", CONTEXT)).toEqual({ kind: "investigate", ruleId: "TL-MAC-002" });
    expect(grammarMatch("check that again", CONTEXT)).toEqual({ kind: "investigate", ruleId: "TL-MAC-002" });
    expect(grammarMatch("look into the disk", CONTEXT)).toEqual({ kind: "investigate", ruleId: "TL-MAC-001" });
    expect(grammarMatch("watch closer for an hour", CONTEXT)).toEqual({ kind: "close_watch" });
    expect(grammarMatch("Check more often", CONTEXT)).toEqual({ kind: "close_watch" });
  });

  it("near-misses fall through to the model, and a path is caught by the guard first", () => {
    expect(grammarMatch("remind me on Friday", CONTEXT)).toBeNull();
    expect(grammarMatch("what if it rains", CONTEXT)).toBeNull();
    expect(grammarMatch("what if I leave the kettle alone?", CONTEXT)).toBeNull();
    expect(grammarMatch("look into the kettle", CONTEXT)).toBeNull();
    expect(grammarMatch("look at the firewall", CONTEXT)).toBeNull();
    expect(grammarMatch("look at this", CONTEXT)).toBeNull();
    expect(grammarMatch("why does the disk matter?", CONTEXT)).toBeNull();
    expect(machineText("remind me about /Users/alice tomorrow")).toBe(true);
    expect(machineText("what if I leave ~/Public alone?")).toBe(true);
  });
});
