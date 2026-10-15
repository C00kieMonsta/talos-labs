import { useState } from "react";
import type { Category, Finding, Rule, RuleId, Severity } from "@talos/core";
import { FindingCard } from "../components/FindingCard";
import { SeverityBadge } from "../components/SeverityBadge";
import { CATEGORY_LABELS, CATEGORY_ORDER, SEVERITY_LABELS, SEVERITY_ORDER } from "../app/labels";
import { useApp } from "../app/context";
import { lastReport } from "../scan/machine";

type SeverityFilter = Severity | "all";
type CategoryFilter = Category | "all";

function bySeverity(a: Finding, b: Finding): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
}

export function Findings() {
  const { scan, router, catalog } = useApp();
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

  const explain = scan.scan.kind === "ready" ? scan.scan.explain : { kind: "off" as const };
  const order = explain.kind === "ready" ? explain.order : null;
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
  const suggested = order === null ? [] : order.map((id) => report.findings.find((f) => f.ruleId === id)).filter((f): f is Finding => f !== undefined);

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

      <div className={suggested.length > 0 ? "findings-layout with-aside" : "findings-layout"}>
        <div className="findings-main">
          <Group title="Needs fixing" empty="Nothing needs fixing." findings={needsFixing} rankOf={rankOf} onOpen={open} />
          <Group title="Worth a look" empty="Nothing to look at." findings={worthALook} rankOf={rankOf} onOpen={open} />
          <Group title="Couldn't check" empty="Everything could be checked." findings={couldntCheck} rankOf={rankOf} onOpen={open} />

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

        {suggested.length > 0 && (
          <aside className="card findings-aside" aria-labelledby="suggested">
            <h2 id="suggested">Suggested order</h2>
            <p className="muted small">From the AI, not verified. The groups on the left keep the severity order.</p>
            <ol>
              {suggested.map((finding) => (
                <li key={finding.ruleId}>
                  <button type="button" className="link-button" onClick={() => open(finding.ruleId)}>
                    {finding.title}
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        )}
      </div>
    </main>
  );
}

function Group({
  title,
  empty,
  findings,
  rankOf,
  onOpen,
}: {
  title: string;
  empty: string;
  findings: readonly Finding[];
  rankOf: ReadonlyMap<RuleId, number>;
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
            return rank === undefined ? (
              <FindingCard key={finding.ruleId} finding={finding} onOpen={onOpen} />
            ) : (
              <FindingCard key={finding.ruleId} finding={finding} rank={rank} onOpen={onOpen} />
            );
          })}
        </div>
      )}
    </section>
  );
}
