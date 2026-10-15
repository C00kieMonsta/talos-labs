import type { Finding, ScanReport, Severity, SettingsPane, UnknownReason } from "@talos/core";
import { buildBrowserPrompt, toExplainerContext } from "@talos/core";
import { AssistantCard } from "../components/AssistantCard";
import { ScoreRing } from "../components/ScoreRing";
import { FindingCard } from "../components/FindingCard";
import { PermissionCard } from "../components/PermissionCard";
import { GRADE_SUMMARY, SEVERITY_LABELS, SOCKET_TABLE_COPY, UNKNOWN_REASON_LABELS, formatDateTime, paneForReason } from "../app/labels";
import { useApp } from "../app/context";
import { hiddenBySocketTable } from "../app/network-checks";
import { lastReport } from "../scan/machine";
import type { Assistant } from "../settings";

const COUNTED: readonly Severity[] = ["critical", "high", "medium", "low"];

function groupByPermission(findings: readonly Finding[]): Map<"full_disk_access" | "automation", Finding[]> {
  const groups = new Map<"full_disk_access" | "automation", Finding[]>();
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
  const { scan, router, gate, adapters, settings, updateSettings, catalog } = useApp();
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

  const { provider, assistant } = settings.explainer;
  // async so a throw while building the prompt surfaces as a rejection the card can show.
  const explainAll = async () => {
    const context = toExplainerContext(report, catalog, settings.profile);
    await adapters.openAssistant(assistant, buildBrowserPrompt(context, catalog));
  };

  return (
    <OverviewBody
      report={report}
      freeFixes={gate.freeFixes}
      assistant={provider === "browser" ? assistant : null}
      onRescan={() => void scan.start()}
      onOpenPane={(pane) => void adapters.openSettingsPane(pane)}
      onOpenFinding={(ruleId) => router.navigate({ name: "finding", ruleId })}
      onAll={() => router.navigate({ name: "findings" })}
      onExplainAll={explainAll}
      onSwitchAssistant={(next) => updateSettings({ explainer: { ...settings.explainer, assistant: next } })}
    />
  );
}

function OverviewBody({
  report,
  freeFixes,
  assistant,
  onRescan,
  onOpenPane,
  onOpenFinding,
  onAll,
  onExplainAll,
  onSwitchAssistant,
}: {
  report: ScanReport;
  freeFixes: readonly string[];
  /** null when the browser hand-off is not the chosen provider. */
  assistant: Assistant | null;
  onRescan(): void;
  onOpenPane(pane: SettingsPane): void;
  onOpenFinding(ruleId: Finding["ruleId"]): void;
  onAll(): void;
  onExplainAll(): Promise<void>;
  onSwitchAssistant(assistant: Assistant): void;
}) {
  const failing = report.findings.filter((f) => f.status === "fail");
  const unknown = report.findings.filter((f) => f.status === "unknown");
  const permissions = groupByPermission(unknown);
  const networkHidden = unknown.filter((f) => hiddenBySocketTable(report, f));
  const otherUnknown = groupByReason(
    unknown.filter((f) => paneForReason(f.unknownReason) === null && !hiddenBySocketTable(report, f)),
  );
  const nextThree = freeFixes
    .map((id) => failing.find((f) => f.ruleId === id))
    .filter((f): f is Finding => f !== undefined);
  const counts = COUNTED.map((severity) => ({
    severity,
    count: failing.filter((f) => f.severity === severity).length,
  }));
  const { score } = report;

  return (
    <main className="screen overview">
      <header className="overview-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">Last check-up {formatDateTime(report.scannedAt)}</p>
        </div>
        <button type="button" className="button" onClick={onRescan}>
          Rescan
        </button>
      </header>

      {score.value === null || score.grade === null ? (
        <section className="card" aria-labelledby="no-score">
          <h2 id="no-score">Nothing could be checked</h2>
          <p>
            Every area was out of reach, so there is no score yet. Grant any permissions listed below, then run the
            check-up again.
          </p>
        </section>
      ) : (
        <section className="score-panel card" aria-labelledby="score-heading">
          <ScoreRing value={score.value} grade={score.grade} />
          <div className="score-text">
            <h2 id="score-heading">{GRADE_SUMMARY[score.grade]}</h2>
            {!score.complete && (
              <p>
                <span className="badge badge-incomplete">Incomplete</span>{" "}
                <span className="muted">Some areas could not be checked. They are not counted, so the real score may be lower than this.</span>
              </p>
            )}
            {score.cappedByCritical && (
              <p className="muted">A critical issue caps the score at 59 until it is fixed.</p>
            )}
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

      {assistant !== null && score.value !== null && (
        <AssistantCard assistant={assistant} target="results" onOpen={onExplainAll} onSwitch={onSwitchAssistant} />
      )}

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
              <FindingCard key={finding.ruleId} finding={finding} onOpen={onOpenFinding} />
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
            {[...permissions.entries()].map(([pane, findings]) => (
              <PermissionCard
                key={pane}
                pane={pane}
                affected={findings.map((f) => f.title)}
                onOpen={onOpenPane}
              />
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
