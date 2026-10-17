import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WATCH_INSTRUCTIONS_BLOCK, watchRequestBody } from "../../src/explainer/remote";
import { WATCH_REASON_RULES, buildOnDeviceWatchInstructions, buildWatchJudgeInstructions } from "../../src/explainer/watch-prompt";
import { toWatchContext } from "../../src/explainer/watch-context";
import { FISHY_KINDS, SIGNAL_IDS } from "../../src/ports/watch-port";
import { WATCH_CASES, WATCH_HEADLINES, WATCH_NOTIFY_TAIL, watchCasesJson } from "../../src/watch/cases";
import { applyHysteresis, boundsFor, rateWatch, topItems } from "../../src/watch/rate";
import { validateWatchVerdict } from "../../src/watch/validate";
import { WATCH_BANNED_WORDS } from "../../src/watch/words";

const DIR = join(__dirname, "..", "..", "fixtures");

describe("packages/core/fixtures/watch-cases.json", () => {
  it("equals watchCasesJson() (run pnpm fixtures:emit otherwise)", () => {
    const text = readFileSync(join(DIR, "watch-cases.json"), "utf8");
    expect(text).toBe(watchCasesJson());
    expect(Object.keys(JSON.parse(text) as object)).toEqual(["signalSeverity", "signalKind", "gated", "standAlone", "pairSet", "headlines", "notifyTail", "statusWords", "rate", "validate", "contexts", "chatgptBody", "bannedWords", "windowSentences", "heights", "reportRows"]);
  });

  it("the two instruction texts equal the builders, with the reason rules before the vocabulary block", () => {
    const judge = readFileSync(join(DIR, "watch-instructions.txt"), "utf8");
    expect(judge).toBe(buildWatchJudgeInstructions());
    expect(judge).toContain(WATCH_REASON_RULES);
    expect(judge.indexOf(WATCH_REASON_RULES)).toBeLessThan(judge.indexOf(WATCH_INSTRUCTIONS_BLOCK));
    expect(judge.endsWith(WATCH_INSTRUCTIONS_BLOCK)).toBe(true);
    expect(readFileSync(join(DIR, "watch-instructions-on-device.txt"), "utf8")).toBe(buildOnDeviceWatchInstructions());
  });

  it("carries the banned words the window's copy test and Rust pin", () => {
    expect(WATCH_CASES.bannedWords).toEqual([...WATCH_BANNED_WORDS]);
  });

  it("carries the tables, one headline per kind and the notification tail", () => {
    expect(Object.keys(WATCH_CASES.signalSeverity)).toEqual([...SIGNAL_IDS]);
    expect(Object.keys(WATCH_CASES.headlines)).toEqual([...FISHY_KINDS]);
    expect(WATCH_CASES.headlines).toBe(WATCH_HEADLINES);
    expect(WATCH_CASES.notifyTail).toBe(WATCH_NOTIFY_TAIL);
    expect(WATCH_NOTIFY_TAIL).toBe("Open me to see what experts suggest.");
    expect(WATCH_CASES.statusWords).toEqual({ calm: "Nothing changed", look: "Something to look at", lookOne: "One thing to look at", lookMany: "{n} things to look at", act: "Act now" });
  });
});

describe("every case is reproducible from the functions it pins", () => {
  it("rate: bounds, items, the raw rating and the hysteresis", () => {
    for (const c of WATCH_CASES.rate) {
      expect(boundsFor(c.context.signals, c.context.rules), c.name).toEqual(c.expectedBounds);
      expect(topItems(c.context.signals).map((i) => i.signalId), c.name).toEqual(c.expectedItems);
      expect(rateWatch(c.context, c.verdict), c.name).toBe(c.expectedRaw);
      expect(applyHysteresis(c.previousRating, c.expectedRaw, c.calmStreak), c.name).toEqual({ rating: c.expected, calmStreak: c.expectedCalmStreak });
    }
  });

  it("validate: every raw verdict answers as recorded", () => {
    for (const c of WATCH_CASES.validate) {
      const result = validateWatchVerdict(c.raw, c.context);
      expect(result.ok ? result.value : "rejected", c.name).toEqual(c.expected);
    }
  });

  it("contexts: toWatchContext over the input equals the expected context", () => {
    expect(WATCH_CASES.contexts.length).toBeGreaterThanOrEqual(4);
    for (const c of WATCH_CASES.contexts) expect(toWatchContext(c.input), c.name).toEqual(c.expected);
    const hundred = WATCH_CASES.contexts.find((c) => c.name.startsWith("100 report rows"));
    expect(hundred?.input.report?.results.length).toBe(110);
    expect(hundred?.expected.rules).toHaveLength(64);
    expect(new Set(hundred?.expected.rules.map((r) => r.ruleId)).size).toBe(64);
    expect(hundred?.expected.rules.map((r) => r.ruleId).slice(0, 3)).toEqual(["TL-MAC-R001", "TL-MAC-R002", "TL-MAC-R003"]);
  });

  it("chatgptBody: the body is watchRequestBody over the same inputs, non-streaming, 1200 tokens", () => {
    const c = WATCH_CASES.chatgptBody;
    expect(c.instructions).toBe(buildWatchJudgeInstructions());
    expect(c.body).toEqual(watchRequestBody(c.model, c.instructions, c.context));
    expect(c.body.stream).toBe(false);
    expect(c.body.max_output_tokens).toBe(1200);
    expect(c.body.text?.format.name).toBe("watch");
    expect(c.body.input).toHaveLength(1);
    expect(JSON.parse(c.body.input[0]?.content ?? "{}")).toEqual({ task: "watch", context: c.context });
  });
});
