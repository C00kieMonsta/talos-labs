import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import type { AiAvailability, GuidedMemory } from "@talos/core";
import { EMPTY_GUIDED_MEMORY } from "@talos/core";
import type { ExplainerProvider } from "../settings";
import { useAiLastAvailable } from "./useAiLastAvailable";

afterEach(cleanup);

const NOW = "2026-10-17T10:00:00.000Z";

function mount(initial: GuidedMemory, props: { availability: AiAvailability | null; provider?: ExplainerProvider; aiEnabled?: boolean }) {
  let memory = initial;
  const saveMemory = vi.fn((next: GuidedMemory) => {
    memory = next;
  });
  const hook = renderHook(
    (p: { availability: AiAvailability | null; provider: ExplainerProvider; aiEnabled: boolean }) => useAiLastAvailable({ ...p, memory, saveMemory, now: () => NOW }),
    { initialProps: { availability: props.availability, provider: props.provider ?? "chatgpt", aiEnabled: props.aiEnabled ?? true } },
  );
  return { hook, saveMemory, memory: () => memory };
}

describe("useAiLastAvailable", () => {
  it("writes the provider and the time when a probe settles available", () => {
    const { saveMemory, memory } = mount(EMPTY_GUIDED_MEMORY, { availability: "available" });
    expect(saveMemory).toHaveBeenCalledTimes(1);
    expect(memory().aiLastAvailable).toEqual({ provider: "chatgpt", at: NOW });
  });

  it("writes nothing before the first probe and leaves a stored value alone on the passing states", () => {
    const stored: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, aiLastAvailable: { provider: "chatgpt", at: "2026-10-16T10:00:00.000Z" } };
    for (const state of [null, "limit_reached", "provider_unavailable", "connecting", "model_not_ready", "helper_unavailable"] as const) {
      const { saveMemory } = mount(stored, { availability: state });
      expect(saveMemory, String(state)).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("clears the stored value on not_connected, needs_sign_in, plan_not_eligible, not_offered and off, and never writes when nothing is stored", () => {
    const stored: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, aiLastAvailable: { provider: "chatgpt", at: "2026-10-16T10:00:00.000Z" } };
    for (const state of ["not_connected", "needs_sign_in", "plan_not_eligible", "not_offered", "off"] as const) {
      const { saveMemory, memory } = mount(stored, { availability: state });
      expect(saveMemory, state).toHaveBeenCalledTimes(1);
      expect(memory().aiLastAvailable, state).toBeNull();
      cleanup();
      const empty = mount(EMPTY_GUIDED_MEMORY, { availability: state });
      expect(empty.saveMemory, state).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("clears on AI off and on a provider change", () => {
    const stored: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, aiLastAvailable: { provider: "chatgpt", at: "2026-10-16T10:00:00.000Z" } };
    const off = mount(stored, { availability: "available", aiEnabled: false });
    expect(off.memory().aiLastAvailable).toBeNull();
    cleanup();
    const changed = mount(stored, { availability: null, provider: "claude_plan" });
    expect(changed.memory().aiLastAvailable).toBeNull();
    cleanup();
    // A provider change resets the probe to null, which clears; the new provider's first available then stores it.
    const { hook, memory } = mount(stored, { availability: "available" });
    hook.rerender({ availability: null, provider: "claude_plan", aiEnabled: true });
    expect(memory().aiLastAvailable).toBeNull();
    hook.rerender({ availability: "available", provider: "claude_plan", aiEnabled: true });
    expect(memory().aiLastAvailable).toEqual({ provider: "claude_plan", at: NOW });
  });
});
