import type { GuidedPlan, ReportDiff } from "@talos/core";
import { GuidedList } from "./GuidedList";
import { StepFrame } from "./StepFrame";
import { SINCE } from "./copy";
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
  const rows = [
    ...diff.fixed.map((id) => ({ key: `fixed:${id}`, text: guidedFor(id).done.replace("Done. ", ""), icon: "ok" as const })),
    ...diff.appeared.map((id) => ({ key: `new:${id}`, text: guidedFor(id).headline, icon: "bullet" as const })),
  ];
  return (
    <StepFrame progress={null} title={SINCE.title} body={sinceLines(diff).map((line) => <p key={line}>{line}</p>)} primary={{ label: SINCE.carryOn, onClick: onCarryOn }} className="guided-since">
      {rows.length > 0 && <GuidedList rows={rows} />}
    </StepFrame>
  );
}
