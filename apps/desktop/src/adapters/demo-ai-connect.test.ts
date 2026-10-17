import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONNECT_DELAY_MS, DemoAiConnect } from "./demo-ai-connect";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.__talosDemoCalls;
});

describe("DemoAiConnect seeding", () => {
  it("starts both providers not connected and offers everything by default", async () => {
    const connect = new DemoAiConnect();
    expect(await connect.offered()).toEqual({ chatgpt: true, claude_plan: true, apple: true });
    expect(connect.detail("chatgpt")).toEqual({ state: "not_connected", until: null });
    expect(connect.detail("claude_plan")).toEqual({ state: "not_connected", until: null });
    expect(connect.isConnected("chatgpt")).toBe(false);
    expect(await connect.poll("chatgpt")).toEqual({ stage: "idle" });
  });

  it("seeds the named provider from ai and ai_until; the other stays not connected", async () => {
    const connect = new DemoAiConnect({ provider: "chatgpt", ai: "limit_reached", aiUntil: "2026-10-16T18:00:00.000Z" });
    expect(connect.detail("chatgpt")).toEqual({ state: "limit_reached", until: "2026-10-16T18:00:00.000Z" });
    expect(connect.isConnected("chatgpt")).toBe(true);
    expect(connect.detail("claude_plan")).toEqual({ state: "not_connected", until: null });
    const available = new DemoAiConnect({ provider: "claude_plan", ai: "available" });
    expect(available.isConnected("claude_plan")).toBe(true);
    expect(available.isConnected("chatgpt")).toBe(false);
    const signedOut = new DemoAiConnect({ provider: "claude_plan", ai: "needs_sign_in" });
    expect(signedOut.isConnected("claude_plan")).toBe(true);
    const connecting = new DemoAiConnect({ provider: "chatgpt", ai: "connecting" });
    expect(connecting.isConnected("chatgpt")).toBe(false);
  });

  it("not_offered disables that provider's row and start refuses it", async () => {
    const connect = new DemoAiConnect({ provider: "chatgpt", ai: "not_offered" });
    expect(await connect.offered()).toEqual({ chatgpt: false, claude_plan: true, apple: true });
    await expect(connect.start("chatgpt")).rejects.toThrow("not_offered");
    expect(window.__talosDemoCalls).toEqual([{ kind: "aiConnectStart", arg: "chatgpt" }]);
  });

  it("hides the Apple row only for provider=apple with device_not_eligible", async () => {
    expect((await new DemoAiConnect({ provider: "apple", ai: "device_not_eligible" }).offered()).apple).toBe(false);
    expect((await new DemoAiConnect({ provider: "apple", ai: "model_not_ready" }).offered()).apple).toBe(true);
    expect((await new DemoAiConnect({ provider: "chatgpt", ai: "device_not_eligible" }).offered()).apple).toBe(true);
  });
});

describe("DemoAiConnect sign-in", () => {
  it("ok: signing_in for one delay, then done, available and connected", async () => {
    const connect = new DemoAiConnect({ connectDelayMs: 100 });
    await connect.start("chatgpt");
    expect(window.__talosDemoCalls).toEqual([{ kind: "aiConnectStart", arg: "chatgpt" }]);
    expect(await connect.poll("chatgpt")).toEqual({ stage: "signing_in" });
    expect(connect.detail("chatgpt").state).toBe("connecting");
    await vi.advanceTimersByTimeAsync(99);
    expect(await connect.poll("chatgpt")).toEqual({ stage: "signing_in" });
    await vi.advanceTimersByTimeAsync(1);
    expect(await connect.poll("chatgpt")).toEqual({ stage: "done" });
    expect(connect.detail("chatgpt")).toEqual({ state: "available", until: null });
    expect(connect.isConnected("chatgpt")).toBe(true);
    expect(JSON.stringify(window.__talosDemoCalls)).not.toMatch(/https?:/);
  });

  it("the default delay is 1500 ms per stage", async () => {
    const connect = new DemoAiConnect();
    await connect.start("chatgpt");
    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECT_DELAY_MS - 1);
    expect((await connect.poll("chatgpt")).stage).toBe("signing_in");
    await vi.advanceTimersByTimeAsync(1);
    expect((await connect.poll("chatgpt")).stage).toBe("done");
  });

  it("claude_fetch: fetching first, then signing_in, then the outcome", async () => {
    const connect = new DemoAiConnect({ claudeFetch: true, connectDelayMs: 50 });
    await connect.start("claude_plan");
    expect(await connect.poll("claude_plan")).toEqual({ stage: "fetching" });
    await vi.advanceTimersByTimeAsync(50);
    expect(await connect.poll("claude_plan")).toEqual({ stage: "signing_in" });
    await vi.advanceTimersByTimeAsync(50);
    expect(await connect.poll("claude_plan")).toEqual({ stage: "done" });
    // ChatGPT never fetches.
    const chatgpt = new DemoAiConnect({ claudeFetch: true, connectDelayMs: 50 });
    await chatgpt.start("chatgpt");
    expect(await chatgpt.poll("chatgpt")).toEqual({ stage: "signing_in" });
  });

  it("fetch_failed ends the fetching stage; the other outcomes end the sign-in stage", async () => {
    const fetchFailed = new DemoAiConnect({ claudeFetch: true, connect: "fetch_failed", connectDelayMs: 10 });
    await fetchFailed.start("claude_plan");
    await vi.advanceTimersByTimeAsync(10);
    expect(await fetchFailed.poll("claude_plan")).toEqual({ stage: "failed", outcome: "fetch_failed" });
    expect(fetchFailed.detail("claude_plan").state).toBe("not_connected");

    const cases = [
      ["closed", "closed", "not_connected"],
      ["plan_not_eligible", "plan_not_eligible", "plan_not_eligible"],
      ["unavailable", "provider_unavailable", "provider_unavailable"],
      ["timeout", "timeout", "not_connected"],
    ] as const;
    for (const [outcome, failed, state] of cases) {
      const connect = new DemoAiConnect({ connect: outcome, connectDelayMs: 10 });
      await connect.start("chatgpt");
      await vi.advanceTimersByTimeAsync(10);
      expect(await connect.poll("chatgpt"), outcome).toEqual({ stage: "failed", outcome: failed });
      expect(connect.detail("chatgpt").state, outcome).toBe(state);
      expect(connect.isConnected("chatgpt")).toBe(false);
    }
  });

  it("cancel records the call, ends as closed and stops the timers", async () => {
    const connect = new DemoAiConnect({ connectDelayMs: 100 });
    await connect.start("claude_plan");
    await connect.cancel("claude_plan");
    expect(window.__talosDemoCalls).toEqual([
      { kind: "aiConnectStart", arg: "claude_plan" },
      { kind: "aiConnectCancel", arg: "claude_plan" },
    ]);
    expect(await connect.poll("claude_plan")).toEqual({ stage: "failed", outcome: "closed" });
    expect(connect.detail("claude_plan").state).toBe("not_connected");
    await vi.advanceTimersByTimeAsync(500);
    expect(await connect.poll("claude_plan")).toEqual({ stage: "failed", outcome: "closed" });
    // A cancel for an idle provider is a no-op.
    await connect.cancel("chatgpt");
    expect(await connect.poll("chatgpt")).toEqual({ stage: "idle" });
  });

  it("refuses a second start while one runs, and allows one after it ends", async () => {
    const connect = new DemoAiConnect({ connectDelayMs: 10 });
    await connect.start("chatgpt");
    await expect(connect.start("claude_plan")).rejects.toThrow("busy");
    await vi.advanceTimersByTimeAsync(10);
    await expect(connect.start("claude_plan")).resolves.toEqual({ stage: "signing_in" });
  });

  it("disconnect records the call, drops the connected flag and reads not_connected", async () => {
    const connect = new DemoAiConnect({ provider: "chatgpt", ai: "available" });
    expect(connect.isConnected("chatgpt")).toBe(true);
    await connect.disconnect("chatgpt");
    expect(window.__talosDemoCalls).toEqual([{ kind: "aiDisconnect", arg: "chatgpt" }]);
    expect(connect.isConnected("chatgpt")).toBe(false);
    expect(connect.detail("chatgpt")).toEqual({ state: "not_connected", until: null });
    expect(await connect.poll("chatgpt")).toEqual({ stage: "idle" });
    // Connecting again works.
    await connect.start("chatgpt");
    await vi.advanceTimersByTimeAsync(DEFAULT_CONNECT_DELAY_MS);
    expect(connect.isConnected("chatgpt")).toBe(true);
  });
});
