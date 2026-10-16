import type { GuidedPlan, RuleId } from "@talos/core";
import { useApp } from "../app/context";
import { ICONS } from "../app/icons";
import type { IconComponent } from "../app/icons";
import { Icon } from "../components/Icon";
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

interface SummaryRow {
  readonly key: string;
  readonly icon: IconComponent;
  readonly text: string;
  onOpen(): void;
}

/** A label and its rows. Every row is one control that opens Details, and its name ends with that word. */
function SummaryGroup({ id, label, rows }: { id: string; label?: string; rows: readonly SummaryRow[] }) {
  const labelId = `guided-summary-${id}`;
  return (
    <section className="guided-summary-group" aria-labelledby={label === undefined ? undefined : labelId}>
      {label !== undefined && (
        <h2 id={labelId} className="guided-summary-label">
          {label}
        </h2>
      )}
      <ul className="guided-summary-list" role="list">
        {rows.map((row) => (
          <li key={row.key}>
            <button type="button" className="guided-summary-row" aria-label={`${row.text} ${END.details}`} onClick={row.onOpen}>
              <Icon icon={row.icon} size={16} />
              <span className="guided-summary-row-text">{row.text}</span>
              <Icon icon={ICONS.chevronRight} size={16} className="guided-summary-row-chevron" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** All done, partial with the grouped rows, or nothing to do. No primary button; "Details" in the strip is the way out. */
export function EndScreen({ plan, fixed, onCheckAgain }: { plan: GuidedPlan; fixed: readonly RuleId[]; onCheckAgain(): void }) {
  const { router } = useApp();
  const waiting = stillWaiting(plan);
  // Rules left alone or kept for a technical person are listed, but they never stop the Mac being "in good shape".
  const nothingOpen = waiting.length === 0 && plan.locked.length === 0;
  const allDone = fixed.length > 0 && nothingOpen;
  const nothing = fixed.length === 0 && nothingOpen;
  const unreadable = plan.unreadable > 0 ? `I couldn't check ${plan.unreadable === 1 ? "1 area" : `${plan.unreadable} areas`}.` : null;
  const title = allDone ? END.allDone : nothing ? END.nothing : END.partial;
  const body = allDone || nothing ? <p>{END.nextTime}</p> : fixed.length > 0 ? <p>{things(fixed.length)} fixed today.</p> : null;
  const summary = waiting.length > 0 || plan.locked.length > 0 || plan.leftAlone.length > 0 || plan.technical.length > 0 || unreadable !== null;
  const finding = (id: RuleId) => () => router.navigate({ name: "finding", ruleId: id });
  const findings = () => router.navigate({ name: "findings" });
  const ruleRows = (ids: readonly RuleId[], icon: IconComponent): SummaryRow[] => ids.map((id) => ({ key: id, icon, text: guidedFor(id).headline, onOpen: finding(id) }));
  return (
    <StepFrame progress={null} title={title} body={body} mark className="guided-end" link={{ label: END.checkAgain, onClick: onCheckAgain }}>
      {summary && (
        <div className="guided-summary">
          {waiting.length > 0 && <SummaryGroup id="waiting" label={END.waiting} rows={ruleRows(waiting, ICONS.watch)} />}
          {plan.locked.length > 0 && <SummaryGroup id="locked" label={END.locked} rows={[{ key: "locked", icon: ICONS.lock, text: things(plan.locked.length), onOpen: findings }]} />}
          {plan.leftAlone.length > 0 && <SummaryGroup id="left-alone" label={END.leftAlone} rows={ruleRows(plan.leftAlone, ICONS.pause)} />}
          {plan.technical.length > 0 && <SummaryGroup id="technical" label={END.technical} rows={[{ key: "technical", icon: ICONS.terminal, text: things(plan.technical.length), onOpen: findings }]} />}
          {unreadable !== null && <SummaryGroup id="unreadable" rows={[{ key: "unreadable", icon: ICONS.info, text: unreadable, onOpen: findings }]} />}
        </div>
      )}
    </StepFrame>
  );
}
