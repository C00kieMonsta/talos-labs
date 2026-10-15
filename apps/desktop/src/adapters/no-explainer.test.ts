import { describe, expect, it } from "vitest";
import { NoApiKeyExplainer, NoExplainer } from "./no-explainer";
import { TEST_CONTEXT } from "./test-fixtures";

describe("NoExplainer", () => {
  it("returns not_configured from every call", async () => {
    const port = new NoExplainer();
    expect(port.id).toBe("none");
    await expect(port.explain({ context: TEST_CONTEXT, ruleId: "TL-MAC-001" })).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    });
    await expect(port.prioritise({ context: TEST_CONTEXT })).resolves.toEqual({ ok: false, reason: "not_configured" });
    await expect(port.ask({ context: TEST_CONTEXT, history: [], question: "Why?" })).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    });
  });
});

describe("NoApiKeyExplainer", () => {
  it("returns no_api_key from every call and identifies as claude", async () => {
    const port = new NoApiKeyExplainer();
    expect(port.id).toBe("claude");
    await expect(port.explain({ context: TEST_CONTEXT, ruleId: "TL-MAC-001" })).resolves.toEqual({
      ok: false,
      reason: "no_api_key",
    });
    await expect(port.prioritise({ context: TEST_CONTEXT })).resolves.toEqual({ ok: false, reason: "no_api_key" });
    await expect(port.ask({ context: TEST_CONTEXT, history: [], question: "Why?" })).resolves.toEqual({
      ok: false,
      reason: "no_api_key",
    });
  });
});
