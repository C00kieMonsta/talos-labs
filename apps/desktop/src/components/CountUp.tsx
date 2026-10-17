import { MOTION, useEased } from "../app/motion";

/** Counts up from 0 over --motion-settle, with the true figure in the accessibility tree from the first render; figures under 10 are drawn whole. */
export function CountUp({ value }: { value: number }) {
  return (
    <>
      {value >= 10 ? <Counting value={value} /> : <span aria-hidden="true">{value}</span>}
      <span className="visually-hidden">{value}</span>
    </>
  );
}

function Counting({ value }: { value: number }) {
  const shown = useEased(value, MOTION.settle, MOTION.settle);
  return <span aria-hidden="true">{Math.round(shown)}</span>;
}
