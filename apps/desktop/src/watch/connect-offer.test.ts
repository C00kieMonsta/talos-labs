import { describe, expect, it } from "vitest";
import { connectOffer } from "./connect-offer";

const NOW = "2026-10-17T12:00:00.000Z";

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}

function settings(provider: string, aiEnabled = true): string {
  // The parser keeps a Developer provider only in Developer mode; the flag follows the provider here.
  return JSON.stringify({ explainer: { provider, aiEnabled }, developer: { enabled: provider === "ollama" || provider === "claude" }, onboarded: true });
}

function guided(aiAskedAt: string | null): string {
  return JSON.stringify({ version: 1, aiAskedAt });
}

function storage(values: Record<string, string | null>): Pick<Storage, "getItem"> {
  return { getItem: (key) => values[key] ?? null };
}

describe("connectOffer", () => {
  it("is true with the switch on, a consumer provider and no recent Not now", () => {
    expect(connectOffer(storage({ "talos.settings": settings("chatgpt"), "talos.guided": guided(null) }), NOW)).toBe(true);
    expect(connectOffer(storage({ "talos.settings": settings("claude_plan"), "talos.guided": guided(daysAgo(20)) }), NOW)).toBe(true);
    expect(connectOffer(storage({ "talos.settings": settings("apple"), "talos.guided": guided(null) }), NOW)).toBe(true);
  });

  it("is false with a Developer provider", () => {
    expect(connectOffer(storage({ "talos.settings": settings("ollama"), "talos.guided": guided(null) }), NOW)).toBe(false);
    expect(connectOffer(storage({ "talos.settings": settings("claude"), "talos.guided": guided(null) }), NOW)).toBe(false);
  });

  it("is false within 14 days of Not now and true after", () => {
    expect(connectOffer(storage({ "talos.settings": settings("chatgpt"), "talos.guided": guided(daysAgo(3)) }), NOW)).toBe(false);
    expect(connectOffer(storage({ "talos.settings": settings("chatgpt"), "talos.guided": guided(daysAgo(13)) }), NOW)).toBe(false);
    expect(connectOffer(storage({ "talos.settings": settings("chatgpt"), "talos.guided": guided(daysAgo(20)) }), NOW)).toBe(true);
  });

  it("is false with the switch off", () => {
    expect(connectOffer(storage({ "talos.settings": settings("chatgpt", false), "talos.guided": guided(null) }), NOW)).toBe(false);
    expect(connectOffer(storage({ "talos.settings": settings("none"), "talos.guided": guided(null) }), NOW)).toBe(false);
  });

  it("is false when either key is missing or broken, or the storage throws", () => {
    expect(connectOffer(storage({ "talos.guided": guided(null) }), NOW)).toBe(false);
    expect(connectOffer(storage({ "talos.settings": settings("chatgpt") }), NOW)).toBe(false);
    expect(connectOffer(storage({ "talos.settings": "{not json", "talos.guided": guided(null) }), NOW)).toBe(false);
    expect(connectOffer(storage({ "talos.settings": settings("chatgpt"), "talos.guided": "[" }), NOW)).toBe(false);
    expect(
      connectOffer(
        {
          getItem: () => {
            throw new Error("SecurityError");
          },
        },
        NOW,
      ),
    ).toBe(false);
  });
});
