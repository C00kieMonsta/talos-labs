import type { GuidedStep } from "@talos/core";
import { useApp } from "../../app/context";
import { LicenceField } from "../../components/LicenceField";
import type { GuidedController, StepState } from "../state";
import { stepProgress } from "../state";
import { GuidedList } from "../GuidedList";
import { StepFrame } from "../StepFrame";
import { PAYWALL } from "../copy";
import { guidedFor } from "../plan";

type PaywallStepT = Extract<GuidedStep, { kind: "paywall" }>;

function things(n: number): string {
  return n === 1 ? "1 more thing" : `${n} more things`;
}

export function PaywallStep({ step, state, controller, notice }: { step: PaywallStepT; state: StepState; controller: GuidedController; notice: string | null }) {
  const { adapters } = useApp();
  const progress = stepProgress(controller);
  if (state.kind === "later_flash") {
    return <StepFrame progress={progress} devId="paywall" title={state.text ?? PAYWALL.thanks} done notice={notice} />;
  }
  const rows = step.lockedRuleIds.map((id) => ({ key: id, text: guidedFor(id).headline, icon: "bullet" as const }));
  return (
    <StepFrame
      progress={progress}
      devId="paywall"
      title={`There are ${things(step.lockedRuleIds.length)} to fix.`}
      body={<p>{PAYWALL.body}</p>}
      primary={{ label: PAYWALL.buy, onClick: () => void adapters.fixes.openBuyPage() }}
      link={{ label: PAYWALL.notNow, onClick: controller.later }}
      notice={notice}
      className="guided-paywall"
      afterPrimary={
        <div className="guided-licence">
          <LicenceField onBuy={() => void adapters.fixes.openBuyPage()} onUnlocked={() => void controller.enterLicence("")} />
        </div>
      }
    >
      <GuidedList rows={rows} />
    </StepFrame>
  );
}
