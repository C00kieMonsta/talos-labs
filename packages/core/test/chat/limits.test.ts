import { describe, expect, it } from "vitest";
import { CHAT_LIMITS, clampChatHistory, clampChatQuestion } from "../../src/explainer/limits";
import type { Turn } from "../../src/ports/explainer-port";

const turns: Turn[] = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", text: `${i} ${"x".repeat(500)}` }));

describe("clampChatHistory", () => {
  it("keeps the newest six turns untouched for a remote provider", () => {
    const out = clampChatHistory(turns, "remote");
    expect(out).toHaveLength(CHAT_LIMITS.maxHistoryTurnsRemote);
    expect(out[0]?.text.startsWith("2 ")).toBe(true);
    expect(out[5]?.text.length).toBe(502);
  });

  it("keeps the newest two turns at 400 characters on this Mac", () => {
    const out = clampChatHistory(turns, "on_device");
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(out[0]?.text.startsWith("6 ")).toBe(true);
    for (const turn of out) expect(turn.text.length).toBe(CHAT_LIMITS.maxOnDeviceTurnChars);
  });

  it("returns the same array when nothing needs cutting for a remote provider", () => {
    const short = turns.slice(0, 2);
    expect(clampChatHistory(short, "remote")).toBe(short);
  });
});

describe("clampChatQuestion", () => {
  it("cuts at 500 characters", () => {
    expect(clampChatQuestion("a".repeat(600)).length).toBe(500);
    expect(clampChatQuestion("short")).toBe("short");
  });
});
