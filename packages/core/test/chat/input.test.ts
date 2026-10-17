import { describe, expect, it } from "vitest";
import { CHAT_EVENTS, type ChatOutcome } from "../../src/chat/input";
import { CHAT_LIMITS } from "../../src/explainer/limits";

describe("CHAT_EVENTS", () => {
  it("is the six outcomes the model may hear about, and the app-side outcomes are not among them", () => {
    expect(CHAT_EVENTS).toEqual(["fixed", "did_not_change", "snoozed", "accepted", "pane_opened", "rescanned"]);
    const appSide: readonly ChatOutcome[] = ["could_not_check", "cancelled", "wrong_password", "timeout", "watch_passed", "watch_expired", "unlocked", "stale", "stopped"];
    for (const outcome of appSide) expect(CHAT_EVENTS as readonly string[]).not.toContain(outcome);
  });
});

describe("CHAT_LIMITS", () => {
  it("pins the eleven caps of DESIGN-CHAT section 6", () => {
    expect(CHAT_LIMITS).toEqual({
      maxQuestionChars: 500,
      maxReplyChars: 1200,
      maxIntents: 3,
      maxRelated: 3,
      maxChips: 4,
      maxHistoryTurnsRemote: 6,
      maxHistoryTurnsOnDevice: 2,
      maxOnDeviceTurnChars: 400,
      maxEvents: 10,
      maxWatchItems: 6,
      maxPlanIds: 10,
    });
  });
});
