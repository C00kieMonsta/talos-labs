import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { strictSchema } from "../../src/explainer/remote";
import { INTENT_KINDS, REMIND_WHENS } from "../../src/chat/intents";
import { ANSWER_JSON_SCHEMA, CHAT_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA, WATCH_JSON_SCHEMA } from "../../src/explainer/schemas";

const FILE = join(__dirname, "..", "..", "fixtures", "explainer-schemas.json");
const SCHEMAS = { explain: EXPLANATION_JSON_SCHEMA, prioritise: PRIORITISATION_JSON_SCHEMA, ask: ANSWER_JSON_SCHEMA, watch: WATCH_JSON_SCHEMA, chat: CHAT_JSON_SCHEMA };
const DROPPED = ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "pattern", "format"];

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) keysDeep(v, out);
  else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("packages/core/fixtures/explainer-schemas.json", () => {
  it("equals the five raw schemas Claude Code receives, chat last (run pnpm fixtures:emit otherwise)", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).toBe(`${JSON.stringify(SCHEMAS, null, 2)}\n`);
    expect(JSON.parse(text)).toEqual(SCHEMAS);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["explain", "prioritise", "ask", "watch", "chat"]);
  });

  it("the chat schema is the contract: four required keys, the closed kind enum, a nullable ruleId, three intents at most", () => {
    const props = CHAT_JSON_SCHEMA["properties"] as Record<string, Record<string, unknown>>;
    expect(CHAT_JSON_SCHEMA["required"]).toEqual(["reply", "relatedRuleIds", "outsideScope", "intents"]);
    expect(CHAT_JSON_SCHEMA["additionalProperties"]).toBe(false);
    expect(props["intents"]?.["maxItems"]).toBe(3);
    const intent = props["intents"]?.["items"] as { required: string[]; additionalProperties: boolean; properties: Record<string, Record<string, unknown>> };
    expect(intent.required).toEqual(["kind", "ruleId", "signalId", "when"]);
    expect(intent.additionalProperties).toBe(false);
    expect(intent.properties["kind"]).toEqual({ type: "string", enum: [...INTENT_KINDS] });
    expect(intent.properties["ruleId"]).toEqual({ type: ["string", "null"], minLength: 1, maxLength: 32 });
    const strict = strictSchema(CHAT_JSON_SCHEMA) as { properties: { intents: { items: { properties: { ruleId: unknown } } } } };
    expect(strict.properties.intents.items.properties.ruleId).toEqual({ type: ["string", "null"] });
  });

  it("an intent carries signalId (48 characters, for the longest signal id) and when (the two days or null); strict mode drops the caps only", () => {
    const props = CHAT_JSON_SCHEMA["properties"] as Record<string, Record<string, unknown>>;
    const intent = props["intents"]?.["items"] as { properties: Record<string, Record<string, unknown>> };
    expect(intent.properties["signalId"]).toEqual({ type: ["string", "null"], minLength: 1, maxLength: 48 });
    expect(intent.properties["when"]).toEqual({ type: ["string", "null"], enum: [...REMIND_WHENS, null] });
    expect(Object.keys(intent.properties)).toEqual(["kind", "ruleId", "signalId", "when"]);
    const strict = strictSchema(CHAT_JSON_SCHEMA) as { properties: { intents: { items: { properties: { signalId: unknown; when: unknown } } } } };
    expect(strict.properties.intents.items.properties.signalId).toEqual({ type: ["string", "null"] });
    expect(strict.properties.intents.items.properties.when).toEqual({ type: ["string", "null"], enum: ["tomorrow", "sunday", null] });
  });

  it("the watch schema is the contract: five required keys, the rating enum, the three caps", () => {
    const props = WATCH_JSON_SCHEMA["properties"] as Record<string, Record<string, unknown>>;
    expect(WATCH_JSON_SCHEMA["required"]).toEqual(["rating", "ratingReason", "basedOn", "probes", "actions"]);
    expect(WATCH_JSON_SCHEMA["additionalProperties"]).toBe(false);
    expect(props["rating"]).toEqual({ type: "string", enum: ["calm", "keep_an_eye", "act_now"] });
    expect(props["ratingReason"]).toEqual({ type: "string", maxLength: 120 });
    expect(props["basedOn"]?.["maxItems"]).toBe(6);
    expect(props["probes"]?.["maxItems"]).toBe(3);
    expect(props["actions"]?.["maxItems"]).toBe(3);
  });

  it("the raw schemas carry the string caps Claude Code enforces", () => {
    expect(keysDeep(SCHEMAS)).toContain("minLength");
    expect(keysDeep(SCHEMAS)).toContain("maxLength");
  });
});

describe("strictSchema", () => {
  for (const [task, schema] of Object.entries(SCHEMAS)) {
    it(`${task}: drops the eight unsupported keywords and keeps required and additionalProperties`, () => {
      const strict = strictSchema(schema);
      const keys = keysDeep(strict);
      for (const word of DROPPED) expect(keys, word).not.toContain(word);
      expect(strict["required"]).toEqual(schema["required"]);
      expect(strict["additionalProperties"]).toBe(false);
      expect(Object.keys(strict["properties"] as object)).toEqual(Object.keys(schema["properties"] as object));
    });
  }

  it("strips recursively through items and nested properties but never renames a property", () => {
    const strict = strictSchema({
      type: "object",
      properties: {
        pattern: { type: "string", pattern: "^x$", format: "email" },
        list: { type: "array", minItems: 1, maxItems: 9, items: { type: "number", minimum: 0, maximum: 5 } },
      },
      required: ["pattern", "list"],
      additionalProperties: false,
    });
    expect(strict).toEqual({
      type: "object",
      properties: { pattern: { type: "string" }, list: { type: "array", items: { type: "number" } } },
      required: ["pattern", "list"],
      additionalProperties: false,
    });
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(EXPLANATION_JSON_SCHEMA);
    strictSchema(EXPLANATION_JSON_SCHEMA);
    expect(JSON.stringify(EXPLANATION_JSON_SCHEMA)).toBe(before);
  });
});
