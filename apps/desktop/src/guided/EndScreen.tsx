import type { GuidedPlan, RuleId } from "@talos/core";
import { MACOS_CATALOG } from "@talos/core";
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

interface SummaryRowProps {
  readonly label: string;
  /** The items after the label, in 13 px secondary; empty for a row that is one sentence. */
  readonly items?: string;
  onOpen(): void;
}

/** One 15 px row per group, "<label> · <items>", between hairlines. The whole row is one control that opens Details. */
function SummaryRow({ label, items, onOpen }: SummaryRowProps) {
  const name = items === undefined ? `${label} ${END.details}` : `${label} ${items} ${END.details}`;
  return (
    <button type="button" className="guided-summary-row" aria-label={name} onClick={onOpen}>
      <span>{label}</span>
      {items !== undefined && <small> · {items}</small>}
    </button>
  );
}

/** All done, partial with the grouped rows, nothing to do, or nothing read. No primary button; "Details" in the strip is the way out. */
export function EndScreen({ plan, fixed, onCheckAgain }: { plan: GuidedPlan; fixed: readonly RuleId[]; onCheckAgain(): void }) {
  const { router } = useApp();
  const waiting = stillWaiting(plan);
  // Rules left alone or kept for a technical person are listed, but they never stop the Mac being "in good shape".
  const nothingOpen = waiting.length === 0 && plan.locked.length === 0;
  const allDone = fixed.length > 0 && nothingOpen;
  const nothing = fixed.length === 0 && nothingOpen;
  // Nothing to fix because nothing (or not everything) could be read is not "nothing needs fixing".
  const unread = nothing && plan.unreadable > 0;
  const allUnread = unread && plan.unreadable >= MACOS_CATALOG.rules.length;
  const unreadable = plan.unreadable > 0 ? `I couldn't check ${plan.unreadable === 1 ? "1 area" : `${plan.unreadable} areas`}.` : null;
  const title = allDone ? END.allDone : unread ? (allUnread ? END.unreadableAll : END.unreadableSome) : nothing ? END.nothing : END.partial;
  const body = unread ? <p>{END.tryAgain}</p> : allDone || nothing ? <p>{END.nextTime}</p> : fixed.length > 0 ? <p>{things(fixed.length)} fixed today.</p> : null;
  const summary = waiting.length > 0 || plan.locked.length > 0 || plan.leftAlone.length > 0 || plan.technical.length > 0 || unreadable !== null;
  const findings = () => router.navigate({ name: "findings" });
  // One rule opens its own finding; several open the list.
  const open = (ids: readonly RuleId[]) => () => (ids.length === 1 ? router.navigate({ name: "finding", ruleId: ids[0] as RuleId }) : findings());
  const headlines = (ids: readonly RuleId[]) => ids.map((id) => guidedFor(id).headline).join(", ");
  return (
    <StepFrame progress={null} title={title} body={body} className="guided-end" link={{ label: END.checkAgain, onClick: onCheckAgain }}>
      {summary && (
        <div className="guided-summary">
          {waiting.length > 0 && <SummaryRow label={END.waiting} items={headlines(waiting)} onOpen={open(waiting)} />}
          {plan.locked.length > 0 && <SummaryRow label={END.locked} items={things(plan.locked.length)} onOpen={findings} />}
          {plan.leftAlone.length > 0 && <SummaryRow label={END.leftAlone} items={headlines(plan.leftAlone)} onOpen={open(plan.leftAlone)} />}
          {plan.technical.length > 0 && <SummaryRow label={END.technical} items={things(plan.technical.length)} onOpen={findings} />}
          {unreadable !== null && <SummaryRow label={unreadable} onOpen={findings} />}
        </div>
      )}
    </StepFrame>
  );
}
