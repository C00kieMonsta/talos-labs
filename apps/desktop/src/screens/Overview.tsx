import type { Finding, Prioritisation, RuleId, ScanReport, Severity, UnknownReason } from "@talos/core";
import { AiCard, useAiCardFlow } from "../components/AiCard";
import { FindingCard } from "../components/FindingCard";
import { choiceFor, pathChoices } from "../components/FixCard";
import { FixFlow } from "../components/FixSheet";
import { PermissionCard } from "../components/PermissionCard";
import { ScoreMeter } from "../components/ScoreMeter";
import { GRADE_SUMMARY, SEVERITY_LABELS, SOCKET_TABLE_COPY, UNKNOWN_REASON_LABELS, paneForReason } from "../app/labels";
import { useApp } from "../app/context";
import { hiddenBySocketTable } from "../app/network-checks";
import { lastReport } from "../scan/machine";
import type { PermissionKind } from "../scan/useCapabilityPoll";

const COUNTED: readonly Severity[] = ["critical", "high", "medium", "low"];

function groupByPermission(findings: readonly Finding[]): Map<PermissionKind, Finding[]> {
  const groups = new Map<PermissionKind, Finding[]>();
  for (const finding of findings) {
    const pane = paneForReason(finding.unknownReason);
    if (pane === "full_disk_access" || pane === "automation") {
      const list = groups.get(pane) ?? [];
      list.push(finding);
      groups.set(pane, list);
    }
  }
  return groups;
}

/** One entry per reason, in first-seen order, so the Overview stays a summary however many checks failed to run. */
function groupByReason(findings: readonly Finding[]): { reason: UnknownReason | null; findings: Finding[] }[] {
  const groups: { reason: UnknownReason | null; findings: Finding[] }[] = [];
  for (const finding of findings) {
    const group = groups.find((g) => g.reason === finding.unknownReason);
    if (group === undefined) groups.push({ reason: finding.unknownReason, findings: [finding] });
    else group.findings.push(finding);
  }
  return groups;
}

const NO_REASON_LABEL = "Could not be checked";

export function Overview() {
  const { scan, router, gate, adapters, settings, capabilities } = useApp();
  const report = lastReport(scan.scan);

  if (report === null) {
    return (
      <main className="screen overview">
        <h1>Overview</h1>
        <p className="lead">Run a check-up to see how your Mac is doing.</p>
        <button type="button" className="button button-primary" onClick={() => void scan.start()}>
          Run check-up
        </button>
      </main>
    );
  }

  const live = scan.scan.kind === "ready";
  const onAction = (ruleId: RuleId) => {
    const finding = report.findings.find((f) => f.ruleId === ruleId);
    if (finding === undefined) return;
    const apply = finding.fix.apply;
    if (apply.kind === "in_app" && live) {
      const choice = choiceFor(finding, pathChoices(finding.evidence)[0]?.path ?? null);
      if (choice !== null) void scan.previewFix(ruleId, choice);
      return;
    }
    if (apply.kind === "deep_link") {
      void adapters.openSettingsPane(apply.pane);
      if (live) scan.startWatch(ruleId);
      return;
    }
    router.navigate({ name: "finding", ruleId });
  };

  return (
    <>
      <OverviewBody
        report={report}
        freeFixes={gate.freeFixes}
        aiEnabled={settings.explainer.aiEnabled}
        capabilities={capabilities}
        onOpenFinding={(ruleId) => router.navigate({ name: "finding", ruleId })}
        onAction={onAction}
        onAll={() => router.navigate({ name: "findings" })}
      />
      <FixFlow />
    </>
  );
}

/** "Start with" from the model, then the rest of its order, then what it did not see in points order. */
export function SuggestedOrderBody({ report, priority, onOpen }: { report: ScanReport; priority: Prioritisation; onOpen(ruleId: RuleId): void }) {
  const headline = (id: RuleId) => report.findings.find((f) => f.ruleId === id)?.headline ?? id;
  const reason = (id: RuleId) => priority.reasons.find((r) => r.ruleId === id)?.reason ?? null;
  const startWith = priority.startWith.slice(0, 3);
  const then = priority.order.filter((id) => !startWith.includes(id));
  const seen = new Set<string>([...startWith, ...then]);
  const omitted = report.findings.filter((f) => f.status !== "unknown" && !seen.has(f.ruleId)).map((f) => f.ruleId);
  const item = (id: RuleId, withReason: boolean) => (
    <li key={id}>
      <button type="button" className="link-button" data-rule-id={id} onClick={() => onOpen(id)}>
        {headline(id)}
      </button>
      {withReason && reason(id) !== null && <p className="muted small">{reason(id)}</p>}
    </li>
  );
  return (
    <div className="ai-body suggested-order">
      {startWith.length > 0 && (
        <>
          <p className="label">Start with</p>
          <ol>{startWith.map((id) => item(id, true))}</ol>
        </>
      )}
      {then.length > 0 && (
        <>
          <p className="label">Then</p>
          <ol start={startWith.length + 1}>{then.map((id) => item(id, false))}</ol>
        </>
      )}
      {omitted.length > 0 && (
        <>
          <p className="label">Then, in points order</p>
          <ol start={startWith.length + then.length + 1}>{omitted.map((id) => item(id, false))}</ol>
        </>
      )}
    </div>
  );
}

function OverviewAiCard({ report, onOpen }: { report: ScanReport; onOpen(ruleId: RuleId): void }) {
  const flow = useAiCardFlow("prioritise");
  const priority = flow.explain.kind === "ready" || flow.explain.kind === "failed" ? flow.explain.priority : null;
  return (
    <AiCard kind="overview" state={flow.state} {...flow.handlers}>
      {priority !== null && <SuggestedOrderBody report={report} priority={priority} onOpen={onOpen} />}
    </AiCard>
  );
}

function OverviewBody({
  report,
  freeFixes,
  aiEnabled,
  capabilities,
  onOpenFinding,
  onAction,
  onAll,
}: {
  report: ScanReport;
  freeFixes: readonly string[];
  aiEnabled: boolean;
  capabilities: Parameters<typeof PermissionCard>[0]["capabilities"];
  onOpenFinding(ruleId: RuleId): void;
  onAction(ruleId: RuleId): void;
  onAll(): void;
}) {
  const failing = report.findings.filter((f) => f.status === "fail");
  const unknown = report.findings.filter((f) => f.status === "unknown");
  const permissions = groupByPermission(unknown);
  const networkHidden = unknown.filter((f) => hiddenBySocketTable(report, f));
  const otherUnknown = groupByReason(unknown.filter((f) => paneForReason(f.unknownReason) === null && !hiddenBySocketTable(report, f)));
  const nextThree = freeFixes.map((id) => failing.find((f) => f.ruleId === id)).filter((f): f is Finding => f !== undefined);
  const counts = COUNTED.map((severity) => ({ severity, count: failing.filter((f) => f.severity === severity).length }));
  const { score } = report;

  return (
    <main className="screen overview">
      {score.value === null || score.grade === null ? (
        <section className="card" aria-labelledby="no-score">
          <h2 id="no-score">Nothing could be checked</h2>
          <p>Every area was out of reach, so there is no score yet. Grant any permissions listed below, then run the check-up again.</p>
        </section>
      ) : (
        <section className="score-panel card" aria-labelledby="score-heading">
          <ScoreMeter value={score.value} grade={score.grade} cappedByCritical={score.cappedByCritical} />
          <div className="score-text">
            <h2 id="score-heading">{GRADE_SUMMARY[score.grade]}</h2>
            {!score.complete && (
              <p>
                <span className="badge badge-incomplete">Incomplete</span>{" "}
                <span className="muted">Some areas could not be checked. They are not counted, so the real score may be lower than this.</span>
              </p>
            )}
            {score.cappedByCritical && <p className="muted">A critical issue caps the score at 59 until it is fixed.</p>}
            <ul className="counts" aria-label="Issues by severity">
              {counts.map(({ severity, count }) => (
                <li key={severity} className={`count count-${severity}`}>
                  <span className="count-number">{count}</span>
                  <span className="count-label">{SEVERITY_LABELS[severity]}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {aiEnabled && score.value !== null && failing.length > 0 && <OverviewAiCard report={report} onOpen={onOpenFinding} />}

      {nextThree.length > 0 && (
        <section aria-labelledby="next-fixes">
          <div className="section-head">
            <h2 id="next-fixes">Next three fixes</h2>
            <button type="button" className="button button-ghost" onClick={onAll}>
              See everything
            </button>
          </div>
          <div className="card-grid">
            {nextThree.map((finding) => (
              <FindingCard key={finding.ruleId} finding={finding} onOpen={onOpenFinding} onAction={onAction} />
            ))}
          </div>
        </section>
      )}

      {failing.length === 0 && score.value !== null && (
        <section className="card card-good" aria-labelledby="all-good">
          <h2 id="all-good">Nothing needs fixing</h2>
          <p>Every check that could run passed. Rescan now and then to keep it that way.</p>
        </section>
      )}

      {(permissions.size > 0 || networkHidden.length > 0 || otherUnknown.length > 0) && (
        <section aria-labelledby="couldnt-check">
          <h2 id="couldnt-check">Couldn't check</h2>
          <div className="card-grid">
            {[...permissions.entries()].map(([kind, findings]) => (
              <PermissionCard key={kind} kind={kind} affected={findings.map((f) => f.title)} capabilities={capabilities} />
            ))}
            {networkHidden.length > 0 && (
              <section className="card card-muted" aria-labelledby="unsigned-build">
                <h3 id="unsigned-build">Network checks are unavailable in this build</h3>
                <p>{SOCKET_TABLE_COPY}</p>
                <p className="muted">Affects: {networkHidden.map((f) => f.title).join(", ")}</p>
              </section>
            )}
            {otherUnknown.map((group) => {
              const label = group.reason === null ? NO_REASON_LABEL : UNKNOWN_REASON_LABELS[group.reason];
              const id = `reason-${group.reason ?? "none"}`;
              const count = group.findings.length;
              return (
                <section key={id} className="card card-muted" aria-labelledby={id}>
                  <h3 id={id}>{label}</h3>
                  <p className="muted">
                    Affects {count} {count === 1 ? "check" : "checks"}: {group.findings.map((f) => f.title).join(", ")}
                  </p>
                  <button type="button" className="button button-ghost" onClick={onAll}>
                    See in Findings
                  </button>
                </section>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
