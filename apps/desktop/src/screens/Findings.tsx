import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Category, Finding, Rule, RuleId, ScanReport, Severity } from "@talos/core";
import { AiCard, useAiCardFlow } from "../components/AiCard";
import { FindingCard } from "../components/FindingCard";
import { SeverityBadge } from "../components/SeverityBadge";
import { Icon } from "../components/Icon";
import { ICONS } from "../app/icons";
import { CATEGORY_LABELS, CATEGORY_ORDER, SEVERITY_LABELS, SEVERITY_ORDER, SOCKET_TABLE_LABEL } from "../app/labels";
import { useApp } from "../app/context";
import type { CategoryFilter, SeverityFilter } from "../app/router";
import { hiddenBySocketTable } from "../app/network-checks";
import { lastReport } from "../scan/machine";
import type { ExplainState } from "../scan/machine";
import { SuggestedOrderBody } from "./Overview";

/** The filter selects live in the toolbar when it offers a slot, else inline. */
function ToolbarSlot({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById("toolbar-slot"));
  }, []);
  return slot === null ? <div className="filters">{children}</div> : createPortal(children, slot);
}

function bySeverity(a: Finding, b: Finding): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}

export function Findings() {
  const { scan, router, catalog, settings, gate } = useApp();
  const report = lastReport(scan.scan);
  // The filters live on the route, so Back from a finding restores them; local state keeps the selects responsive.
  const routed = router.route.name === "findings" ? router.route : null;
  const [severity, setSeverityState] = useState<SeverityFilter>(routed?.severity ?? "all");
  const [category, setCategoryState] = useState<CategoryFilter>(routed?.category ?? "all");
  const setSeverity = (next: SeverityFilter) => {
    setSeverityState(next);
    router.replace({ name: "findings", severity: next, category });
  };
  const setCategory = (next: CategoryFilter) => {
    setCategoryState(next);
    router.replace({ name: "findings", severity, category: next });
  };

  if (report === null) {
    return (
      <div className="screen findings">
        <p className="lead">Run a check-up to see findings.</p>
        <button type="button" className="button button-primary" onClick={() => void scan.start()}>
          Run check-up
        </button>
      </div>
    );
  }

  const live = scan.scan.kind === "ready";
  const explain: ExplainState = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.explain : { kind: "off" };
  const order = explain.kind === "ready" || explain.kind === "failed" ? explain.order : null;
  const rankOf = new Map<RuleId, number>();
  if (order !== null) order.forEach((id, index) => rankOf.set(id, index + 1));

  const keep = (f: { severity: Severity; category: Category }) =>
    (severity === "all" || f.severity === severity) && (category === "all" || f.category === category);
  const filtered = severity !== "all" || category !== "all";
  const clearFilters = () => {
    setSeverityState("all");
    setCategoryState("all");
    router.replace({ name: "findings", severity: "all", category: "all" });
  };

  const findings = report.findings.filter(keep);
  const needsFixing = findings.filter((f) => f.status === "fail").sort(bySeverity);
  const worthALook = findings.filter((f) => f.status === "review");
  const couldntCheck = findings.filter((f) => f.status === "unknown").sort(bySeverity);

  const rulesById = new Map<RuleId, Rule>(catalog.rules.map((rule) => [rule.id, rule]));
  const passed = report.results
    .filter((r) => r.status === "pass")
    .map((r) => rulesById.get(r.ruleId))
    .filter((r): r is Rule => r !== undefined && keep(r));
  const notApplicable = report.results.filter((r) => r.status === "not_applicable").length;
  // A filter that excludes every check gets one message with a way out, not four empty groups.
  const nothingMatches =
    filtered && needsFixing.length === 0 && worthALook.length === 0 && couldntCheck.length === 0 && passed.length === 0;

  const open = (ruleId: RuleId) => router.navigate({ name: "finding", ruleId });
  const reasonFor = (finding: Finding) => (hiddenBySocketTable(report, finding) ? SOCKET_TABLE_LABEL : undefined);
  // The locked card lives on the Overview; here the list keeps the kit's single column until AI is unlocked.
  const showAside = settings.explainer.aiEnabled && gate.has("explainer") && (live || order !== null) && report.findings.some((f) => f.status !== "unknown");

  return (
    <div className="screen findings">
      <ToolbarSlot>
          <label>
            <span className="visually-hidden">Filter by severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as SeverityFilter)} aria-label="Severity">
              <option value="all">All severities</option>
              {SEVERITY_ORDER.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="visually-hidden">Filter by category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as CategoryFilter)} aria-label="Category">
              <option value="all">All categories</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
      </ToolbarSlot>

      <div className={showAside ? "findings-layout with-aside" : "findings-layout"}>
        <div className="findings-main">
          {nothingMatches ? (
            <p className="muted">
              Nothing matches these filters.{" "}
              <button type="button" className="link-button" onClick={clearFilters}>
                Show everything
              </button>
            </p>
          ) : (
            <>
              <Group title="Needs fixing" empty="Nothing needs fixing." findings={needsFixing} rankOf={rankOf} reasonFor={reasonFor} onOpen={open} />
              <Group title="Worth a look" empty="Nothing to look at." findings={worthALook} rankOf={rankOf} reasonFor={reasonFor} onOpen={open} />
              <Group title="Couldn't check" empty="Everything could be checked." findings={couldntCheck} rankOf={rankOf} reasonFor={reasonFor} onOpen={open} />

              <section className="card" aria-labelledby="group-passed">
                <h2 id="group-passed">Passed</h2>
                {passed.length === 0 ? (
                  <p className="muted">{filtered ? "No passing checks match the filters." : "No checks passed."}</p>
                ) : (
                  <ul className="passed-list">
                    {passed.map((rule) => (
                      <li key={rule.id}>
                        <button type="button" className="finding-row passed-row" data-rule-id={rule.id} onClick={() => open(rule.id)}>
                          <span className="finding-mark finding-mark-pass" aria-hidden="true">
                            <Icon icon={ICONS.check} />
                          </span>
                          <span className="finding-row-content">
                            <span className="passed-title">{rule.title}</span>
                          </span>
                          <span className="finding-row-trail">
                            <SeverityBadge severity={rule.severity} icon={false} />
                          </span>
                          <Icon icon={ICONS.chevronRight} className="finding-card-chevron" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
          {notApplicable > 0 && (
            <p className="muted small">
              {notApplicable} {notApplicable === 1 ? "check does" : "checks do"} not apply to this Mac.
            </p>
          )}
        </div>

        {showAside && <SuggestedOrder report={report} onOpen={open} />}
      </div>
    </div>
  );
}

function SuggestedOrder({ report, onOpen }: { report: ScanReport; onOpen(ruleId: RuleId): void }) {
  const flow = useAiCardFlow("prioritise");
  const priority = flow.explain.kind === "ready" || flow.explain.kind === "failed" ? flow.explain.priority : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const streaming = flow.state.kind === "streaming";
  const wasStreaming = useRef(false);
  // When the order the user asked for lands, read it next: focus the heading above it.
  useEffect(() => {
    if (wasStreaming.current && !streaming && priority !== null) heading.current?.focus();
    wasStreaming.current = streaming;
  }, [streaming, priority]);
  return (
    <aside className="findings-aside" aria-labelledby="suggested">
      <h2 id="suggested" ref={heading} tabIndex={-1}>
        Suggested order
      </h2>
      <AiCard kind="overview" title="Suggested order" state={flow.state} {...flow.handlers}>
        {priority !== null && <SuggestedOrderBody report={report} priority={priority} onOpen={onOpen} />}
      </AiCard>
    </aside>
  );
}

function Group({
  title,
  empty,
  findings,
  rankOf,
  reasonFor,
  onOpen,
}: {
  title: string;
  empty: string;
  findings: readonly Finding[];
  rankOf: ReadonlyMap<RuleId, number>;
  reasonFor(finding: Finding): string | undefined;
  onOpen(ruleId: RuleId): void;
}) {
  const id = `group-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  const count = findings.length;
  return (
    <section className="card" aria-labelledby={id}>
      {/* Reads as "Needs fixing, 9 items"; the visible number alone would be heard as part of the title. */}
      <h2 id={id}>
        <span className="visually-hidden">
          {title}, {count} {count === 1 ? "item" : "items"}
        </span>
        <span aria-hidden="true">
          {title} <span className="muted count-inline">{count}</span>
        </span>
      </h2>
      {findings.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="finding-rows">
          {findings.map((finding) => {
            const rank = rankOf.get(finding.ruleId);
            const reasonLabel = reasonFor(finding);
            return (
              <FindingCard
                key={finding.ruleId}
                finding={finding}
                {...(rank === undefined ? {} : { rank })}
                {...(reasonLabel === undefined ? {} : { reasonLabel })}
                onOpen={onOpen}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
