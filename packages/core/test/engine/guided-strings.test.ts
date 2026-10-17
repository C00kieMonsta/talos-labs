import { describe, expect, it } from "vitest";
import { MACOS_CATALOG } from "../../src/rules/macos/index";

export const BANNED_WORDS: readonly string[] = [
  "finding",
  "findings",
  "severity",
  "CIS",
  "rule",
  "rules",
  "policy",
  "configuration",
  "SSH",
  "launchd",
  "plist",
  "daemon",
  "sudo",
  "Terminal",
  "TCC",
  "stealth",
  "sysadminctl",
  "command",
  "points",
];

export const BANNED_PATTERN = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "i");

/** The fixed counter from DESIGN-V03.md section 6. Errs long on purpose. */
export function syllablesPerWord(text: string): number {
  const words = text
    .split(/\s+/)
    .filter((token) => /[a-z]/i.test(token))
    .map((token) => token.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return 0;
  }
  let total = 0;
  for (const word of words) {
    const runs = word.match(/[aeiouy]+/g)?.length ?? 0;
    let count = runs;
    if (runs > 1 && word.endsWith("e") && !word.endsWith("le")) {
      count -= 1;
    }
    total += Math.max(1, count);
  }
  return total / words.length;
}

const DEEP_LINK = ["TL-MAC-001", "TL-MAC-004", "TL-MAC-006", "TL-MAC-010", "TL-MAC-012", "TL-MAC-014", "TL-MAC-018", "TL-MAC-023", "TL-MAC-025", "TL-MAC-026", "TL-MAC-027", "TL-MAC-032", "TL-MAC-034"];
const MANUAL = ["TL-MAC-005", "TL-MAC-017", "TL-MAC-024", "TL-MAC-028", "TL-MAC-031", "TL-MAC-035", "TL-MAC-036"];

describe("guided strings", () => {
  it("every rule has all five strings within the caps", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const g = rule.guided;
      expect(g.headline.trim().length, rule.id).toBeGreaterThan(0);
      expect(g.headline.length, rule.id).toBeLessThanOrEqual(60);
      expect(g.why.length, rule.id).toBeLessThanOrEqual(110);
      expect(g.verb.trim().length, rule.id).toBeGreaterThan(0);
      expect(g.verb.length, rule.id).toBeLessThanOrEqual(22);
      expect(g.done.trim().length, rule.id).toBeGreaterThan(0);
    }
  });

  it("headline has no trailing stop; why and done end with one; done starts with Done.", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const g = rule.guided;
      expect(g.headline.endsWith("."), rule.id).toBe(false);
      expect(g.why.endsWith("."), rule.id).toBe(true);
      expect(g.done.endsWith("."), rule.id).toBe(true);
      expect(g.done.startsWith("Done."), rule.id).toBe(true);
    }
  });

  it("where is present exactly for deep_link rules", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const isDeepLink = rule.fix.apply.kind === "deep_link";
      expect(rule.guided.where !== null, rule.id).toBe(isDeepLink);
      expect(DEEP_LINK.includes(rule.id), rule.id).toBe(isDeepLink);
    }
  });

  it("verb is Show me where exactly for deep_link and Details exactly for manual", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const kind = rule.fix.apply.kind;
      expect(rule.guided.verb === "Show me where", rule.id).toBe(kind === "deep_link");
      expect(rule.guided.verb === "Details", rule.id).toBe(kind === "manual");
      expect(MANUAL.includes(rule.id), rule.id).toBe(kind === "manual");
    }
  });

  it("no string contains a banned word", () => {
    for (const rule of MACOS_CATALOG.rules) {
      for (const text of [rule.guided.headline, rule.guided.why, rule.guided.verb, rule.guided.done, rule.guided.where ?? ""]) {
        expect(text, `${rule.id}: ${text}`).not.toMatch(BANNED_PATTERN);
      }
    }
  });

  it("headline and why stay at or under 1.6 syllables per word", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(syllablesPerWord(rule.guided.headline), `${rule.id} headline`).toBeLessThanOrEqual(1.6);
      expect(syllablesPerWord(rule.guided.why), `${rule.id} why`).toBeLessThanOrEqual(1.6);
    }
  });

  it("the counter matches the documented examples", () => {
    expect(syllablesPerWord("every")).toBe(3);
    expect(syllablesPerWord("Apple")).toBe(2);
    expect(syllablesPerWord("Built-in virus protection is missing")).toBe(2);
    expect(syllablesPerWord("add-on")).toBe(2);
    expect(syllablesPerWord("2 of 7")).toBe(1);
  });
});
