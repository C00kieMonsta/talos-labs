import { describe, expect, it } from "vitest";
import { askWhyQuestion } from "../../src/watch/ask";
import { WATCH_HEADLINES } from "../../src/watch/cases";
import { WATCH_BANNED_PATTERN } from "../../src/watch/words";

describe("askWhyQuestion", () => {
  it("is the Why chip's form: the headline with its first letter lower-cased, no quotes", () => {
    expect(askWhyQuestion("A new start-up program appeared")).toBe("Why does a new start-up program appeared matter?");
    expect(askWhyQuestion("A new start-up program appeared")).not.toContain('"');
  });

  it("lower-cases the first character only, so Mac keeps its capital", () => {
    expect(askWhyQuestion("Your Mac is listening")).toBe("Why does your Mac is listening matter?");
  });

  it("trims surrounding spaces", () => {
    expect(askWhyQuestion("  Your backups were switched off  ")).toBe("Why does your backups were switched off matter?");
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
