import type { ReactNode } from "react";
import type { Evidence, Finding, FixPlan, RuleCatalog, RuleId, SettingsPane } from "@talos/core";
import { SEVERITY_WEIGHT } from "@talos/core";
import { ICONS } from "../app/icons";
import { SIDE_EFFECT_LABELS } from "../app/labels";
import type { DeveloperSettings } from "../settings";
import type { SingleFixingState } from "../scan/machine";
import { useApp } from "../app/context";
import { choiceFor, pathChoices } from "./FixCard";
import { Icon } from "./Icon";
import { PassphraseForm } from "./PassphraseSheet";
import { Sheet } from "./Sheet";
import {
  ACTION_LABELS,
  AFTERWARDS_SENTENCE,
  NO_PASSWORD_SENTENCE,
  PASSWORD_SENTENCE,
  RESTART_SENTENCE,
  SSH_ADD_NOTE,
  doneLabel,
  fixErrorCopy,
  recheckCopy,
  runningLabel,
  type FixCopy,
  type FixSheetAction,
} from "./fix-copy";

export interface FixSheetProps {
  finding: Finding;
  fixing: SingleFixingState;
  developer: DeveloperSettings;
  onApply(passphrase?: string): void;
  /** Stops a running apply. */
  onCancel(): void;
  onClose(): void;
  onRetry(): void;
  onOpenPane(pane: SettingsPane): void;
  onCheckAgain(): void;
  onRescan(): void;
}

function keyPathFrom(evidence: readonly Evidence[]): string | null {
  for (const entry of evidence) if (entry.value.kind === "path") return entry.value.value;
  return null;
}

function previousLine(plan: FixPlan): string | null {
  if (plan.ruleId !== "TL-MAC-013") return null;
  return plan.previous === null ? "Currently never" : `Currently ${plan.previous} minutes`;
}

/** The confirmation sheet, then the running, done and failed states of one in-app fix. */
export function FixSheet(props: FixSheetProps) {
  const { finding, fixing, developer, onApply, onCancel, onClose, onRetry, onOpenPane, onCheckAgain, onRescan } = props;
  const apply = finding.fix.apply;
  const title = apply.kind === "in_app" ? apply.confirmTitle : finding.fix.summary;
  const verb = apply.kind === "in_app" ? apply.confirmVerb : "Apply";
  const note = apply.kind === "in_app" ? apply.confirmNote : null;
  const { plan, phase } = fixing;
  const running = phase === "waiting_for_password" || phase === "running" || phase === "rechecking";
  const pane = finding.fix.settingsPane;
  const act = (action: FixSheetAction) => {
    switch (action) {
      case "try_again":
      case "review":
        return onRetry();
      case "close":
        return onClose();
      case "open_settings":
        return pane === null ? onClose() : onOpenPane(pane);
      case "check_again":
        return onCheckAgain();
      case "rescan":
        return onRescan();
    }
  };
  const buttons = (copy: FixCopy): ReactNode =>
    copy.actions.map((action, index) => (
      <button key={action} type="button" className={index === 0 ? "button button-primary" : "button"} onClick={() => act(action)} autoFocus={index === 0}>
        {ACTION_LABELS[action]}
      </button>
    ));

  let body: ReactNode;
  let actions: ReactNode | undefined = null;
  if (phase === "confirm") {
    if (plan.needsPassphrase) {
      // The form renders Cancel next to its submit, so the sheet adds no second row.
      body = <PassphraseForm keyPath={keyPathFrom(finding.evidence)} onSubmit={(passphrase) => onApply(passphrase)} onCancel={onClose} />;
      actions = undefined;
    } else {
      body = <Confirm plan={plan} developer={developer} note={note} sideEffects={finding.fix.sideEffects} />;
      actions = (
        <>
          <button type="button" className="button" onClick={onClose} autoFocus={plan.needsPassword}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={() => onApply()} autoFocus={!plan.needsPassword}>
            {plan.needsPassword ? `${verb}…` : verb}
          </button>
        </>
      );
    }
  } else if (running) {
    body = (
      <p className="sheet-result" role="status">
        <Icon icon={ICONS.spinner} size={20} className="spin" />
        <span>{runningLabel(phase, fixing.step, fixing.of)}</span>
      </p>
    );
    actions =
      phase === "rechecking" ? null : (
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      );
  } else if (phase === "done") {
    const result = fixing.result ?? "pass";
    if (result === "pass") {
      body = (
        <>
          <p className="sheet-result" role="status" tabIndex={-1} autoFocus>
            <Icon icon={ICONS.check} size={20} />
            <span>{doneLabel(plan.ruleId, finding.title, finding.points)}</span>
          </p>
          {plan.ruleId === "TL-MAC-029" && <p className="muted small">{SSH_ADD_NOTE}</p>}
        </>
      );
      actions = (
        <button type="button" className="button button-primary" onClick={onClose} autoFocus>
          Close
        </button>
      );
    } else {
      const copy = recheckCopy(result, pane !== null);
      body = (
        <p className="sheet-result" role="status">
          <Icon icon={ICONS.alert} size={20} />
          <span>{copy.text}</span>
        </p>
      );
      actions = (
        <>
          {buttons(copy)}
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </>
      );
    }
  } else {
    const copy = fixErrorCopy(fixing.error ?? "command_failed", fixing.step, developer.enabled, pane !== null);
    body = (
      <p className="sheet-result" role="alert">
        <Icon icon={ICONS.alert} size={20} />
        <span>{copy.text}</span>
      </p>
    );
    actions = buttons(copy);
  }

  return (
    <Sheet title={title} onClose={running ? onCancel : onClose} locked={running} actions={actions} className="fix-sheet">
      {body}
    </Sheet>
  );
}

function Confirm({
  plan,
  developer,
  note,
  sideEffects,
}: {
  plan: FixPlan;
  developer: DeveloperSettings;
  note: string | null;
  sideEffects: Finding["fix"]["sideEffects"];
}) {
  const count = plan.lines.length;
  const previous = previousLine(plan);
  const reversible = plan.reversible === null ? "Reversible: no." : `Reversible: yes. ${plan.reversible}`;
  return (
    <div className="fix-confirm">
      <p>
        Talos Labs will run {count === 1 ? "one command" : `${count} commands`} on this Mac.{" "}
        {plan.needsPassword ? PASSWORD_SENTENCE : NO_PASSWORD_SENTENCE}
      </p>
      {note !== null && <p>{note}</p>}
      {previous !== null && <p className="muted">{previous}</p>}
      <details className="fix-plan" open={developer.showPlanExpanded && developer.enabled}>
        <summary>What will run</summary>
        <ul className="command-list">
          {plan.lines.map((line, index) => (
            <li key={index} className="command">
              <code className="mono">{line.text}</code>
              {line.privilege === "admin" && <span className="muted small command-note">as administrator</span>}
            </li>
          ))}
        </ul>
      </details>
      <p className="muted small">
        Side effects: {sideEffects === "none" ? "none" : SIDE_EFFECT_LABELS[sideEffects].toLowerCase()}. {reversible}
      </p>
      {sideEffects === "restart" && <p>{RESTART_SENTENCE}</p>}
      <p className="muted small">{AFTERWARDS_SENTENCE}</p>
    </div>
  );
}

/** Once a fix lands the rule leaves the report, so the done sheet reads the catalog for its title and points. */
function passedFinding(catalog: RuleCatalog, ruleId: RuleId): Finding | null {
  const rule = catalog.rules.find((r) => r.id === ruleId);
  if (rule === undefined) return null;
  return {
    ruleId,
    title: rule.title,
    headline: rule.title,
    severity: rule.severity,
    category: rule.category,
    cis: rule.cis,
    requires: rule.requires,
    status: "fail",
    evidence: [],
    unknownReason: null,
    points: SEVERITY_WEIGHT[rule.severity],
    explanation: rule.explanation,
    fix: rule.fix,
    guided: rule.guided,
  };
}

/** The sheet for whatever fix the scan state holds, wired to the hook. Mount once per screen that can start a fix. */
export function FixFlow() {
  const { scan, settings, adapters, catalog } = useApp();
  const state = scan.scan;
  if (state.kind !== "ready" || state.fixing === null) return null;
  const { fixing } = state;
  if (fixing.kind !== "single") return null;
  const finding = state.report.findings.find((f) => f.ruleId === fixing.plan.ruleId) ?? passedFinding(catalog, fixing.plan.ruleId);
  if (finding === null) return null;
  const retry = () => {
    scan.dismissFix();
    void scan.previewFix(finding.ruleId, choiceFor(finding, pathChoices(finding.evidence)[0]?.path ?? null) ?? { kind: "none" });
  };
  return (
    <FixSheet
      finding={finding}
      fixing={fixing}
      developer={settings.developer}
      onApply={(passphrase) => void scan.applyFix(passphrase)}
      onCancel={scan.cancelFix}
      onClose={scan.dismissFix}
      onRetry={retry}
      onOpenPane={(pane) => {
        scan.dismissFix();
        void adapters.openSettingsPane(pane);
        scan.startWatch(finding.ruleId);
      }}
      onCheckAgain={() => {
        scan.dismissFix();
        void scan.recheck(fixing.plan.recheck);
      }}
      onRescan={() => {
        scan.dismissFix();
        void scan.start();
      }}
    />
  );
}
