import { describe, expect, it } from "vitest";
import { clampHistory, clampQuestion, clampString } from "../../src/explainer/limits";
import type { Turn } from "../../src/ports/explainer-port";

describe("limits", () => {
  it("cuts a 10 kB question at 2000 characters", () => {
    const question = "q".repeat(10_000);
    expect(clampQuestion(question)).toHaveLength(2000);
    expect(clampQuestion("short")).toBe("short");
  });

  it("does not leave a dangling surrogate", () => {
    const text = `${"a".repeat(1999)}\u{1F600}`;
    expect(clampQuestion(text)).toHaveLength(1999);
    expect(clampString("\u{1F600}", 1)).toBe("");
  });

  it("keeps the most recent 10 turns", () => {
    const history: Turn[] = Array.from({ length: 25 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", text: `t${i}` }));
    const clamped = clampHistory(history);
    expect(clamped).toHaveLength(10);
    expect(clamped[0]?.text).toBe("t15");
    expect(clamped[9]?.text).toBe("t24");
    expect(clampHistory(history.slice(0, 3))).toHaveLength(3);
  });
});
