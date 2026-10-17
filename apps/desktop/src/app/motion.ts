import { useEffect, useRef, useState } from "react";

/** The duration tokens of styles/tokens.css in milliseconds (docs/DESIGN-PLAYFUL.md section 2). */
export const MOTION = { fast: 150, base: 200, slow: 250, settle: 600, fill: 900, breathe: 3000 } as const;

/** True under the OS's reduce-motion setting or at demo pace 0; every JavaScript motion jumps to its end then. */
export function motionOff(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__talosDemoPace === 0) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Eases a number towards its target with requestAnimationFrame: the first run over firstMs, later changes over laterMs; jumps when motion is off.
 * Bumping `restart` runs the first fill again from 0 without a remount.
 */
export function useEased(target: number, firstMs: number = MOTION.fill, laterMs: number = MOTION.settle, restart = 0): number {
  const [shown, setShown] = useState(() => (motionOff() ? target : 0));
  const first = useRef(true);
  const from = useRef(shown);
  const lastRestart = useRef(restart);
  useEffect(() => {
    if (motionOff()) {
      setShown(target);
      return;
    }
    if (restart !== lastRestart.current) {
      lastRestart.current = restart;
      from.current = 0;
      first.current = true;
      setShown(0);
    }
    const start = from.current;
    const duration = first.current ? firstMs : laterMs;
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      // Flipped inside the frame, so StrictMode's cancelled first run keeps the first duration.
      first.current = false;
      const t = Math.min(1, (now - began) / duration);
      const next = start + (target - start) * easeOut(t);
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, firstMs, laterMs, restart]);
  return shown;
}
