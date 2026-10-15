import { useState } from "react";
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
import { hiddenBySocketTable } from "../app/network-checks";
import { lastReport } from "../scan/machine";
import type { ExplainState } from "../scan/machine";

type SeverityFilter = Severity | "all";
type CategoryFilter = Category | "all";

function bySeverity(a: Finding, b: Finding): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}

export function Findings() {
  const { scan, router, catalog, gate, settings } = useApp();
  const report = lastReport(scan.scan);
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");

  if (report === null) {
    return (
      <main className="screen findings">
        <h1>Findings</h1>
        <p className="lead">Run a check-up to see findings.</p>
      </main>
    );
  }

  const live = scan.scan.kind === "ready";
  const explain: ExplainState = scan.scan.kind === "ready" ? scan.scan.explain : { kind: "off" };
  const order = explain.kind === "ready" || explain.kind === "failed" ? explain.order : null;
  const rankOf = new Map<RuleId, number>();
  if (order !== null) order.forEach((id, index) => rankOf.set(id, index + 1));

  const keep = (f: { severity: Severity; category: Category }) =>
    (severity === "all" || f.severity === severity) && (category === "all" || f.category === category);

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

  const open = (ruleId: RuleId) => router.navigate({ name: "finding", ruleId });
  const reasonFor = (finding: Finding) => (hiddenBySocketTable(report, finding) ? SOCKET_TABLE_LABEL : undefined);
  const suggested = order === null ? [] : order.map((id) => report.findings.find((f) => f.ruleId === id)).filter((f): f is Finding => f !== undefined);
  const aiOn = settings.explainer.provider !== "none";
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
          <Group title="Needs fixing" empty="Nothing needs fixing." findings={needsFixing} rankOf={rankOf} reasonFor={reasonFor} onOpen={open} />
          <Group title="Worth a look" empty="Nothing to look at." findings={worthALook} rankOf={rankOf} reasonFor={reasonFor} onOpen={open} />
          <Group title="Couldn't check" empty="Everything could be checked." findings={couldntCheck} rankOf={rankOf} reasonFor={reasonFor} onOpen={open} />

          <section aria-labelledby="group-passed">
            <h2 id="group-passed">Passed</h2>
            {passed.length === 0 ? (
              <p className="muted">No passing checks match the filters.</p>
            ) : (
              <ul className="passed-list">
                {passed.map((rule) => (
                  <li key={rule.id}>
                    <button type="button" className="link-button" onClick={() => open(rule.id)}>
                      <SeverityBadge severity={rule.severity} /> {rule.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {notApplicable > 0 && (
              <p className="muted small">
                {notApplicable} {notApplicable === 1 ? "check does" : "checks do"} not apply to this Mac.
              </p>
            )}
          </section>
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

  return (
    <aside className="card findings-aside" aria-labelledby="suggested">
      <h2 id="suggested">Suggested order</h2>
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
                <button type="button" className="link-button" onClick={() => onOpen(finding.ruleId)}>
                  {finding.title}
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : working ? (
        <p className="muted" aria-live="polite">
          Working out an order for you.
        </p>
      ) : !live ? (
        <p className="muted">Run a fresh check-up to ask the AI which items to tackle first.</p>
      ) : (
        <div>
          <p className="muted small">The AI can suggest which items to tackle first, based on how you use this Mac.</p>
          {failure !== null && <p className="notice">{EXPLAINER_FAILURE_LABELS[failure]}</p>}
          <button type="button" className="button" onClick={onPrioritise} disabled={busy}>
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
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>
        {title} <span className="muted count-inline">{findings.length}</span>
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
