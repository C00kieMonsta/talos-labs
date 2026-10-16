import { useEffect, useRef, useState } from "react";
import type { Grade } from "@talos/core";
import { GRADE_LABELS } from "../app/labels";

/* The kit's score ring: 177 px, a 9 px stroke, the fill drawn from 12 o'clock clockwise. */
const SIZE = 177;
const CENTRE = SIZE / 2;
const RADIUS = 76;
const STROKE = 9;
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
export const FIRST_MS = 900;
export const LATER_MS = 600;

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** Eases a number towards its target over a duration with requestAnimationFrame; jumps when motion is reduced. */
function useAnimatedValue(target: number): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? target : 0));
  const first = useRef(true);
  const from = useRef(shown);
  useEffect(() => {
    if (reducedMotion()) {
      setShown(target);
      return;
    }
    const start = from.current;
    const duration = first.current ? FIRST_MS : LATER_MS;
    first.current = false;
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      const next = start + (target - start) * easeOut(t);
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

export function ScoreMeter({
  value,
  grade,
  cappedByCritical = false,
}: {
  value: number | null;
  grade: Grade | null;
  /** Read out with the value; the Overview shows the words under the description. */
  cappedByCritical?: boolean;
}) {
  if (value === null || grade === null) return <ScoreMeterNull />;
  return <ScoreMeterRing value={value} grade={grade} cappedByCritical={cappedByCritical} />;
}

function ScoreMeterRing({ value, grade, cappedByCritical }: { value: number; grade: Grade; cappedByCritical: boolean }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const shown = useAnimatedValue(clamped);
  const offset = CIRCUMFERENCE * (1 - shown / 100);
  const word = GRADE_LABELS[grade];
  const valueText = `${clamped} out of 100, ${word.toLowerCase()}${cappedByCritical ? ", capped by a critical issue" : ""}`;
  return (
    <div className={`score-meter grade-${grade}`}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={valueText}
        aria-label="Score"
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
          <circle className="score-meter-track" cx={CENTRE} cy={CENTRE} r={RADIUS} fill="none" strokeWidth={STROKE} />
          <circle
            className="score-meter-value"
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="butt"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
          />
        </svg>
        <div className="score-meter-centre" aria-hidden="true">
          <span className="score-meter-figure">{Math.round(shown)}</span>
          <span className="score-meter-grade">{word}</span>
        </div>
      </div>
    </div>
  );
}

function ScoreMeterNull() {
  return (
    <div className="score-meter">
      <div className="score-meter-null" role="img" aria-label="No score yet">
        <span>No score yet</span>
      </div>
    </div>
  );
}
