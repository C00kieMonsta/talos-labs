import type { GuidedStep } from "@talos/core";
import type { GuidedController, StepState } from "../state";
import { stepProgress } from "../state";
import { StepFrame } from "../StepFrame";
import { WatchStrip } from "../WatchStrip";
import { FIX, LATER_FLASH, QUESTION, SHOW } from "../copy";
import { guidedFor } from "../plan";

type ShowStepT = Extract<GuidedStep, { kind: "show" }>;

export function ShowStep({ step, state, controller, notice }: { step: ShowStepT; state: StepState; controller: GuidedController; notice: string | null }) {
  const progress = stepProgress(controller);
  const strings = guidedFor(step.ruleId);
  const where = strings.where ?? "";
  switch (state.kind) {
    case "question":
      return (
        <StepFrame
          progress={progress}
          devId={step.ruleId}
          title={strings.headline}
          body={
            <p>
              {strings.why} {QUESTION.ask}
            </p>
          }
          primary={{ label: QUESTION.yes, onClick: () => controller.answer("backup_disk", true) }}
          link={{ label: QUESTION.no, onClick: () => controller.answer("backup_disk", false) }}
          explainRuleId={step.ruleId}
          notice={notice}
        />
      );
    case "watching":
      if (state.stale) {
        return <StepFrame progress={progress} devId={step.ruleId} title={SHOW.staleTitle} body={<p>{SHOW.staleBody}</p>} primary={{ label: FIX.checkAgain, onClick: () => controller.primary() }} link={{ label: SHOW.later, onClick: controller.later }} notice={notice} className="guided-show-stale" />;
      }
      return (
        <StepFrame
          progress={progress}
          devId={step.ruleId}
          title={SHOW.opened}
          body={
            <p>
              {where}
              {step.restart && ` ${/restart/i.test(where) ? SHOW.carryOn : SHOW.restart}`}
            </p>
          }
          link={{ label: SHOW.later, onClick: controller.later }}
          notice={notice}
          className="guided-show-opened"
        >
          <WatchStrip text={SHOW.notice} />
        </StepFrame>
      );
    case "done":
      return <StepFrame progress={progress} devId={step.ruleId} title={state.line} done link={{ label: FIX.next, onClick: controller.next }} notice={notice} />;
    case "later_flash":
      return <StepFrame progress={progress} devId={step.ruleId} title={state.text ?? LATER_FLASH} notice={notice} />;
    default:
      return (
        <StepFrame
          progress={progress}
          devId={step.ruleId}
          title={strings.headline}
          body={
            <p>
              {strings.why} {SHOW.lead}
            </p>
          }
          primary={{ label: SHOW.button, onClick: () => controller.primary() }}
          link={{ label: FIX.later, onClick: controller.later }}
          explainRuleId={step.ruleId}
          notice={notice}
        />
      );
  }
}
