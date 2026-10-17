import type { GuidedPlan, ReportDiff } from "@talos/core";
import { useWatchController } from "../watch/watch-controller";
import { GuidedList } from "./GuidedList";
import { StepFrame } from "./StepFrame";
import { FISHY, SINCE } from "./copy";
import { guidedFor } from "./plan";

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

/** Lines of the "since last time" screen, each only when its count is non-zero. */
export function sinceLines(diff: ReportDiff): string[] {
  const lines: string[] = [];
  if (diff.fixed.length > 0) lines.push(`${things(diff.fixed.length)} got fixed.`);
  if (diff.appeared.length > 0) lines.push(`${diff.appeared.length === 1 ? "1 new thing needs" : `${diff.appeared.length} new things need`} fixing.`);
  if (diff.unreadable.length > 0) lines.push(`I couldn't check ${things(diff.unreadable.length)} this time.`);
  return lines;
}

export function SinceScreen({ diff, plan, onCarryOn }: { diff: ReportDiff; plan: GuidedPlan; onCarryOn(): void }) {
  void plan;
  const { memory, saveMemory } = useWatchController();
  // The lessons-learned line: this screen is that step when the fishy flow ran (DESIGN-WATCH.md section 6).
  const lessons = memory.fishyRanAt !== null;
  const lines = lessons ? [FISHY.lessons, ...sinceLines(diff)] : sinceLines(diff);
  const carryOn = () => {
    // The line is shown once: carrying on clears the mark.
    if (lessons) saveMemory({ ...memory, fishyRanAt: null });
    onCarryOn();
  };
  const rows = [
    ...diff.fixed.map((id) => ({ key: `fixed:${id}`, text: guidedFor(id).done.replace("Done. ", ""), icon: "ok" as const })),
    ...diff.appeared.map((id) => ({ key: `new:${id}`, text: guidedFor(id).headline, icon: "bullet" as const })),
  ];
  return (
    <StepFrame progress={null} title={SINCE.title} body={lines.map((line) => <p key={line}>{line}</p>)} primary={{ label: SINCE.carryOn, onClick: carryOn }} className="guided-since">
      {rows.length > 0 && <GuidedList rows={rows} />}
    </StepFrame>
  );
}
