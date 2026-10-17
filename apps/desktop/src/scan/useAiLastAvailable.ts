import { useEffect, useRef } from "react";
import type { AiAvailability, GuidedMemory } from "@talos/core";
import type { ExplainerProvider } from "../settings";

/** States that mean the provider cannot answer until the person acts: the stored availability is cleared. */
const CLEARING_STATES: readonly AiAvailability[] = ["not_connected", "needs_sign_in", "plan_not_eligible", "not_offered", "off", "device_not_eligible", "apple_intelligence_not_enabled"];

export interface AiLastAvailableInput {
  readonly availability: AiAvailability | null;
  readonly provider: ExplainerProvider;
  readonly aiEnabled: boolean;
  readonly memory: GuidedMemory;
  saveMemory(memory: GuidedMemory): void;
  now?(): string;
}

/**
 * Writes memory.aiLastAvailable from every settled probe (DESIGN-CHAT section 2): set on available, cleared on the
 * states above, on AI off and on a provider change, left alone on the passing states (limit_reached,
 * provider_unavailable, connecting, model_not_ready, helper_unavailable). Disconnect reaches here as not_connected.
 */
export function useAiLastAvailable({ availability, provider, aiEnabled, memory, saveMemory, now }: AiLastAvailableInput): void {
  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  const saveRef = useRef(saveMemory);
  saveRef.current = saveMemory;
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    const stored = memoryRef.current.aiLastAvailable;
    const clear = () => {
      if (stored !== null) saveRef.current({ ...memoryRef.current, aiLastAvailable: null });
    };
    if (!aiEnabled) {
      clear();
      return;
    }
    if (stored !== null && stored.provider !== provider) {
      clear();
      return;
    }
    if (availability === null) return;
    if (availability === "available") {
      const at = nowRef.current?.() ?? new Date().toISOString();
      saveRef.current({ ...memoryRef.current, aiLastAvailable: { provider, at } });
      return;
    }
    if (CLEARING_STATES.includes(availability)) clear();
  }, [availability, provider, aiEnabled]);
}
