import { useApp } from "../../app/context";
import { SCAN_ERROR_LABELS } from "../../app/labels";
import type { GuidedController } from "../state";
import { EndScreen } from "../EndScreen";
import { GuidedWelcome } from "../GuidedWelcome";
import { SinceScreen } from "../SinceScreen";
import { StepFrame } from "../StepFrame";
import { FAILED, STOPPED } from "../copy";
import { BatchStep } from "./BatchStep";
import { FixStep } from "./FixStep";
import { PaywallStep } from "./PaywallStep";
import { PermissionStep } from "./PermissionStep";
import { PlanScreen } from "./PlanScreen";
import { ShowStep } from "./ShowStep";

/** One screen per phase. The scanning phase is drawn by App.tsx, which owns the pacer. */
export function Guided({ controller, onWelcomeStart }: { controller: GuidedController; onWelcomeStart(): void }) {
  const { settings } = useApp();
  const { phase } = controller;
  switch (phase.kind) {
    case "welcome":
      return <GuidedWelcome onStart={onWelcomeStart} />;
    case "scanning":
      return null;
    case "stopped":
      return <StepFrame progress={null} title={STOPPED.title} primary={{ label: STOPPED.button, onClick: controller.start }} className="guided-stopped" />;
    case "failed":
      return (
        <StepFrame progress={null} title={FAILED.title} body={<p>{FAILED.body}</p>} primary={{ label: FAILED.button, onClick: controller.start }} className="guided-failed">
          {settings.developer.enabled && <p className="guided-meta">{SCAN_ERROR_LABELS[phase.error]}</p>}
        </StepFrame>
      );
    case "since":
      return <SinceScreen diff={phase.diff} plan={phase.plan} onCarryOn={controller.carryOn} />;
    case "plan":
      return <PlanScreen plan={phase.plan} listOpen={phase.listOpen} same={phase.same} progress={controller.progress} onGo={controller.carryOn} onToggleList={controller.toggleList} />;
    case "end":
      return <EndScreen plan={phase.plan} fixed={phase.fixed} onCheckAgain={controller.start} />;
    case "step": {
      const step = phase.plan.steps[phase.index];
      if (step === undefined) return null;
      const common = { state: phase.state, controller, notice: phase.notice };
      switch (step.kind) {
        case "batch":
          return <BatchStep key={step.id} step={step} {...common} />;
        case "fix":
          return <FixStep key={step.id} step={step} {...common} />;
        case "show":
          return <ShowStep key={step.id} step={step} {...common} />;
        case "permission":
          return <PermissionStep key={step.id} {...common} />;
        case "paywall":
          return <PaywallStep key={step.id} step={step} {...common} />;
      }
    }
  }
}
