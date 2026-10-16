import type { GuidedPlan, NextAction, RuleId } from "@talos/core";
import { MACOS_CATALOG, nextAction } from "@talos/core";
import { useApp } from "../app/context";
import { ICONS } from "../app/icons";
import type { IconComponent } from "../app/icons";
import { Icon } from "../components/Icon";
import { lastReport } from "../scan/machine";
import { useGuidedHero } from "./GuidedShell";
import { StepFrame } from "./StepFrame";
import { END, NEXT } from "./copy";
import { guidedFor } from "./plan";

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

/** The rules still failing that were steps the person moved past: snoozed, waiting, or converted and left. */
export function stillWaiting(plan: GuidedPlan): readonly RuleId[] {
  return plan.later;
}

/** The sentence under the headline: the biggest risk left, a high rule's headline, or the calm line. */
export function urgencyLine(next: NextAction | null): string {
  if (next === null) return END.nextTime;
  const headline = guidedFor(next.ruleId).headline;
  if (next.severity === "critical") return `${headline}. ${END.biggestRisk}`;
  if (next.severity === "high") return `${headline}.`;
  return END.nextTime;
}

interface EndRow {
  readonly key: string;
  readonly text: string;
  onOpen(): void;
}

/** A label and its 44 px rows. Every row is one control that opens Details, and its name ends with that word. */
function EndGroup({ id, label, icon, rows }: { id: string; label: string; icon: IconComponent; rows: readonly EndRow[] }) {
  const labelId = `guided-end-${id}`;
  return (
    <section className="guided-end-group" aria-labelledby={labelId}>
      <h2 id={labelId} className="guided-end-label">
        {label}
      </h2>
      <ul className="guided-end-list" role="list">
        {rows.map((row) => (
          <li key={row.key}>
            <button type="button" className="guided-end-row" aria-label={`${row.text} ${END.details}`} onClick={row.onOpen}>
              <Icon icon={icon} size={20} className="guided-end-row-icon" />
              <span className="guided-end-row-text">{row.text}</span>
              <Icon icon={ICONS.chevronRight} size={16} className="guided-end-row-chevron" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The highlighted "Do this next" card: headline, why, and the screen's one primary button. */
function NextCard({ next, onClick }: { next: NextAction; onClick(): void }) {
  const strings = guidedFor(next.ruleId);
  const cue = next.severity === "critical" || next.severity === "high" ? ` guided-next-${next.severity}` : "";
  return (
    <section className="guided-end-group guided-next" aria-labelledby="guided-end-next">
      <h2 id="guided-end-next" className="guided-end-label">
        {END.next}
      </h2>
      <div className={`guided-next-card${cue}`}>
        <p className="guided-next-headline">{strings.headline}</p>
        <p className="guided-next-why">{strings.why}</p>
        <button type="button" className="button button-primary guided-primary" onClick={onClick}>
          {NEXT[next.kind]}
        </button>
      </div>
    </section>
  );
}

export interface EndScreenProps {
  readonly plan: GuidedPlan;
  readonly fixed: readonly RuleId[];
  onCheckAgain(): void;
  /** "Do this next" with a step to run; a "details" action opens the finding instead. */
  onNext(action: NextAction): void;
}

/** All done, partial with the grouped rows, nothing to do, or nothing read. The "Do this next" button is the one primary; "Check again" stays the link. */
export function EndScreen({ plan, fixed, onCheckAgain, onNext }: EndScreenProps) {
  const { router, scan } = useApp();
  useGuidedHero(true, true);
  const waiting = stillWaiting(plan);
  // Rules left alone or kept for a technical person are listed, but they never stop the Mac being "in good shape".
  const nothingOpen = waiting.length === 0 && plan.locked.length === 0;
  const allDone = fixed.length > 0 && nothingOpen;
  const nothing = fixed.length === 0 && nothingOpen;
  // Nothing to fix because nothing (or not everything) could be read is not "nothing needs fixing".
  const unread = nothing && plan.unreadable > 0;
  const allUnread = unread && plan.unreadable >= MACOS_CATALOG.rules.length;
  const unreadable = plan.unreadable > 0 ? `I couldn't check ${plan.unreadable === 1 ? "1 area" : `${plan.unreadable} areas`}.` : null;
  const report = lastReport(scan.scan);
  const next = report === null || unread ? null : nextAction(plan, report);
  const title = allDone ? END.allDone : unread ? (allUnread ? END.unreadableAll : END.unreadableSome) : nothing ? END.nothing : END.partial;
  const body = unread ? (
    <p>{END.tryAgain}</p>
  ) : (
    <>
      {fixed.length > 0 && !allDone && <p>{things(fixed.length)} fixed today.</p>}
      <p>{urgencyLine(next)}</p>
    </>
  );
  const findings = () => router.navigate({ name: "findings" });
  const finding = (id: RuleId) => () => router.navigate({ name: "finding", ruleId: id });
  const without = (ids: readonly RuleId[]) => ids.filter((id) => id !== next?.ruleId);
  const ruleRows = (ids: readonly RuleId[]): EndRow[] => without(ids).map((id) => ({ key: id, text: guidedFor(id).headline, onOpen: finding(id) }));
  const groups = [
    { id: "waiting", label: END.waiting, icon: ICONS.watch, rows: ruleRows(waiting) },
    { id: "locked", label: END.locked, icon: ICONS.licence, rows: ruleRows(plan.locked) },
    { id: "left-alone", label: END.leftAlone, icon: ICONS.eyeOff, rows: ruleRows(plan.leftAlone) },
    { id: "technical", label: END.technical, icon: ICONS.developer, rows: ruleRows(plan.technical) },
    { id: "unreadable", label: END.unreadable, icon: ICONS.question, rows: unreadable === null ? [] : [{ key: "unreadable", text: unreadable, onOpen: findings }] },
  ].filter((group) => group.rows.length > 0);
  const summary = next !== null || groups.length > 0;
  return (
    <StepFrame progress={null} title={title} body={body} mark={!nothing} className="guided-end" link={{ label: END.checkAgain, onClick: onCheckAgain }}>
      {summary && (
        <div className="guided-summary">
          {next !== null && <NextCard next={next} onClick={next.kind === "details" ? finding(next.ruleId) : () => onNext(next)} />}
          {groups.map((group) => (
            <EndGroup key={group.id} id={group.id} label={group.label} icon={group.icon} rows={group.rows} />
          ))}
        </div>
      )}
    </StepFrame>
  );
}
