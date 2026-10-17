import { describe, expect, it } from "vitest";
import { INTENT_KINDS, INTENT_KINDS_WITHOUT_RULE, REMIND_WHENS } from "../../src/chat/intents";
import { CHAT_JSON_SCHEMA } from "../../src/explainer/schemas";

describe("INTENT_KINDS", () => {
  it("is the closed set of sixteen, DESIGN-CHAT's eleven then DESIGN-AGENT's five, with no unlock and no kind that takes a path", () => {
    expect(INTENT_KINDS).toEqual([
      "fix_rule",
      "fix_batch",
      "show_where",
      "explain_rule",
      "open_details",
      "show_list",
      "rescan",
      "change_ai",
      "snooze_rule",
      "accept_rule",
      "open_watch",
      "investigate",
      "close_watch",
      "remind_rule",
      "write_up",
      "what_if",
    ]);
    expect(INTENT_KINDS).toHaveLength(16);
    expect(INTENT_KINDS as readonly string[]).not.toContain("unlock");
    expect(INTENT_KINDS as readonly string[]).not.toContain("run_command");
  });

  it("the seven kinds without a rule are a subset and the schema's enum is the same list", () => {
    expect(INTENT_KINDS_WITHOUT_RULE).toEqual(["fix_batch", "show_list", "rescan", "change_ai", "open_watch", "close_watch", "write_up"]);
    expect(INTENT_KINDS_WITHOUT_RULE).toHaveLength(7);
    for (const kind of INTENT_KINDS_WITHOUT_RULE) expect(INTENT_KINDS).toContain(kind);
    expect(INTENT_KINDS_WITHOUT_RULE).not.toContain("investigate");
    const intent = (CHAT_JSON_SCHEMA["properties"] as { intents: { items: { properties: { kind: { enum: string[] } } } } }).intents.items.properties.kind;
    expect(intent.enum).toEqual([...INTENT_KINDS]);
  });

  it("a reminder names tomorrow or sunday and nothing else", () => {
    expect(REMIND_WHENS).toEqual(["tomorrow", "sunday"]);
  });
});
