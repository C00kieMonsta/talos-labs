import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WATCH_BANNED_PATTERN, WATCH_BANNED_WORDS } from "../../src/watch/words";

const FIXTURE = join(__dirname, "..", "..", "fixtures", "watch-cases.json");

describe("WATCH_BANNED_WORDS", () => {
  it("has the nineteen words of guided/copy.test.ts in its order and matches the fixture", () => {
    expect(WATCH_BANNED_WORDS).toHaveLength(19);
    expect(WATCH_BANNED_WORDS[0]).toBe("finding");
    expect(WATCH_BANNED_WORDS[18]).toBe("points");
    const cases = JSON.parse(readFileSync(FIXTURE, "utf8")) as { bannedWords: string[] };
    expect(cases.bannedWords).toEqual([...WATCH_BANNED_WORDS]);
  });

  it("the pattern is whole-word and case-insensitive", () => {
    expect(WATCH_BANNED_PATTERN.test("A new rule appeared.")).toBe(true);
    expect(WATCH_BANNED_PATTERN.test("A NEW RULE appeared.")).toBe(true);
    expect(WATCH_BANNED_PATTERN.test("the terminal is open")).toBe(true);
    expect(WATCH_BANNED_PATTERN.test("A ruler on the desk.")).toBe(false);
    expect(WATCH_BANNED_PATTERN.test("Two commands ran.")).toBe(false);
    expect(WATCH_BANNED_PATTERN.test("Nothing changed on this Mac today.")).toBe(false);
    for (const word of WATCH_BANNED_WORDS) expect(WATCH_BANNED_PATTERN.test(`about ${word.toLowerCase()} here`), word).toBe(true);
  });
});
