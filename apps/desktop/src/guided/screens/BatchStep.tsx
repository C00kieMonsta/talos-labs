import type { GuidedStep } from "@talos/core";
import { useApp } from "../../app/context";
import type { GuidedController, StepState } from "../state";
import { stepProgress } from "../state";
import { GuidedList } from "../GuidedList";
import { StepFrame } from "../StepFrame";
import { BATCH, FIX, LATER_FLASH, STATUS, failureCopy } from "../copy";
import { guidedFor } from "../plan";
import { WhatWillRun } from "./WhatWillRun";

type BatchStepT = Extract<GuidedStep, { kind: "batch" }>;

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

export function BatchStep({ step, state, controller, notice }: { step: BatchStepT; state: StepState; controller: GuidedController; notice: string | null }) {
  const { settings } = useApp();
  const progress = stepProgress(controller);
  const devId = step.ruleIds.join(" ");
  const explain = step.ruleIds[0] ?? null;
  const headlines = step.ruleIds.map((id) => ({ key: id, text: guidedFor(id).headline, icon: "bullet" as const }));
  switch (state.kind) {
    case "working": {
      // One idea while it runs, no list. The password sentence splits into headline and body, like the kit.
      const asking = state.label === STATUS.password;
      const cut = STATUS.password.indexOf(". ") + 1;
      const title = asking ? STATUS.password.slice(0, cut) : `I can fix ${things(step.ruleIds.length)} for you now.`;
      return (
        <StepFrame progress={progress} devId={devId} title={title} body={asking ? <p>{STATUS.password.slice(cut + 1)}</p> : null} status={asking ? STATUS.waiting : state.label} notice={notice}>
          {settings.developer.enabled && <WhatWillRun />}
        </StepFrame>
      );
    }
    case "done": {
      const partial = state.rows.some((r) => !r.ok);
      const rows = state.rows.map((r) => ({ key: r.ruleId, text: r.text, icon: r.ok ? ("ok" as const) : ("failed" as const), tag: r.tag }));
      return (
        <StepFrame progress={progress} devId={devId} title={state.line} done={!partial} mark={false} primary={partial ? { label: BATCH.carryOn, onClick: controller.carryOn } : null} link={partial ? null : { label: FIX.next, onClick: controller.next }} notice={notice}>
          <GuidedList rows={rows} />
        </StepFrame>
      );
    }
    case "failed": {
      const copy = failureCopy(state.error, true, false);
      return (
        <StepFrame progress={progress} devId={devId} title={copy.title} body={copy.body === null ? null : <p>{copy.body}</p>} primary={{ label: FIX.tryAgain, onClick: () => controller.primary() }} link={{ label: BATCH.later, onClick: controller.later }} notice={notice}>
          {settings.developer.enabled && <p className="guided-meta mono">error {state.error}</p>}
        </StepFrame>
      );
    }
    case "later_flash":
      return <StepFrame progress={progress} devId={devId} title={state.text ?? LATER_FLASH} notice={notice} />;
    default:
      return (
        <StepFrame
          progress={progress}
          devId={devId}
          title={`I can fix ${things(step.ruleIds.length)} for you now.`}
          body={<p>{BATCH.password}</p>}
          primary={{ label: BATCH.button, onClick: () => controller.primary() }}
          link={{ label: BATCH.later, onClick: controller.later }}
          explainRuleId={explain}
          notice={notice}
        >
          <GuidedList rows={headlines} />
        </StepFrame>
      );
  }
}
