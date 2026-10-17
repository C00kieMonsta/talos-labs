import { useMemo } from "react";
import { useApp } from "../../app/context";
import { useConnect } from "../../scan/ai-connect";
import { CHAT_LABEL, SCAN_ERROR_LABELS } from "../../app/labels";
import { ChatScreen } from "../../chat/ChatScreen";
import type { GuidedController } from "../state";
import { stepBusy } from "../state";
import { useGuidedStrip } from "../GuidedShell";
import { EndScreen } from "../EndScreen";
import { GuidedWelcome } from "../GuidedWelcome";
import { SinceScreen } from "../SinceScreen";
import { StepFrame } from "../StepFrame";
import { FAILED, READY, STOPPED } from "../copy";
import { BatchStep } from "./BatchStep";
import { FixStep } from "./FixStep";
import { PaywallStep } from "./PaywallStep";
import { PermissionStep } from "./PermissionStep";
import { PlanScreen } from "./PlanScreen";
import { ShowStep } from "./ShowStep";

/**
 * The walk-through's strip shows "Chat" in place of "Step by step" when the chat is the home (DESIGN-CHAT section 2):
 * a plan exists, the AI can answer, and no step is in flight (toChat refuses mid-fix, so the link waits too).
 */
function useChatStripLink(controller: GuidedController): void {
  const { aiUsable } = useApp();
  const { phase } = controller;
  const hasPlan = phase.kind === "since" || phase.kind === "plan" || phase.kind === "step" || phase.kind === "end";
  const show = hasPlan && aiUsable && !stepBusy(phase);
  const { toChat } = controller.chat;
  const strip = useMemo(() => (show ? { links: [{ label: CHAT_LABEL, onClick: toChat }] } : null), [show, toChat]);
  useGuidedStrip(strip);
}

/** One screen per phase. The scanning phase is drawn by App.tsx, which owns the pacer. */
export function Guided({ controller, onWelcomeStart }: { controller: GuidedController; onWelcomeStart(): void }) {
  const { settings, scan } = useApp();
  const connect = useConnect();
  useChatStripLink(controller);
  const { phase } = controller;
  switch (phase.kind) {
    case "welcome":
      return <GuidedWelcome onStart={onWelcomeStart} />;
    case "scanning":
      return null;
    case "stopped": {
      const cancelled = phase.cancelled === true || (scan.scan.kind === "failed" && scan.scan.error === "cancelled");
      if (cancelled) return <StepFrame progress={null} title={STOPPED.title} primary={{ label: STOPPED.button, onClick: controller.start }} className="guided-stopped" />;
      return <StepFrame progress={null} title={READY.title} body={<p>{READY.body}</p>} primary={{ label: READY.button, onClick: controller.start }} className="guided-ready" />;
    }
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
      return <EndScreen plan={phase.plan} fixed={phase.fixed} onCheckAgain={controller.start} onNext={controller.doNext} onConnect={() => connect.open({ name: "guided" })} />;
    case "chat":
      return <ChatScreen />;
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
