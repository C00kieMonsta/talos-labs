import { describe, expect, it } from "vitest";
import { DEMO_REASONS, HEIGHT_CASES, LONG_WINDOW_SENTENCE, VALIDATE_CASES, WINDOW_SENTENCE_CASES } from "../../src/watch/cases";
import { APP_VOICE, APP_VOICE_I, ID_LIKE, safeSentence, safeWindowSentence, validateWatchVerdict } from "../../src/watch/validate";

const base = VALIDATE_CASES[0];
if (base === undefined || base.expected === "rejected") throw new Error("the first validate case must be the kept verdict");
const CONTEXT = base.context;
const GOOD = base.raw as Record<string, unknown>;

describe("safeWindowSentence", () => {
  it("every fixture case answers as recorded", () => {
    for (const c of WINDOW_SENTENCE_CASES) expect(safeWindowSentence(c.text, c.rating), c.name).toBe(c.kept);
  });

  it("has every case of docs/DESIGN-WATCH-WINDOW.md section 7, the duration one on both ratings", () => {
    const names = WINDOW_SENTENCE_CASES.map((c) => c.name);
    for (const needle of [
      "kept: what is open and why, under 120 characters",
      "kept: a clock time is not a port",
      "kept: and/or is not a path",
      "kept: malware alone is allowed",
      "kept: a duration on keep_an_eye",
      "dropped: a duration on calm",
      "dropped: the app's voice",
      "dropped: a reassurance word",
      "dropped: no malware",
      "dropped: an action claim",
      "dropped: an imperative start",
      "dropped: a banned word",
      "dropped: a path",
      "dropped: a port",
      "dropped: a host and port",
      "dropped: an any-host port",
      "dropped: a rule id",
      "dropped: a signal id",
      "kept: a lower-case i is not the app's voice",
      "dropped: a 121-character sentence",
      "dropped: two sentences",
      "dropped: empty",
    ]) {
      expect(names, needle).toContain(needle);
    }
    const duration = WINDOW_SENTENCE_CASES.filter((c) => c.text === "Three days without a change.");
    expect(duration.map((c) => [c.rating, c.kept])).toEqual([
      ["keep_an_eye", true],
      ["calm", false],
    ]);
    expect(LONG_WINDOW_SENTENCE).toHaveLength(121);
    expect(safeWindowSentence(LONG_WINDOW_SENTENCE.slice(1), "keep_an_eye")).toBe(true);
  });

  it("the bare pronoun is case-sensitive and the contractions are not, as in Rust", () => {
    expect(APP_VOICE_I.test("I think so")).toBe(true);
    expect(APP_VOICE_I.test("the option i on that screen")).toBe(false);
    expect(APP_VOICE_I.test("Wi-Fi is on")).toBe(false);
    expect(APP_VOICE.test("i'll look")).toBe(true);
    expect(APP_VOICE.test("LET'S go")).toBe(true);
    expect(APP_VOICE.test("I")).toBe(false);
    expect(safeWindowSentence("The option i on that screen is still off.", "keep_an_eye")).toBe(true);
    expect(safeWindowSentence("I think the option is off.", "keep_an_eye")).toBe(false);
  });

  it("an id never reaches the window line, while an action sentence keeps the looser rule", () => {
    for (const text of ["TL-MAC-004 is still open on this Mac.", "sig.persistence_new moved again.", "probe.hosts could not run.", "act.report is the next step."]) {
      expect(ID_LIKE.test(text), text).toBe(true);
      expect(safeWindowSentence(text, "act_now"), text).toBe(false);
      expect(safeSentence(text), text).toBe(true);
    }
    expect(ID_LIKE.test("It is time to act. Nothing else moved.")).toBe(false);
    expect(ID_LIKE.test("The signal is a probe of the act.")).toBe(false);
  });

  it("the first kept sentence is under 120 characters and whitespace alone is dropped", () => {
    const first = WINDOW_SENTENCE_CASES[0];
    expect(first?.text.length).toBeLessThanOrEqual(120);
    expect(safeWindowSentence("   ", "calm")).toBe(false);
  });

  it("a dropped reason leaves the verdict valid with ratingReason empty", () => {
    for (const text of ["Your Mac is safe for now.", "I'll keep an eye on it for you.", LONG_WINDOW_SENTENCE]) {
      const result = validateWatchVerdict({ ...GOOD, ratingReason: text }, CONTEXT);
      expect(result.ok, text).toBe(true);
      if (result.ok) expect(result.value.ratingReason, text).toBe("");
    }
    const kept = validateWatchVerdict({ ...GOOD, ratingReason: "Two things changed within the hour." }, CONTEXT);
    expect(kept.ok && kept.value.ratingReason).toBe("Two things changed within the hour.");
  });

  it("the reason is checked against the clamped rating, not the one the model wrote", () => {
    const calmContext = { ...CONTEXT, floor: "calm" as const, ceiling: "calm" as const };
    const result = validateWatchVerdict({ ...GOOD, rating: "act_now", ratingReason: "Three days without a change.", actions: [] }, calmContext);
    expect(result.ok && result.value.rating).toBe("calm");
    expect(result.ok && result.value.ratingReason).toBe("");
  });

  it("action sentences keep safeSentence only: reassurance and duration words stay", () => {
    for (const sentence of ["Your Mac is safe now.", "Three days without a change."]) {
      expect(safeSentence(sentence), sentence).toBe(true);
      const result = validateWatchVerdict({ ...GOOD, actions: [{ actionId: "act.disconnect_network", sentence }] }, CONTEXT);
      expect(result.ok && result.value.actions[0]?.sentence, sentence).toBe(sentence);
    }
  });

  it("every demo and height-case judge reason passes for its rating", () => {
    for (const rating of ["calm", "keep_an_eye", "act_now"] as const) expect(safeWindowSentence(DEMO_REASONS[rating], rating), rating).toBe(true);
    for (const c of HEIGHT_CASES) {
      if (c.state.judge === null) continue;
      expect(safeWindowSentence(c.state.judge.reason, c.state.judge.rating), c.name).toBe(true);
      expect(c.state.judge.rating, c.name).toBe(c.state.rating);
    }
  });
});
