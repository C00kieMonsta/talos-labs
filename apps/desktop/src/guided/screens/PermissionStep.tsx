import type { GuidedController, StepState } from "../state";
import { stepProgress } from "../state";
import { StepFrame } from "../StepFrame";
import { WatchStrip } from "../WatchStrip";
import { FIX, PERMISSION, SHOW } from "../copy";

export function PermissionStep({ state, controller, notice }: { state: StepState; controller: GuidedController; notice: string | null }) {
  const progress = stepProgress(controller);
  const devId = "full_disk_access";
  if (state.kind === "done") {
    return <StepFrame progress={progress} devId={devId} title={state.line} done link={{ label: FIX.next, onClick: controller.next }} notice={notice} />;
  }
  if (state.kind === "permission" && state.card === "reopen_needed") {
    return <StepFrame progress={progress} devId={devId} title={PERMISSION.nearly} body={<p>{PERMISSION.reopenBody}</p>} primary={{ label: PERMISSION.reopen, onClick: () => controller.primary() }} link={{ label: PERMISSION.notNow, onClick: controller.later }} notice={notice} className="guided-permission-reopen" />;
  }
  if (state.kind === "permission") {
    return (
      <StepFrame progress={progress} devId={devId} title={PERMISSION.opened} link={{ label: PERMISSION.notNow, onClick: controller.later }} notice={notice} className="guided-permission-watching">
        <div className="guided-muted-card">
          <p>{PERMISSION.where}</p>
        </div>
        <WatchStrip text={SHOW.notice} />
      </StepFrame>
    );
  }
  return <StepFrame progress={progress} devId={devId} title={PERMISSION.title} body={<p>{PERMISSION.body}</p>} primary={{ label: PERMISSION.button, onClick: () => controller.primary() }} link={{ label: PERMISSION.notNow, onClick: controller.later }} notice={notice} />;
}
