import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { Grade } from "@talos/core";
import { GRADE_LABELS } from "../app/labels";
import { MOTION, motionOff, useEased } from "../app/motion";

/* The kit's score ring: 177 px, a 9 px stroke, the fill drawn from 12 o'clock clockwise. */
const SIZE = 177;
const CENTRE = SIZE / 2;
const RADIUS = 76;
const STROKE = 9;
export const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
export const FIRST_MS = MOTION.fill;
export const LATER_MS = MOTION.settle;

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
  const [replay, setReplay] = useState(0);
  const word = GRADE_LABELS[grade];
  const valueText = `${clamped} out of 100, ${word.toLowerCase()}${cappedByCritical ? ", capped by a critical issue" : ""}`;
  // A click or Enter replays the fill once; the meter's value never changes (docs/DESIGN-PLAYFUL.md 3.11).
  const restart = () => {
    if (motionOff()) return;
    setReplay((n) => n + 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") restart();
  };
  return (
    <div className={`score-meter grade-${grade}`}>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        aria-valuetext={valueText}
        aria-label="Score"
        tabIndex={0}
        onClick={restart}
        onKeyDown={onKeyDown}
      >
        <RingFill key={replay} value={clamped} word={word} />
      </div>
    </div>
  );
}

/** The ring and its centre; keyed by the replay counter so the eased value restarts from 0. */
function RingFill({ value, word }: { value: number; word: string }) {
  const shown = useEased(value);
  const offset = CIRCUMFERENCE * (1 - shown / 100);
  return (
    <>
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
    </>
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
