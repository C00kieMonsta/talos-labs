import { useEffect, useRef } from "react";
import type { Evidence, Explanation, Finding, Rule, RuleId, RuleStatus, SettingsPane } from "@talos/core";
import { AiCard, useAiCardFlow } from "../components/AiCard";
import { EvidenceTable } from "../components/EvidenceTable";
import { FixCard } from "../components/FixCard";
import { FixFlow } from "../components/FixSheet";
import { LicenceField } from "../components/LicenceField";
import { Lock } from "../components/Lock";
import { ModelText } from "../components/ModelText";
import { PermissionCard } from "../components/PermissionCard";
import { SeverityBadge } from "../components/SeverityBadge";
import { Icon } from "../components/Icon";
import { useApp } from "../app/context";
import { ICONS } from "../app/icons";
import {
  CATEGORY_LABELS,
  SOCKET_TABLE_COPY,
  SOCKET_TABLE_LABEL,
  UNKNOWN_REASON_LABELS,
  URGENCY_LABELS,
  formatTime,
  paneForReason,
} from "../app/labels";
import { hiddenBySocketTable } from "../app/network-checks";
import { lastReport } from "../scan/machine";

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
  /** The check as a positive statement, e.g. "Your disk is encrypted". */
  readonly title: string;
  /** Status-aware heading. Equals title for a passing rule. */
  readonly headline: string;
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
    headline: rule.title,
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
  const { scan, catalog, gate, settings, adapters, capabilities } = useApp();
  const report = lastReport(scan.scan);
  const finding = report?.findings.find((f) => f.ruleId === ruleId);
  const result = report?.results.find((r) => r.ruleId === ruleId);
  const rule = catalog.rules.find((r) => r.id === ruleId);

  const view: DetailView | null =
    finding !== undefined ? finding : rule !== undefined ? fromRule(rule, result?.status ?? "pass", result?.evidence ?? []) : null;

  if (view === null) {
    return (
      <main className="screen detail">
        <h1>Check not found</h1>
        <p className="muted">This check is not in the current report.</p>
      </main>
    );
  }

  const live = scan.scan.kind === "ready";
  const rechecking = scan.scan.kind === "rechecking";
  // The kernel withheld the socket table from this build; no permission or fix changes that.
  const unsignedBuild = report !== null && hiddenBySocketTable(report, view);
  // A fix is only shown for a confirmed problem; an unknown check has nothing confirmed to fix yet.
  const fixable = !unsignedBuild && (view.status === "fail" || view.status === "review");
  const actionable = fixable || (!unsignedBuild && view.status === "unknown");
  const locked = fixable && gate.fixLocked({ ruleId: view.ruleId, status: view.status });
  const permissionPane = paneForReason(view.unknownReason);
  const openPane = (pane: SettingsPane) => void adapters.openSettingsPane(pane);
  const lastRecheck = scan.scan.kind === "ready" ? scan.scan.lastRecheck : null;
  const checkedAgain = lastRecheck !== null && view.requires.includes(lastRecheck.key) ? lastRecheck : null;
  const lead = EXPLANATION_LEAD[view.status];
  const fixing = scan.scan.kind === "ready" && scan.scan.fixing?.plan.ruleId === view.ruleId ? scan.scan.fixing : null;
  const watching = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.watching : null;
  const busy = scan.scan.kind === "ready" && scan.scan.fixing !== null && fixing === null;
  // The rule has left the report once it passes; the strip still says so, with the time of the read.
  const passedAt =
    watching?.ruleId === view.ruleId && watching.passedAt !== null
      ? watching.passedAt
      : fixing?.phase === "done" && fixing.result === "pass"
        ? report?.scannedAt ?? null
        : null;

  return (
    <main className="screen detail">
      <header className="detail-head">
        <div className="finding-card-head">
          <span className={`status status-${view.status}`}>{STATUS_LABELS[view.status]}</span>
          <SeverityBadge severity={view.severity} />
          <span className="muted small">{CATEGORY_LABELS[view.category]}</span>
          {view.cis !== null && <span className="muted small">CIS {view.cis}</span>}
        </div>
        <h1>{view.headline}</h1>
        {view.headline !== view.title && (
          <p className="muted detail-check">
            What we check: {view.title}. Result: {STATUS_LABELS[view.status]}.
          </p>
        )}
        {view.status === "unknown" && view.unknownReason !== null && (
          <p className="muted">{unsignedBuild ? SOCKET_TABLE_LABEL : UNKNOWN_REASON_LABELS[view.unknownReason]}</p>
        )}
      </header>

      {(permissionPane === "full_disk_access" || permissionPane === "automation") && view.status === "unknown" && (
        <PermissionCard kind={permissionPane} affected={[]} capabilities={capabilities} />
      )}

      {unsignedBuild && (
        <section className="card card-muted" aria-labelledby="unsigned-heading">
          <h2 id="unsigned-heading">Why this check could not run</h2>
          <p>{SOCKET_TABLE_COPY}</p>
        </section>
      )}

      {!fixable && passedAt !== null && <PassedStrip at={passedAt} />}

      {fixable &&
        (locked ? (
          <Lock
            title="This fix is part of the full version"
            body="The three most valuable fixes are free. A licence unlocks every fix, rechecks and AI explanations."
            action={<LicenceField onBuy={() => void adapters.fixes.openBuyPage()} />}
          />
        ) : (
          <FixCard
            finding={finding ?? { ...view, status: view.status === "review" ? "review" : "fail" }}
            developer={settings.developer}
            fixing={fixing}
            watching={watching}
            busy={busy || !live}
            onApply={(choice) => void scan.previewFix(view.ruleId, choice)}
            onOpenPane={(pane) => {
              openPane(pane);
              if (live) scan.startWatch(view.ruleId);
            }}
            onReveal={(choice) => void scan.reveal(view.ruleId, choice)}
            onWatch={() => scan.startWatch(view.ruleId)}
          />
        ))}

      <section className="card" aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">What was found</h2>
        <EvidenceTable evidence={view.evidence} />
      </section>

      <section className="card" aria-labelledby="why-heading">
        <h2 id="why-heading">Why it matters</h2>
        {lead !== null && <p className="muted">{lead}</p>}
        <p>{view.explanation}</p>
      </section>

      {settings.explainer.aiEnabled && actionable && (live || rechecking) && <FindingAiCard ruleId={view.ruleId} />}

      {(actionable || checkedAgain !== null) && (
        <RecheckCard
          status={view.status}
          actionable={actionable}
          allowed={gate.has("recheck")}
          live={live}
          rechecking={rechecking}
          checkedAgain={checkedAgain}
          onRecheck={() => void scan.recheck(view.requires)}
        />
      )}
      <FixFlow />
    </main>
  );
}

/** "Now passes, checked at 20:41" for a rule the watcher or a fix saw through; focus moves to it. */
function PassedStrip({ at }: { at: string }) {
  const strip = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    strip.current?.focus();
  }, []);
  return (
    <p ref={strip} tabIndex={-1} role="status" className="status-strip status-strip-passed">
      <Icon icon={ICONS.check} /> Now passes, checked at {formatTime(at)}
    </p>
  );
}

function RecheckCard({
  status,
  actionable,
  allowed,
  live,
  rechecking,
  checkedAgain,
  onRecheck,
}: {
  status: RuleStatus;
  actionable: boolean;
  allowed: boolean;
  live: boolean;
  rechecking: boolean;
  checkedAgain: { readonly at: string } | null;
  onRecheck(): void;
}) {
  const unknown = status === "unknown";
  const result = useRef<HTMLParagraphElement>(null);
  const resultAt = checkedAgain?.at ?? null;
  const previousAt = useRef(resultAt);

  // A fresh result that unmounted the button, or left focus on the document, is read next.
  useEffect(() => {
    if (resultAt === previousAt.current) return;
    previousAt.current = resultAt;
    if (resultAt === null) return;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) result.current?.focus();
  }, [resultAt]);

  return (
    <section className="card recheck" aria-labelledby="recheck-heading">
      <h2 id="recheck-heading">{!actionable ? "Checked again" : unknown ? "Check again" : "Done it?"}</h2>
      {actionable && unknown && <p className="muted">Once the reason above has been dealt with, check this item again on its own.</p>}
      <p className="recheck-result progress-note" role="status" ref={result} tabIndex={-1}>
        {checkedAgain === null ? "" : `Checked again at ${formatTime(checkedAgain.at)}. ${RECHECK_RESULT[status]}`}
      </p>
      {!actionable ? null : !allowed ? (
        <p className="muted">Checking a single item again is part of the full version. You can always rescan from the Overview.</p>
      ) : !live && !rechecking ? (
        <p className="muted">Run a fresh check-up first, then you can check this item again on its own.</p>
      ) : (
        <button
          type="button"
          className="button button-primary"
          onClick={() => {
            if (!rechecking) onRecheck();
          }}
          aria-disabled={rechecking}
          aria-busy={rechecking}
        >
          {rechecking ? "Checking again" : unknown ? "Check this item again" : "I've done this, check again"}
        </button>
      )}
    </section>
  );
}

/** The explanation lands field by field; a partial is shown with a caret until the whole answer is validated. */
export function ExplanationFields({ explanation, streaming }: { explanation: Partial<Explanation>; streaming: boolean }) {
  const why = explanation.whyItMattersForYou;
  const what = explanation.whatCouldHappen;
  const urgency = explanation.urgency;
  const caretOn = (field: "why" | "what") =>
    streaming && (field === "why" ? what === undefined && urgency === undefined : urgency === undefined);
  return (
    <div className="ai-body">
      {why !== undefined && (
        <>
          <p className="label">Why it matters for you</p>
          <ModelText text={why} caret={caretOn("why")} />
        </>
      )}
      {what !== undefined && (
        <>
          <p className="label">What could happen</p>
          <ModelText text={what} caret={caretOn("what")} />
        </>
      )}
      {urgency !== undefined && URGENCY_LABELS[urgency] !== undefined && (
        <>
          <p className="label">Urgency</p>
          <p>
            <span className={`pill urgency-${urgency}`}>{URGENCY_LABELS[urgency]}</span>
          </p>
        </>
      )}
    </div>
  );
}

function FindingAiCard({ ruleId }: { ruleId: RuleId }) {
  const flow = useAiCardFlow(ruleId);
  const { explain } = flow;
  const heading = useRef<HTMLDivElement>(null);
  const streaming = explain.kind === "running" && explain.target === ruleId;
  const explanation: Partial<Explanation> | null = streaming
    ? explain.partial
    : explain.kind === "ready" || explain.kind === "failed"
      ? (explain.byRule[ruleId] ?? null)
      : null;
  const ready = !streaming && explanation !== null;
  const wasStreaming = useRef(false);
  // When the explanation the user asked for lands, read it next.
  useEffect(() => {
    if (wasStreaming.current && ready) heading.current?.focus();
    wasStreaming.current = streaming;
  }, [streaming, ready]);
  return (
    <div ref={heading} tabIndex={-1} className="ai-card-host">
      <AiCard kind="finding" state={flow.state} {...flow.handlers}>
        {explanation !== null && <ExplanationFields explanation={explanation} streaming={streaming} />}
      </AiCard>
    </div>
  );
}
