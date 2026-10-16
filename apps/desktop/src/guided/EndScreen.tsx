import type { GuidedPlan, RuleId } from "@talos/core";
import { useApp } from "../app/context";
import { StepFrame } from "./StepFrame";
import { END } from "./copy";
import { guidedFor } from "./plan";

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

/** The rules still failing that were steps the person moved past: snoozed, waiting, or converted and left. */
export function stillWaiting(plan: GuidedPlan): readonly RuleId[] {
  return plan.later;
}

function RuleLinks({ ids }: { ids: readonly RuleId[] }) {
  const { router } = useApp();
  return (
    <>
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 && " · "}
          <button type="button" className="guided-text-button" onClick={() => router.navigate({ name: "finding", ruleId: id })}>
            {guidedFor(id).headline}
          </button>
        </span>
      ))}
    </>
  );
}

/** All done, partial with the grouped lines, or nothing to do. No primary button; "Details" in the strip is the way out. */
export function EndScreen({ plan, fixed, onCheckAgain }: { plan: GuidedPlan; fixed: readonly RuleId[]; onCheckAgain(): void }) {
  const { router } = useApp();
  const waiting = stillWaiting(plan);
  const nothingOpen = waiting.length === 0 && plan.locked.length === 0 && plan.leftAlone.length === 0 && plan.technical.length === 0;
  const allDone = fixed.length > 0 && nothingOpen;
  const nothing = fixed.length === 0 && nothingOpen;
  const unreadable = plan.unreadable > 0 ? `I couldn't check ${plan.unreadable === 1 ? "1 area" : `${plan.unreadable} areas`}.` : null;
  const title = allDone ? END.allDone : nothing ? END.nothing : END.partial;
  return (
    <StepFrame progress={null} title={title} className="guided-end" link={{ label: END.checkAgain, onClick: onCheckAgain }}>
      <div className="guided-body guided-end-lines">
        {(allDone || nothing) && <p>{END.nextTime}</p>}
        {!allDone && !nothing && fixed.length > 0 && <p>{things(fixed.length)} fixed today.</p>}
        {waiting.length > 0 && (
          <p>
            {END.waiting}: <RuleLinks ids={waiting} />
          </p>
        )}
        {plan.locked.length > 0 && (
          <p>
            {END.locked}: {things(plan.locked.length)}
          </p>
        )}
        {plan.leftAlone.length > 0 && (
          <p>
            {END.leftAlone}: <RuleLinks ids={plan.leftAlone} />
          </p>
        )}
        {plan.technical.length > 0 && (
          <p>
            {END.technical}: {things(plan.technical.length)}
          </p>
        )}
        {unreadable !== null && (
          <p>
            {unreadable}{" "}
            <button type="button" className="guided-text-button" onClick={() => router.navigate({ name: "findings" })}>
              {END.details}
            </button>
          </p>
        )}
      </div>
    </StepFrame>
  );
}
