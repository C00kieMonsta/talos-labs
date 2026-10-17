import { describe, expect, it } from "vitest";
import { buildWatchInstructions } from "../../src/explainer/remote";
import { ACCEPTED_SENTENCE, buildExplainerSystemPrompt, buildSystemPrompt } from "../../src/explainer/system-prompt";
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

describe("buildExplainerSystemPrompt", () => {
  it("is the frozen prompt plus one accepted block; the frozen prompt and the watch text stay without it", () => {
    expect(ACCEPTED_SENTENCE).toBe("A finding marked accepted is one the reader knows about and chose to leave. Never tell them to fix it; mention it only when asked.");
    const prompt = buildExplainerSystemPrompt(MACOS_CATALOG);
    expect(prompt).toBe(`${buildSystemPrompt(MACOS_CATALOG)}\n\n6. Accepted\n${ACCEPTED_SENTENCE}`);
    expect(prompt).toContain(ACCEPTED_SENTENCE);
    expect(buildSystemPrompt(MACOS_CATALOG)).not.toContain(ACCEPTED_SENTENCE);
    expect(buildSystemPrompt(MACOS_CATALOG)).not.toContain("6. Accepted");
    expect(buildWatchInstructions()).not.toContain(ACCEPTED_SENTENCE);
    expect(prompt).not.toContain("\u2014");
  });
});
