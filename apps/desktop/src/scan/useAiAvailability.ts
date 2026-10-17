import { useCallback, useEffect, useRef, useState } from "react";
import type { AiAvailability, AiAvailabilityDetail, ExplainerPort } from "@talos/core";
import { AI_TERMINAL_STATES } from "@talos/core";

export const REPROBE_SETTINGS_MS = 5000;
export const REPROBE_MODEL_MS = 15_000;
export const REPROBE_MAX_MS = 600_000;
/** A limit with no reset time is tried again after this long; the same TTL as the Rust cache. */
export const REPROBE_LIMIT_MS = 300_000;
/** The least a limit re-probe waits, so a reset time already passed does not spin. */
export const REPROBE_LIMIT_MIN_MS = 1000;

/** How long an AI surface waits before it probes a `limit_reached` again: at `until`, or the TTL when the provider gave none. */
export function limitReprobeMs(until: string | null, now: number = Date.now()): number {
  if (until === null) return REPROBE_LIMIT_MS;
  const at = Date.parse(until);
  if (Number.isNaN(at)) return REPROBE_LIMIT_MS;
  return Math.max(REPROBE_LIMIT_MIN_MS, at - now + REPROBE_LIMIT_MIN_MS);
}

export interface AiController {
  /** null until the first AI card asked. */
  readonly availability: AiAvailability | null;
  /** ISO when limit_reached comes with a time; null otherwise. */
  readonly until: string | null;
  probe(fresh?: boolean): Promise<AiAvailability>;
  /** Probes fresh every `everyMs` until a terminal state, the cap, or the returned stop function. */
  reprobe(everyMs: number, maxMs?: number): () => void;
  /** Sets the state without a probe, until the next probe; for an action that failed before any probe could see it. */
  report(detail: AiAvailabilityDetail): void;
}

async function probeDetail(explainer: ExplainerPort, fresh: boolean): Promise<AiAvailabilityDetail> {
  if (explainer.availabilityDetail !== undefined) return explainer.availabilityDetail(fresh);
  return { state: await explainer.availability(fresh), until: null };
}

/** Lazily probes the explainer's availability; the probe never runs during onboarding. */
export function useAiAvailability(createExplainer: () => Promise<ExplainerPort>): AiController {
  const [detail, setDetail] = useState<AiAvailabilityDetail | null>(null);
  const createRef = useRef(createExplainer);
  createRef.current = createExplainer;
  const inFlight = useRef<Promise<AiAvailabilityDetail> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // A different explainer (provider or switch changed) invalidates what was probed.
  useEffect(() => {
    setDetail(null);
  }, [createExplainer]);

  const probe = useCallback(async (fresh = false): Promise<AiAvailability> => {
    const current = inFlight.current;
    if (current !== null && !fresh) return (await current).state;
    // A fresh probe never rides on a cached one: it waits for it, then asks again, so one probe is in flight at a time.
    const pending = (async (): Promise<AiAvailabilityDetail> => {
      if (current !== null) await current;
      try {
        const explainer = await createRef.current();
        return await probeDetail(explainer, fresh);
      } catch {
        return { state: "helper_unavailable", until: null };
      }
    })();
    inFlight.current = pending;
    try {
      const next = await pending;
      setDetail(next);
      return next.state;
    } finally {
      if (inFlight.current === pending) inFlight.current = null;
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
          if (AI_TERMINAL_STATES.includes(state)) stop();
        });
      }, everyMs);
      return stop;
    },
    [probe, stop],
  );

  useEffect(() => stop, [stop]);

  const report = useCallback((next: AiAvailabilityDetail) => {
    setDetail(next);
  }, []);

  return { availability: detail?.state ?? null, until: detail?.until ?? null, probe, reprobe, report };
}
