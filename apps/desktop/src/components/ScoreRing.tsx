import type { Grade } from "@talos/core";
import { GRADE_LABELS } from "../app/labels";

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreRing({ value, grade, size = 160 }: { value: number; grade: Grade; size?: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);
  const label = `Score ${clamped} out of 100, ${GRADE_LABELS[grade]}`;
  return (
    <svg
      className={`score-ring grade-${grade}`}
      width={size}
      height={size}
      viewBox="0 0 128 128"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <circle className="score-ring-track" cx="64" cy="64" r={RADIUS} fill="none" strokeWidth="10" />
      <circle
        className="score-ring-value"
        cx="64"
        cy="64"
        r={RADIUS}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 64 64)"
      />
      <text className="score-ring-number" x="64" y="60" textAnchor="middle" dominantBaseline="central">
        {clamped}
      </text>
      <text className="score-ring-grade" x="64" y="84" textAnchor="middle" dominantBaseline="central">
        {GRADE_LABELS[grade]}
      </text>
    </svg>
  );
}
