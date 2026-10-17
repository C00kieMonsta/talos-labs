import { describe, expect, it, vi } from "vitest";
import { TauriAiConnect, toConnectOffered, toConnectPoll } from "./tauri-ai-connect";

describe("TauriAiConnect", () => {
  it("names only the provider on the wire for the six commands", async () => {
    const invoke = vi.fn(async (cmd: string): Promise<unknown> => {
      if (cmd === "ai_connect_offered") return { chatgpt: true, claude_plan: false, apple: true };
      if (cmd === "ai_connect_start") return { stage: "fetching" };
      if (cmd === "ai_connect_poll") return { stage: "signing_in" };
      return undefined;
    });
    const port = new TauriAiConnect(invoke);
    expect(await port.offered()).toEqual({ chatgpt: true, claude_plan: false, apple: true });
    // start() answers with the stage Rust seeded.
    expect(await port.start("chatgpt")).toEqual({ stage: "fetching" });
    expect(await port.poll("chatgpt")).toEqual({ stage: "signing_in" });
    await port.cancel("chatgpt");
    await port.disconnect("claude_plan");
    expect(invoke.mock.calls).toEqual([
      ["ai_connect_offered", {}],
      ["ai_connect_start", { provider: "chatgpt" }],
      ["ai_connect_poll", { provider: "chatgpt" }],
      ["ai_connect_cancel", { provider: "chatgpt" }],
      ["ai_disconnect", { provider: "claude_plan" }],
    ]);
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/https?:|--/);
  });

  it("start rethrows the Rust code as an Error; a failed poll or offered falls back safely", async () => {
    const invoke = vi.fn(async (cmd: string): Promise<unknown> => {
      if (cmd === "ai_connect_start") throw "busy";
      throw "boom";
    });
    const port = new TauriAiConnect(invoke);
    await expect(port.start("claude_plan")).rejects.toThrow("busy");
    expect(await port.poll("claude_plan")).toEqual({ stage: "failed", outcome: "provider_unavailable" });
    expect(await port.offered()).toEqual({ chatgpt: false, claude_plan: false, apple: true });
    await expect(port.cancel("claude_plan")).resolves.toBeUndefined();
    await expect(port.disconnect("claude_plan")).rejects.toThrow("boom");
  });

  it("parses polls and offered flags, mapping anything unknown to a safe value", () => {
    expect(toConnectPoll({ stage: "idle" })).toEqual({ stage: "idle" });
    expect(toConnectPoll({ stage: "fetching" })).toEqual({ stage: "fetching" });
    expect(toConnectPoll({ stage: "done" })).toEqual({ stage: "done" });
    expect(toConnectPoll({ stage: "failed", outcome: "timeout" })).toEqual({ stage: "failed", outcome: "timeout" });
    expect(toConnectPoll({ stage: "failed", outcome: "weird" })).toEqual({ stage: "failed", outcome: "provider_unavailable" });
    expect(toConnectPoll({ stage: "weird" })).toEqual({ stage: "failed", outcome: "provider_unavailable" });
    expect(toConnectPoll(null)).toEqual({ stage: "failed", outcome: "provider_unavailable" });
    expect(toConnectOffered({ chatgpt: true, claude_plan: true, apple: false })).toEqual({ chatgpt: true, claude_plan: true, apple: false });
    expect(toConnectOffered({})).toEqual({ chatgpt: false, claude_plan: false, apple: true });
    expect(toConnectOffered("x")).toEqual({ chatgpt: false, claude_plan: false, apple: true });
  });
});
