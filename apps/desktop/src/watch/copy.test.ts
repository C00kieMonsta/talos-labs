import { describe, expect, it } from "vitest";
import { askWhyQuestion, WATCH_BANNED_PATTERN } from "@talos/core";
import { FISHY } from "../guided/copy";
import { guidedFor } from "../guided/plan";
import { AI_BADGES_SHORT, reasonLabel, WATCH_WINDOW } from "./copy";

/** A copy of syllablesPerWord from src/guided/copy.test.ts (the fixed counter of DESIGN-V03.md section 6). */
function syllablesPerWord(text: string): number {
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

/** The dev values of docs/DESIGN-WATCH-WINDOW.md section 6. */
const DEV = {
  n: "3",
  time: "15:30",
  score: "72",
  grade: "Fair",
  headline: FISHY.noticed.headline.persistence,
  area: "network services",
  areas: "network services, file sharing and remote access",
  reason: "Needs Full Disk Access",
} as const;

function fill(text: string): string {
  return Object.entries(DEV).reduce((out, [key, value]) => out.split(`{${key}}`).join(value), text);
}

/** Every string of WATCH_WINDOW, filled; askWhy with the dev headline. */
function filledStrings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(WATCH_WINDOW)) out[key] = typeof value === "function" ? value(DEV.headline) : fill(value);
  return out;
}

/** The per-string counter list of section 6; meta lines, the placeholder, links, badges and the composed couldNotCheck lines are exempt. */
const SCORED: readonly { readonly key: keyof typeof WATCH_WINDOW; readonly score: number }[] = [
  { key: "calmDays", score: 1.0 },
  { key: "calmDay", score: 1.5 },
  { key: "calmHours", score: 1.0 },
  { key: "calmHour", score: 1.0 },
  { key: "calmRecent", score: 1.0 },
  { key: "calmStart", score: 1.2 },
  { key: "checkup", score: 1.33 },
  { key: "checkupNone", score: 1.4 },
  { key: "askPlaceholder", score: 1.2 },
  { key: "askLink", score: 1.25 },
  { key: "askWhatChangedLink", score: 1.33 },
  { key: "askWhatChanged", score: 1.2 },
  { key: "connectLine", score: 1.11 },
  { key: "connectLink", score: 1.33 },
  { key: "couldNotCheckMixed", score: 1.3 },
  { key: "lookEmptyNew", score: 1.13 },
  { key: "lookEmptyNewMany", score: 1.13 },
  { key: "lookEmptyChange", score: 1.0 },
  { key: "lookEmptyChanges", score: 1.2 },
  { key: "pausedLine", score: 1.13 },
];

describe("WATCH_WINDOW copy", () => {
  it("has no banned word in any string, filled with the dev values", () => {
    for (const [key, text] of Object.entries(filledStrings())) expect(text, key).not.toMatch(WATCH_BANNED_PATTERN);
    for (const text of Object.values(AI_BADGES_SHORT)) expect(text, text).not.toMatch(WATCH_BANNED_PATTERN);
  });

  it("uses no em-dash and no placeholder left unfilled", () => {
    for (const [key, text] of Object.entries(filledStrings())) {
      expect(text, key).not.toContain("\u2014");
      expect(text, key).not.toMatch(/\{[a-z]+\}/i);
    }
  });

  it("scores each guided-style line under 1.6 syllables per word, at the section 6 number", () => {
    const filled = filledStrings();
    for (const { key, score } of SCORED) {
      const text = filled[key] ?? "";
      expect(syllablesPerWord(text), key).toBeLessThanOrEqual(1.6);
      expect(syllablesPerWord(text), key).toBeCloseTo(score, 2);
    }
  });

  it("scores Up next and the Why question with the mock-up's headlines at the section 6 numbers", () => {
    expect(syllablesPerWord(WATCH_WINDOW.upNext.replace("{headline}", guidedFor("TL-MAC-001").headline))).toBeCloseTo(1.14, 2);
    expect(syllablesPerWord(WATCH_WINDOW.askWhy("A new program starts when you log in"))).toBeCloseTo(1.18, 2);
  });

  it("askWhy delegates to askWhyQuestion and stays under 1.6 for every noticed headline", () => {
    for (const headline of Object.values(FISHY.noticed.headline)) {
      const question = WATCH_WINDOW.askWhy(headline);
      expect(question).toBe(askWhyQuestion(headline));
      expect(question).not.toContain('"');
      expect(question.startsWith("Why does ")).toBe(true);
      expect(question.endsWith(" matter?")).toBe(true);
      expect(syllablesPerWord(question), headline).toBeLessThanOrEqual(1.6);
      expect(question).not.toMatch(WATCH_BANNED_PATTERN);
    }
  });

  it("the short badges name the provider and end in not verified", () => {
    expect(AI_BADGES_SHORT).toEqual({
      chatgpt: "ChatGPT, not verified",
      claude_plan: "Claude, not verified",
      apple: "Apple Intelligence on this Mac, not verified",
    });
  });

  it("the plural keys differ only by the plural, and the singular is picked by n === 1 at the call site", () => {
    expect(WATCH_WINDOW.lookEmptyNew.replace("thing", "things")).toBe(WATCH_WINDOW.lookEmptyNewMany);
    expect(WATCH_WINDOW.lookEmptyChange.replace("change", "changes")).toBe(WATCH_WINDOW.lookEmptyChanges);
  });

  it("reasonLabel reads the socket-table word for unsigned_build and the v0.2 words otherwise", () => {
    expect(reasonLabel("unsigned_build")).toBe("Not available in this build");
    expect(reasonLabel("needs_full_disk_access")).toBe("Needs Full Disk Access");
    expect(reasonLabel("permission_denied")).toBe("Permission was denied");
    expect(reasonLabel("needs_admin")).toBe("Needs an administrator account");
  });

  it("never says protected, safe, secure, clean or fine", () => {
    for (const [key, text] of Object.entries(filledStrings())) expect(text, key).not.toMatch(/\b(protected|safe|secure|clean|fine)\b/i);
  });
});
