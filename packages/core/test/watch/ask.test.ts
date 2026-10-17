import { describe, expect, it } from "vitest";
import { askWhyQuestion } from "../../src/watch/ask";
import { WATCH_HEADLINES } from "../../src/watch/cases";
import { WATCH_BANNED_PATTERN } from "../../src/watch/words";

describe("askWhyQuestion", () => {
  it("is the Why chip's form: the headline quoted as a title, its case kept", () => {
    expect(askWhyQuestion("A new start-up program appeared")).toBe('Why does "A new start-up program appeared" matter?');
  });

  it("keeps the headline's own capitals", () => {
    expect(askWhyQuestion("Your Mac is listening")).toBe('Why does "Your Mac is listening" matter?');
  });

  it("trims surrounding spaces", () => {
    expect(askWhyQuestion("  Your backups were switched off  ")).toBe('Why does "Your backups were switched off" matter?');
  });

  it("throws invalid_input on an empty headline", () => {
    expect(() => askWhyQuestion("")).toThrow("invalid_input");
    expect(() => askWhyQuestion("  ")).toThrow("invalid_input");
  });

  it("passes the banned-word pattern for every watch headline", () => {
    for (const headline of Object.values(WATCH_HEADLINES)) {
      const question = askWhyQuestion(headline);
      expect(WATCH_BANNED_PATTERN.test(question), question).toBe(false);
      expect(question.startsWith("Why does ")).toBe(true);
      expect(question.endsWith(" matter?")).toBe(true);
    }
  });
});
