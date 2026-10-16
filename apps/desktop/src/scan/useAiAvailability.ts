import { useCallback, useEffect, useRef, useState } from "react";
import type { AiAvailability, ExplainerPort } from "@talos/core";

export const REPROBE_SETTINGS_MS = 5000;
export const REPROBE_MODEL_MS = 15_000;
export const REPROBE_MAX_MS = 600_000;

export interface AiController {
  /** null until the first AI card asked. */
  readonly availability: AiAvailability | null;
  probe(fresh?: boolean): Promise<AiAvailability>;
  /** Probes fresh every `everyMs` until available, the cap, or the returned stop function. */
  reprobe(everyMs: number, maxMs?: number): () => void;
}

/** Lazily probes the explainer's availability; the probe never runs during onboarding. */
export function useAiAvailability(createExplainer: () => Promise<ExplainerPort>): AiController {
  const [availability, setAvailability] = useState<AiAvailability | null>(null);
  const createRef = useRef(createExplainer);
  createRef.current = createExplainer;
  const inFlight = useRef<Promise<AiAvailability> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // A different explainer (provider or switch changed) invalidates what was probed.
  useEffect(() => {
    setAvailability(null);
  }, [createExplainer]);

  const probe = useCallback(async (fresh = false): Promise<AiAvailability> => {
    if (inFlight.current !== null) return inFlight.current;
    const pending = (async () => {
      try {
        const explainer = await createRef.current();
        return await explainer.availability(fresh);
      } catch {
        return "helper_unavailable" as const;
      }
    })();
    inFlight.current = pending;
    try {
      const state = await pending;
      setAvailability(state);
      return state;
    } finally {
      inFlight.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const reprobe = useCallback(
    (everyMs: number, maxMs = REPROBE_MAX_MS) => {
      stop();
      const startedAt = Date.now();
      timer.current = setInterval(() => {
        if (Date.now() - startedAt >= maxMs) {
          stop();
          return;
        }
        void probe(true).then((state) => {
          if (state === "available" || state === "device_not_eligible" || state === "off") stop();
        });
      }, everyMs);
      return stop;
    },
    [probe, stop],
  );

  useEffect(() => stop, [stop]);

  return { availability, probe, reprobe };
}
