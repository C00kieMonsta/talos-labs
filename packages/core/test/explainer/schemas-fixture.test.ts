import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { strictSchema } from "../../src/explainer/remote";
import { ANSWER_JSON_SCHEMA, EXPLANATION_JSON_SCHEMA, PRIORITISATION_JSON_SCHEMA } from "../../src/explainer/schemas";

const FILE = join(__dirname, "..", "..", "fixtures", "explainer-schemas.json");
const SCHEMAS = { explain: EXPLANATION_JSON_SCHEMA, prioritise: PRIORITISATION_JSON_SCHEMA, ask: ANSWER_JSON_SCHEMA };
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
  it("equals the three raw schemas Claude Code receives (run pnpm fixtures:emit otherwise)", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).toBe(`${JSON.stringify(SCHEMAS, null, 2)}\n`);
    expect(JSON.parse(text)).toEqual(SCHEMAS);
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
