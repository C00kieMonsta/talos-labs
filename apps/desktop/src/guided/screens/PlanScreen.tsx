import type { GuidedPlan } from "@talos/core";
import { GuidedList } from "../GuidedList";
import { StepFrame } from "../StepFrame";
import { PLAN } from "../copy";
import { guidedFor, planText, ruleIdsOf } from "../plan";

/** Shown once per check-up: the counts, "Let's go" and the list behind "Show me the list". */
export function PlanScreen({ plan, listOpen, same, progress, onGo, onToggleList }: { plan: GuidedPlan; listOpen: boolean; same: boolean; progress: { done: number; of: number }; onGo(): void; onToggleList(): void }) {
  const { title, body } = planText(plan, same);
  const rows = plan.steps.flatMap((step) =>
    ruleIdsOf(step).map((id) => ({ key: `${step.id}:${id}`, text: guidedFor(id).headline, icon: "bullet" as const, tag: step.kind === "show" ? PLAN.showWhere : PLAN.doThis })),
  );
  return (
    <StepFrame progress={progress} title={title} body={body.length > 0 ? <p>{body}</p> : null} primary={{ label: PLAN.go, onClick: onGo }} link={rows.length > 0 ? { label: PLAN.list, onClick: onToggleList } : null} className="guided-plan">
      {listOpen && <GuidedList rows={rows} label="The plan" />}
    </StepFrame>
  );
}
