import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { completeJsonPrefix } from "../../src/explainer/partial-json";

interface Case {
  readonly prefix: string;
  readonly value: unknown;
}

const CASES = JSON.parse(readFileSync(join(__dirname, "..", "..", "fixtures", "partial-json-cases.json"), "utf8")) as Case[];

describe("completeJsonPrefix", () => {
  it("the fixture has at least 20 cases", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
  });

  for (const { prefix, value } of CASES) {
    it(`${JSON.stringify(prefix)} -> ${JSON.stringify(value)}`, () => {
      expect(completeJsonPrefix(prefix)).toEqual(value);
    });
  }

  it("returns the complete document unchanged for every character-by-character prefix of it", () => {
    const full = { ruleId: "TL-MAC-001", whyItMattersForYou: "Your files are readable by anyone with the disk. \"Quoted\" and \\ slashed.", whatCouldHappen: "Loss.", urgency: "today" };
    const text = JSON.stringify(full);
    expect(completeJsonPrefix(text)).toEqual(full);
    for (let i = 1; i < text.length; i += 1) {
      const partial = completeJsonPrefix(text.slice(0, i));
      // Every snapshot is an object whose string values are prefixes of the final ones.
      expect(partial === null || typeof partial === "object").toBe(true);
      if (partial !== null && typeof partial === "object") {
        for (const [key, v] of Object.entries(partial as Record<string, unknown>)) {
          const final = full[key as keyof typeof full];
          expect(typeof v).toBe("string");
          expect(final.startsWith(v as string)).toBe(true);
        }
      }
    }
  });

  it("refuses absurd nesting", () => {
    expect(completeJsonPrefix("[".repeat(200))).toBeNull();
  });
});
