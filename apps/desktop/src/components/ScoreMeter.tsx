import { useEffect, useRef, useState } from "react";
import type { Grade } from "@talos/core";
import { GRADE_ICONS, ICONS } from "../app/icons";
import { GRADE_LABELS } from "../app/labels";
import { Icon } from "./Icon";

const SIZE = 176;
const CENTRE = SIZE / 2;
const RADIUS = 76;
const STROKE = 12;
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Grade boundaries from packages/core/src/engine/score.ts. */
const TICKS = [40, 70, 90] as const;
const CAP = 59;
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

/** A tick across the ring at a score, as a line from just inside to just outside the stroke. */
function tick(value: number, reach: number): { x1: number; y1: number; x2: number; y2: number } {
  const angle = (value / 100) * 2 * Math.PI - Math.PI / 2;
  const inner = RADIUS - reach;
  const outer = RADIUS + reach;
  return {
    x1: CENTRE + inner * Math.cos(angle),
    y1: CENTRE + inner * Math.sin(angle),
    x2: CENTRE + outer * Math.cos(angle),
    y2: CENTRE + outer * Math.sin(angle),
  };
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
  const valueText = `${clamped} out of 100, ${word.toLowerCase()}`;
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
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
          />
          {TICKS.map((at) => (
            <line key={at} className="score-meter-tick" {...tick(at, STROKE / 2 + 2)} />
          ))}
          {cappedByCritical && <line className="score-meter-cap" data-cap="59" {...tick(CAP, STROKE / 2 + 3)} />}
        </svg>
        <div className="score-meter-centre" aria-hidden="true">
          <span className="score-meter-figure">{Math.round(shown)}</span>
          <span className="score-meter-grade">
            <Icon icon={GRADE_ICONS[grade]} />
            {word}
          </span>
        </div>
      </div>
      {cappedByCritical && <p className="score-meter-caption">Capped by a critical issue</p>}
    </div>
  );
}

function ScoreMeterNull() {
  return (
    <div className="score-meter">
      <div className="score-meter-null" role="img" aria-label="No score yet">
        <Icon icon={ICONS.question} size={20} />
        <span>No score yet</span>
      </div>
    </div>
  );
}
