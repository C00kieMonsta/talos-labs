import { describe, expect, it } from "vitest";
import { INTENT_KINDS, INTENT_KINDS_WITHOUT_RULE } from "../../src/chat/intents";
import { CHAT_JSON_SCHEMA } from "../../src/explainer/schemas";

describe("INTENT_KINDS", () => {
  it("is the closed set of eleven, in DESIGN-CHAT order, with no unlock and no kind that takes a path", () => {
    expect(INTENT_KINDS).toEqual(["fix_rule", "fix_batch", "show_where", "explain_rule", "open_details", "show_list", "rescan", "change_ai", "snooze_rule", "accept_rule", "open_watch"]);
    expect(INTENT_KINDS).toHaveLength(11);
    expect(INTENT_KINDS as readonly string[]).not.toContain("unlock");
    expect(INTENT_KINDS as readonly string[]).not.toContain("run_command");
  });

  it("the five kinds without a rule are a subset and the schema's enum is the same list", () => {
    expect(INTENT_KINDS_WITHOUT_RULE).toEqual(["fix_batch", "show_list", "rescan", "change_ai", "open_watch"]);
    for (const kind of INTENT_KINDS_WITHOUT_RULE) expect(INTENT_KINDS).toContain(kind);
    const intent = (CHAT_JSON_SCHEMA["properties"] as { intents: { items: { properties: { kind: { enum: string[] } } } } }).intents.items.properties.kind;
    expect(intent.enum).toEqual([...INTENT_KINDS]);
  });
});
