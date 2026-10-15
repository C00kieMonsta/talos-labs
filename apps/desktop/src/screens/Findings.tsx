import { useEffect, useRef, useState } from "react";
import type { Category, Finding, Rule, RuleId, Severity } from "@talos/core";
import { FindingCard } from "../components/FindingCard";
import { Lock } from "../components/Lock";
import { SeverityBadge } from "../components/SeverityBadge";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  EXPLAINER_FAILURE_LABELS,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  SOCKET_TABLE_LABEL,
} from "../app/labels";
import { useApp } from "../app/context";
import type { CategoryFilter, SeverityFilter } from "../app/router";
import { hiddenBySocketTable } from "../app/network-checks";
import { lastReport } from "../scan/machine";
import type { ExplainState } from "../scan/machine";
import { isInAppProvider } from "../settings";

function bySeverity(a: Finding, b: Finding): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}

export function Findings() {
  const { scan, router, catalog, gate, settings } = useApp();
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
      <main className="screen findings">
        <h1>Findings</h1>
        <p className="lead">Run a check-up to see findings.</p>
      </main>
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
  const suggested = order === null ? [] : order.map((id) => report.findings.find((f) => f.ruleId === id)).filter((f): f is Finding => f !== undefined);
  // The suggested order comes from the in-app explainer; the browser hand-off has no return channel.
  const aiOn = isInAppProvider(settings.explainer.provider);
  const showAside = aiOn || suggested.length > 0;

  return (
    <main className="screen findings">
      <header className="section-head">
        <h1>Findings</h1>
        <div className="filters">
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
        </div>
      </header>

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

              <section aria-labelledby="group-passed">
                <h2 id="group-passed">Passed</h2>
                {passed.length === 0 ? (
                  <p className="muted">{filtered ? "No passing checks match the filters." : "No checks passed."}</p>
                ) : (
                  <ul className="passed-list">
                    {passed.map((rule) => (
                      <li key={rule.id}>
                        <button type="button" className="link-button" data-rule-id={rule.id} onClick={() => open(rule.id)}>
                          <SeverityBadge severity={rule.severity} /> <span className="passed-title">{rule.title}</span>
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

        {showAside && (
          <SuggestedOrder
            suggested={suggested}
            explain={explain}
            live={live}
            allowed={gate.has("explainer")}
            onOpen={open}
            onPrioritise={() => void scan.prioritise()}
            onSettings={() => router.navigate({ name: "settings" })}
          />
        )}
      </div>
    </main>
  );
}

function SuggestedOrder({
  suggested,
  explain,
  live,
  allowed,
  onOpen,
  onPrioritise,
  onSettings,
}: {
  suggested: readonly Finding[];
  explain: ExplainState;
  live: boolean;
  allowed: boolean;
  onOpen(ruleId: RuleId): void;
  onPrioritise(): void;
  onSettings(): void;
}) {
  const working = explain.kind === "running" && explain.target === "prioritise";
  const busy = explain.kind === "running";
  const failure = explain.kind === "failed" && explain.target === "prioritise" ? explain.reason : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const wasWorking = useRef(false);

  // When the order the user asked for lands, read it next: focus the heading above it.
  useEffect(() => {
    if (wasWorking.current && !working && suggested.length > 0) heading.current?.focus();
    wasWorking.current = working;
  }, [working, suggested.length]);

  return (
    <aside className="card findings-aside" aria-labelledby="suggested">
      <h2 id="suggested" ref={heading} tabIndex={-1}>
        Suggested order
      </h2>
      {!allowed ? (
        <Lock
          title="An AI-suggested order is part of the full version"
          body="Enter a licence key in Settings to turn it on."
          action={
            <button type="button" className="button" onClick={onSettings}>
              Open Settings
            </button>
          }
        />
      ) : suggested.length > 0 ? (
        <>
          <p className="muted small">From the AI, not verified. The groups on the left keep the severity order.</p>
          <ol>
            {suggested.map((finding) => (
              <li key={finding.ruleId}>
                <button type="button" className="link-button" data-rule-id={finding.ruleId} onClick={() => onOpen(finding.ruleId)}>
                  {finding.headline}
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : !live ? (
        <p className="muted">Run a fresh check-up to ask the AI which items to tackle first.</p>
      ) : (
        <div>
          <p className="muted small">The AI can suggest which items to tackle first, based on how you use this Mac.</p>
          {failure !== null && (
            <p className="notice" role="alert">
              {EXPLAINER_FAILURE_LABELS[failure]}
            </p>
          )}
          <p className="muted progress-note" aria-live="polite">
            {working ? "Working out an order for you." : ""}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              if (!busy) onPrioritise();
            }}
            aria-disabled={busy}
            aria-busy={working}
          >
            Suggest an order
          </button>
        </div>
      )}
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
    <section aria-labelledby={id}>
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
        <div className="card-grid">
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
