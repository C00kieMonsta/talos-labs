import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/explainer/system-prompt";
import { MACOS_CATALOG } from "../../src/rules/macos/index";

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(MACOS_CATALOG);

  it("is deterministic", () => {
    expect(buildSystemPrompt(MACOS_CATALOG)).toBe(prompt);
  });

  it("carries the five parts in order", () => {
    const parts = ["1. Role", "2. Data contract", "3. Catalog", "4. Audience", "5. Output"];
    let last = -1;
    for (const part of parts) {
      const at = prompt.indexOf(part);
      expect(at, part).toBeGreaterThan(last);
      last = at;
    }
  });

  it("lists id, title, explanation and fix summary for every rule", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(prompt).toContain(rule.id);
      expect(prompt).toContain(rule.title);
      expect(prompt).toContain(rule.explanation);
      expect(prompt).toContain(rule.fix.summary);
    }
    expect(prompt).toContain(MACOS_CATALOG.cisEdition);
  });

  it("states the data contract and the no-commands rule", () => {
    expect(prompt).toContain("contains no text from the computer");
    expect(prompt).toContain("British English");
    expect(prompt).toContain("Never write fix steps");
    expect(prompt).toContain("laptopLeavesHome");
    expect(prompt).toContain("handlesClientData");
  });
});
