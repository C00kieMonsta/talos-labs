import type { Finding, Prioritisation, RuleId, ScanReport, UnknownReason } from "@talos/core";
import { AiCard, useAiCardFlow } from "../components/AiCard";
import { FindingCard } from "../components/FindingCard";
import { FixFlow } from "../components/FixSheet";
import { PermissionCard } from "../components/PermissionCard";
import { ScoreMeter } from "../components/ScoreMeter";
import { Icon } from "../components/Icon";
import { ICONS } from "../app/icons";
import { GRADE_SUMMARY, SOCKET_TABLE_COPY, UNKNOWN_REASON_LABELS, paneForReason } from "../app/labels";
import { useApp } from "../app/context";
import { hiddenBySocketTable } from "../app/network-checks";
import { lastReport } from "../scan/machine";
import type { PermissionKind } from "../scan/useCapabilityPoll";

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

export const INCOMPLETE_SCORE_NOTE = "Some areas could not be checked. They are not counted, so the real score may be lower than this.";
export const CAPPED_SCORE_NOTE = "A critical issue caps the score at 59 until it is fixed.";

/** The explanation behind the one-line status, as the line's title. */
export function scoreStatusTitle(complete: boolean, cappedByCritical: boolean): string {
  return [complete ? null : INCOMPLETE_SCORE_NOTE, cappedByCritical ? CAPPED_SCORE_NOTE : null].filter((s) => s !== null).join(" ");
}

/** "Affects 7 checks", or the one title when a single check is affected. */
export function affectsLine(titles: readonly string[]): string {
  if (titles.length === 1) return `Affects 1 check: ${titles[0]}`;
  return `Affects ${titles.length} checks`;
}

export function Overview() {
  const { scan, router, gate, settings, capabilities } = useApp();
  const report = lastReport(scan.scan);

  if (report === null) {
    return (
      <div className="screen overview">
        <p className="lead">Run a check-up to see how your Mac is doing.</p>
        <button type="button" className="button button-primary" onClick={() => void scan.start()}>
          Run check-up
        </button>
      </div>
    );
  }

  return (
    <>
      <OverviewBody
        report={report}
        freeFixes={gate.freeFixes}
        aiEnabled={settings.explainer.aiEnabled}
        capabilities={capabilities}
        onOpenFinding={(ruleId) => router.navigate({ name: "finding", ruleId })}
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
  // Each entry is one row: the rank in the mark, the headline, the model's reason under it, a chevron.
  const item = (id: RuleId, position: number, withReason: boolean) => (
    <li key={id}>
      <button type="button" className="finding-row suggested-row" data-rule-id={id} onClick={() => onOpen(id)}>
        <span className="finding-mark" aria-hidden="true">
          {position}
        </span>
        <span className="finding-row-content">
          <span className="finding-row-title">{headline(id)}</span>
          {withReason && reason(id) !== null && <span className="finding-row-meta">{reason(id)}</span>}
        </span>
        <Icon icon={ICONS.chevronRight} className="finding-card-chevron" />
      </button>
    </li>
  );
  return (
    <div className="ai-body suggested-order">
      {startWith.length > 0 && (
        <>
          <p className="label-overline">Start with</p>
          <ol>{startWith.map((id, index) => item(id, index + 1, true))}</ol>
        </>
      )}
      {then.length > 0 && (
        <>
          <p className="label-overline">Then</p>
          <ol start={startWith.length + 1}>{then.map((id, index) => item(id, startWith.length + index + 1, false))}</ol>
        </>
      )}
      {omitted.length > 0 && (
        <>
          <p className="label-overline">Then, in points order</p>
          <ol start={startWith.length + then.length + 1}>
            {omitted.map((id, index) => item(id, startWith.length + then.length + index + 1, false))}
          </ol>
        </>
      )}
    </div>
  );
}

function OverviewAiCard({ report, onOpen }: { report: ScanReport; onOpen(ruleId: RuleId): void }) {
  const flow = useAiCardFlow("prioritise");
  const priority = flow.explain.kind === "ready" || flow.explain.kind === "failed" ? flow.explain.priority : null;
  return (
    <AiCard kind="overview" state={flow.state} provider={flow.provider} {...flow.handlers}>
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
  onAll,
}: {
  report: ScanReport;
  freeFixes: readonly string[];
  aiEnabled: boolean;
  capabilities: Parameters<typeof PermissionCard>[0]["capabilities"];
  onOpenFinding(ruleId: RuleId): void;
  onAll(): void;
}) {
  const failing = report.findings.filter((f) => f.status === "fail");
  const unknown = report.findings.filter((f) => f.status === "unknown");
  const permissions = groupByPermission(unknown);
  const networkHidden = unknown.filter((f) => hiddenBySocketTable(report, f));
  const otherUnknown = groupByReason(unknown.filter((f) => paneForReason(f.unknownReason) === null && !hiddenBySocketTable(report, f)));
  const nextThree = freeFixes.map((id) => failing.find((f) => f.ruleId === id)).filter((f): f is Finding => f !== undefined);
  const review = report.findings.filter((f) => f.status === "review");
  const tiles = [
    { label: "Needs fixing", count: failing.length },
    { label: "Worth a look", count: review.length },
    { label: "Couldn't check", count: unknown.length },
  ];
  const { score } = report;

  return (
    <div className="screen overview">
      <div className="expert-grid">
        {score.value === null || score.grade === null ? (
          <section className="card score-card" aria-labelledby="no-score">
            <h2 id="no-score">Nothing could be checked</h2>
            <p>Every area was out of reach, so there is no score yet. Grant any permissions listed below, then run the check-up again.</p>
          </section>
        ) : (
          <section className="card score-card" aria-labelledby="score-heading">
            <ScoreMeter value={score.value} grade={score.grade} cappedByCritical={score.cappedByCritical} />
            <h2 id="score-heading" className="score-description">
              {GRADE_SUMMARY[score.grade]}
            </h2>
            {(!score.complete || score.cappedByCritical) && (
              <p className="fine-print score-fine-print score-status" title={scoreStatusTitle(score.complete, score.cappedByCritical)}>
                {!score.complete && <span>Incomplete</span>}
                {!score.complete && score.cappedByCritical && <span aria-hidden="true"> · </span>}
                {score.cappedByCritical && <span>{score.complete ? "Capped by a critical issue" : "capped by a critical issue"}</span>}
              </p>
            )}
            <ul className="grid-stats" aria-label="Checks by status">
              {tiles.map(({ label, count }) => (
                <li key={label}>
                  <b>{count}</b>
                  <small>{label}</small>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="expert-column">
          {nextThree.length > 0 && (
            <section className="card" aria-labelledby="next-fixes">
              <div className="section-head">
                <h2 id="next-fixes">Next three fixes</h2>
                <button type="button" className="toolbar-button" onClick={onAll}>
                  See everything
                </button>
              </div>
              <div className="finding-rows">
                {nextThree.map((finding) => (
                  <FindingCard key={finding.ruleId} finding={finding} onOpen={onOpenFinding} />
                ))}
              </div>
            </section>
          )}

          {aiEnabled && score.value !== null && failing.length > 0 && <OverviewAiCard report={report} onOpen={onOpenFinding} />}

          {failing.length === 0 && score.value !== null && (
            <section className="card card-good" aria-labelledby="all-good">
              <h2 id="all-good">Nothing needs fixing</h2>
              <p>Every check that could run passed. Rescan now and then to keep it that way.</p>
            </section>
          )}

          {(permissions.size > 0 || networkHidden.length > 0 || otherUnknown.length > 0) && (
            <section className="card couldnt-check" aria-labelledby="couldnt-check">
              <h2 id="couldnt-check">Couldn't check</h2>
              <div className="card-grid">
                {[...permissions.entries()].map(([kind, findings]) => (
                  <PermissionCard key={kind} kind={kind} affected={findings.map((f) => f.title)} capabilities={capabilities} />
                ))}
                {networkHidden.length > 0 && (
                  <section className="card card-muted" aria-labelledby="unsigned-build">
                    <h3 id="unsigned-build">Network checks are unavailable in this build</h3>
                    <p>{SOCKET_TABLE_COPY}</p>
                    <p className="muted">{affectsLine(networkHidden.map((f) => f.title))}</p>
                  </section>
                )}
                {otherUnknown.map((group) => {
                  const label = group.reason === null ? NO_REASON_LABEL : UNKNOWN_REASON_LABELS[group.reason];
                  const id = `reason-${group.reason ?? "none"}`;
                  return (
                    <section key={id} className="card card-muted" aria-labelledby={id}>
                      <h3 id={id}>{label}</h3>
                      <p className="muted">{affectsLine(group.findings.map((f) => f.title))}</p>
                      <button type="button" className="toolbar-button" onClick={onAll}>
                        See in Findings
                      </button>
                    </section>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
