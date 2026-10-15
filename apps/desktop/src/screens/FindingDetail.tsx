import type { Evidence, Explanation, Finding, Rule, RuleId, RuleStatus, SettingsPane } from "@talos/core";
import { EvidenceTable } from "../components/EvidenceTable";
import { FixCard } from "../components/FixCard";
import { Lock } from "../components/Lock";
import { ModelText } from "../components/ModelText";
import { PermissionCard } from "../components/PermissionCard";
import { SeverityBadge } from "../components/SeverityBadge";
import { useApp } from "../app/context";
import {
  CATEGORY_LABELS,
  EXPLAINER_FAILURE_LABELS,
  SOCKET_TABLE_COPY,
  SOCKET_TABLE_LABEL,
  UNKNOWN_REASON_LABELS,
  URGENCY_LABELS,
  formatTime,
  paneForReason,
} from "../app/labels";
import { hiddenBySocketTable } from "../app/network-checks";
import { lastReport } from "../scan/machine";
import type { ExplainState } from "../scan/machine";

const STATUS_LABELS: Readonly<Record<RuleStatus, string>> = {
  fail: "Needs fixing",
  review: "Worth a look",
  unknown: "Couldn't check",
  pass: "Passed",
  not_applicable: "Doesn't apply to this Mac",
};

/** The authored explanation is written for a failing check; other statuses get a lead line saying so. */
const EXPLANATION_LEAD: Readonly<Record<RuleStatus, string | null>> = {
  fail: null,
  review: null,
  unknown: "This check could not run, so nothing below has been confirmed on this Mac. It describes what the check looks for.",
  pass: "This check passed. The text below describes what it guards against.",
  not_applicable: "This check does not apply to this Mac. The text below describes what it guards against.",
};

const RECHECK_RESULT: Readonly<Record<RuleStatus, string>> = {
  fail: "Still needs fixing.",
  review: "Still worth a look.",
  unknown: "Still could not be checked.",
  pass: "Now passes.",
  not_applicable: "Does not apply to this Mac.",
};

/** A finding from the report, or a passing rule rebuilt from the catalog. */
interface DetailView {
  readonly ruleId: RuleId;
  readonly title: string;
  readonly severity: Finding["severity"];
  readonly category: Finding["category"];
  readonly cis: string | null;
  readonly requires: Finding["requires"];
  readonly status: RuleStatus;
  readonly evidence: readonly Evidence[];
  readonly unknownReason: Finding["unknownReason"];
  readonly points: number;
  readonly explanation: string;
  readonly fix: Finding["fix"];
}

function fromRule(rule: Rule, status: RuleStatus, evidence: readonly Evidence[]): DetailView {
  return {
    ruleId: rule.id,
    title: rule.title,
    severity: rule.severity,
    category: rule.category,
    cis: rule.cis,
    requires: rule.requires,
    status,
    evidence,
    unknownReason: null,
    points: 0,
    explanation: rule.explanation,
    fix: rule.fix,
  };
}

export function FindingDetail({ ruleId }: { ruleId: RuleId }) {
  const { scan, router, catalog, gate, settings, adapters } = useApp();
  const report = lastReport(scan.scan);
  const finding = report?.findings.find((f) => f.ruleId === ruleId);
  const result = report?.results.find((r) => r.ruleId === ruleId);
  const rule = catalog.rules.find((r) => r.id === ruleId);

  const view: DetailView | null =
    finding !== undefined
      ? finding
      : rule !== undefined
        ? fromRule(rule, result?.status ?? "pass", result?.evidence ?? [])
        : null;

  if (view === null) {
    return (
      <main className="screen detail">
        <button type="button" className="link-button" onClick={router.back}>
          Back
        </button>
        <h1>Check not found</h1>
        <p className="muted">This check is not in the current report.</p>
      </main>
    );
  }

  const live = scan.scan.kind === "ready";
  const rechecking = scan.scan.kind === "rechecking";
  const explain: ExplainState = scan.scan.kind === "ready" ? scan.scan.explain : { kind: "off" };
  const aiOn = settings.explainer.provider !== "none";
  // The kernel withheld the socket table from this build; no permission or fix changes that.
  const unsignedBuild = report !== null && hiddenBySocketTable(report, view);
  const actionable = !unsignedBuild && (view.status === "fail" || view.status === "review" || view.status === "unknown");
  const locked = actionable && gate.fixLocked({ ruleId: view.ruleId, status: view.status });
  const permissionPane = paneForReason(view.unknownReason);
  const openPane = (pane: SettingsPane) => void adapters.openSettingsPane(pane);
  const lastRecheck = scan.scan.kind === "ready" ? scan.scan.lastRecheck : null;
  const checkedAgain = lastRecheck !== null && view.requires.includes(lastRecheck.key) ? lastRecheck : null;
  const lead = EXPLANATION_LEAD[view.status];

  return (
    <main className="screen detail">
      <button type="button" className="link-button" onClick={router.back}>
        Back
      </button>

      <header className="detail-head">
        <div className="finding-card-head">
          <span className={`status status-${view.status}`}>{STATUS_LABELS[view.status]}</span>
          <SeverityBadge severity={view.severity} />
          <span className="muted small">{CATEGORY_LABELS[view.category]}</span>
          {view.cis !== null && <span className="muted small">CIS {view.cis}</span>}
        </div>
        <h1>{view.title}</h1>
        {view.status === "unknown" && view.unknownReason !== null && (
          <p className="muted">{unsignedBuild ? SOCKET_TABLE_LABEL : UNKNOWN_REASON_LABELS[view.unknownReason]}</p>
        )}
      </header>

      {unsignedBuild && (
        <section className="card card-muted" aria-labelledby="unsigned-heading">
          <h2 id="unsigned-heading">Why this check could not run</h2>
          <p>{SOCKET_TABLE_COPY}</p>
        </section>
      )}

      {(permissionPane === "full_disk_access" || permissionPane === "automation") && (
        <PermissionCard pane={permissionPane} affected={[]} onOpen={openPane} />
      )}

      <section className="card" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">What was found</h2>
        <EvidenceTable evidence={view.evidence} />
      </section>

      <section className="card" aria-labelledby="why-heading">
        <h2 id="why-heading">Why it matters</h2>
        {lead !== null && <p className="muted">{lead}</p>}
        <p>{view.explanation}</p>
      </section>

      {aiOn && actionable && (
        <AiCard
          ruleId={view.ruleId}
          explain={explain}
          live={live}
          allowed={gate.has("explainer")}
          onExplain={() => void scan.explain(view.ruleId)}
          onSettings={() => router.navigate({ name: "settings" })}
        />
      )}

      {actionable &&
        (locked ? (
          <Lock
            title="This fix is part of the full version"
            body="The three most valuable fixes are free. A licence unlocks every fix, rechecks and AI explanations."
            action={
              <button type="button" className="button" onClick={() => router.navigate({ name: "settings" })}>
                Enter a licence key
              </button>
            }
          />
        ) : (
          <FixCard fix={view.fix} evidence={view.evidence} points={view.points} onOpenPane={openPane} />
        ))}

      {(actionable || checkedAgain !== null) && (
        <section className="card recheck" aria-labelledby="recheck-heading">
          <h2 id="recheck-heading">{actionable ? "Done it?" : "Checked again"}</h2>
          {checkedAgain !== null && (
            <p className="recheck-result" role="status">
              Checked again at {formatTime(checkedAgain.at)}. {RECHECK_RESULT[view.status]}
            </p>
          )}
          {!actionable ? null : !gate.has("recheck") ? (
            <p className="muted">Checking a single item again is part of the full version. You can always rescan from the Overview.</p>
          ) : !live && !rechecking ? (
            <p className="muted">Run a fresh check-up first, then you can check this item again on its own.</p>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={() => void scan.recheck(view.requires)}
              disabled={rechecking}
            >
              {rechecking ? "Checking again" : "I've done this, check again"}
            </button>
          )}
        </section>
      )}
    </main>
  );
}

function AiCard({
  ruleId,
  explain,
  live,
  allowed,
  onExplain,
  onSettings,
}: {
  ruleId: RuleId;
  explain: ExplainState;
  live: boolean;
  allowed: boolean;
  onExplain(): void;
  onSettings(): void;
}) {
  const explanation: Explanation | undefined =
    explain.kind === "ready" || explain.kind === "failed" ? explain.byRule[ruleId] : undefined;
  const running = explain.kind === "running" && explain.target === ruleId;
  const busy = explain.kind === "running";
  const failure = explain.kind === "failed" && explain.target === ruleId ? explain.reason : null;

  return (
    <section className="card ai-card" aria-labelledby="ai-heading">
      <div className="section-head">
        <h2 id="ai-heading">AI explanation</h2>
        <span className="badge badge-ai">AI explanation, not verified</span>
      </div>
      {!allowed ? (
        <Lock
          title="AI explanations are part of the full version"
          body="Enter a licence key in Settings to turn them on."
          action={
            <button type="button" className="button" onClick={onSettings}>
              Open Settings
            </button>
          }
        />
      ) : explanation !== undefined ? (
        <div className="ai-body">
          <p className="label">Why it matters for you</p>
          <ModelText text={explanation.whyItMattersForYou} />
          <p className="label">What could happen</p>
          <ModelText text={explanation.whatCouldHappen} />
          <p className="label">Urgency</p>
          <p>{URGENCY_LABELS[explanation.urgency]}</p>
        </div>
      ) : running ? (
        <p className="muted" aria-live="polite">
          Writing an explanation for you.
        </p>
      ) : !live ? (
        <p className="muted">Run a fresh check-up to ask for an AI explanation of this item.</p>
      ) : (
        <div>
          {failure !== null && <p className="notice">{EXPLAINER_FAILURE_LABELS[failure]}</p>}
          <button type="button" className="button" onClick={onExplain} disabled={busy}>
            Explain this for me
          </button>
        </div>
      )}
    </section>
  );
}
