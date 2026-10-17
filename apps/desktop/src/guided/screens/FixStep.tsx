import type { GuidedStep } from "@talos/core";
import { useApp } from "../../app/context";
import { useFixActivity } from "../../activity/useActivity";
import { watchActive } from "../../app/gate";
import { PassphraseForm } from "../../components/PassphraseSheet";
import type { GuidedController, StepState } from "../state";
import { stepProgress } from "../state";
import { StepFrame } from "../StepFrame";
import { FIX, LATER_FLASH, STATUS, failureCopy } from "../copy";
import { guidedFor, paneFor } from "../plan";
import { WhatWillRun } from "./WhatWillRun";
import { AcceptScreen } from "./AcceptScreen";

type FixStepT = Extract<GuidedStep, { kind: "fix" }>;

const PRIMARY_LABELS = { try_again: FIX.tryAgain, show_where: FIX.showWhere, next: FIX.next, check_again: FIX.checkAgain } as const;

export function FixStep({ step, state, controller, notice }: { step: FixStepT; state: StepState; controller: GuidedController; notice: string | null }) {
  const { settings, scan, gate } = useApp();
  const fixing = scan.scan.kind === "ready" ? scan.scan.fixing : null;
  const preparing = state.kind === "working" && state.label === STATUS.preparing;
  const rows = useFixActivity(step.id, state.kind === "working" ? fixing : null, preparing);
  const progress = stepProgress(controller);
  const strings = guidedFor(step.ruleId);
  const report = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.report : null;
  const finding = report?.findings.find((f) => f.ruleId === step.ruleId) ?? null;
  const needsPassword = finding?.fix.apply.kind === "in_app" ? finding.fix.apply.needsPassword : true;
  const keyPath = step.choice.kind === "ssh_key" ? step.choice.path : null;
  const body = (
    <>
      <p>
        {strings.why} {FIX.canFix}
      </p>
      <p className="guided-meta-line">{needsPassword ? FIX.password : FIX.noPassword}</p>
    </>
  );
  switch (state.kind) {
    case "working":
      return (
        <StepFrame progress={progress} devId={step.ruleId} title={strings.headline} body={body} status={state.label} activity={fixing !== null || preparing ? rows : null} notice={notice}>
          {settings.developer.enabled && <WhatWillRun />}
        </StepFrame>
      );
    case "done":
      return <StepFrame progress={progress} devId={step.ruleId} title={state.line} done link={{ label: FIX.next, onClick: controller.next }} notice={notice} />;
    case "failed": {
      const copy = failureCopy(state.error, false, paneFor(step.ruleId) !== null, watchActive(settings, gate));
      return (
        <StepFrame progress={progress} devId={step.ruleId} title={copy.title} body={copy.body === null ? null : <p>{copy.body}</p>} primary={{ label: PRIMARY_LABELS[copy.primary], onClick: () => controller.primary() }} link={copy.later ? { label: FIX.later, onClick: controller.later } : null} notice={notice}>
          {settings.developer.enabled && (
            <p className="guided-meta mono">
              error {state.error}
              {state.step !== null && `, step ${state.step}`}
            </p>
          )}
        </StepFrame>
      );
    }
    case "later_flash":
      return <StepFrame progress={progress} devId={step.ruleId} title={state.text ?? LATER_FLASH} notice={notice} />;
    case "ask_accept":
      return <AcceptScreen ruleIds={state.ruleIds} progress={progress} devId={step.ruleId} explainRuleId={step.ruleId} notice={notice} controller={controller} />;
    default:
      if (step.passphrase) {
        return (
          <StepFrame progress={progress} devId={step.ruleId} title={strings.headline} body={body} link={{ label: FIX.later, onClick: controller.later }} explainRuleId={step.ruleId} notice={notice}>
            <PassphraseForm keyPath={keyPath} submitLabel={FIX.passphrase} onSubmit={(passphrase) => controller.primary(passphrase)} />
          </StepFrame>
        );
      }
      return (
        <StepFrame progress={progress} devId={step.ruleId} title={strings.headline} body={body} primary={{ label: strings.verb, onClick: () => controller.primary() }} link={{ label: FIX.later, onClick: controller.later }} explainRuleId={step.ruleId} notice={notice} />
      );
  }
}
