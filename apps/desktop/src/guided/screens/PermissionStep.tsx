import { useApp } from "../../app/context";
import { DEV_BUILD_FDA_COPY } from "../../screens/Settings";
import type { GuidedController, StepState } from "../state";
import { stepProgress } from "../state";
import { StepFrame } from "../StepFrame";
import { WatchStrip } from "../WatchStrip";
import { FIX, PERMISSION, SHOW } from "../copy";

export function PermissionStep({ state, controller, notice }: { state: StepState; controller: GuidedController; notice: string | null }) {
  const progress = stepProgress(controller);
  const devId = "full_disk_access";
  const bundled = useApp().capabilities?.bundled !== false;
  if (state.kind === "done") {
    return <StepFrame progress={progress} devId={devId} title={state.line} done link={{ label: FIX.next, onClick: controller.next }} notice={notice} />;
  }
  if (state.kind === "permission" && state.card === "reopen_needed") {
    return <StepFrame progress={progress} devId={devId} title={PERMISSION.nearly} body={<p>{PERMISSION.reopenBody}</p>} primary={{ label: PERMISSION.reopen, onClick: () => controller.primary() }} link={{ label: PERMISSION.notNow, onClick: controller.later }} notice={notice} className="guided-permission-reopen" />;
  }
  if (state.kind === "permission") {
    return (
      <StepFrame progress={progress} devId={devId} title={PERMISSION.opened} body={bundled ? <p>{PERMISSION.where}</p> : <><p>{PERMISSION.where}</p><p>{DEV_BUILD_FDA_COPY}</p></>} link={{ label: PERMISSION.notNow, onClick: controller.later }} notice={notice} className="guided-permission-watching">
        <WatchStrip text={SHOW.notice} />
      </StepFrame>
    );
  }
  return <StepFrame progress={progress} devId={devId} title={PERMISSION.title} body={<p>{PERMISSION.body}</p>} primary={{ label: PERMISSION.button, onClick: () => controller.primary() }} link={{ label: PERMISSION.notNow, onClick: controller.later }} notice={notice} />;
}
