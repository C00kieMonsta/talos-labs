import type { ReactNode } from "react";
import type { ActionId, WatchActionId } from "@talos/core";
import { useApp } from "../../app/context";
import { watchActive } from "../../app/gate";
import { StepFrame } from "../StepFrame";
import { FIX, STATUS, failureCopy } from "../copy";
import { useFishyController } from "./controller";

const PRIMARY_LABELS = { try_again: FIX.tryAgain, show_where: FIX.showWhere, next: FIX.next, check_again: FIX.checkAgain } as const;

/** The five catalogue rows that ask for the admin password through macOS's own dialog; watch.stop_user_agent runs as the user. */
const ADMIN_ACTIONS: readonly WatchActionId[] = ["watch.wifi_off", "watch.wifi_on", "watch.block_incoming", "watch.allow_incoming", "watch.stop_daemon"];

export function isAdminAction(actionId: WatchActionId): boolean {
  return ADMIN_ACTIONS.includes(actionId);
}

export interface ActionStepProps {
  readonly title: string;
  /** The sentences and their source lines. */
  readonly body: ReactNode;
  /** The WATCH_CATALOG row the primary runs. */
  readonly actionId: WatchActionId;
  readonly primaryLabel: string;
  /** The playbook row "Not now" snoozes. */
  readonly notNowAction: ActionId;
  readonly linkLabel: string;
  /** True when a "Show me where" screen follows, so a failure can hand over to it. */
  readonly hasPane: boolean;
  readonly children?: ReactNode;
}

/** A screen whose one primary runs a catalogue row: the password line for admin rows, the status line while it runs, the failure table on error. */
export function ActionStep({ title, body, actionId, primaryLabel, notNowAction, linkLabel, hasPane, children }: ActionStepProps) {
  const { settings, gate } = useApp();
  const fishy = useFishyController();
  const { busy, error } = fishy;
  if (error !== null) {
    const copy = failureCopy(error, false, hasPane, watchActive(settings, gate));
    const onPrimary = copy.primary === "try_again" ? () => void fishy.runAction(actionId) : fishy.next;
    return (
      <StepFrame progress={null} title={copy.title} body={copy.body === null ? null : <p>{copy.body}</p>} primary={{ label: PRIMARY_LABELS[copy.primary], onClick: onPrimary }} link={copy.later ? { label: linkLabel, onClick: () => fishy.notNow(notNowAction) } : null} className="guided-fishy" />
    );
  }
  const running = busy !== "idle";
  const status = busy === "password" ? STATUS.password : busy === "working" ? STATUS.working : null;
  return (
    <StepFrame
      progress={null}
      title={title}
      body={
        <>
          {body}
          {isAdminAction(actionId) && <p className="guided-meta-line">{FIX.password}</p>}
        </>
      }
      status={status}
      primary={{ label: primaryLabel, onClick: () => void fishy.runAction(actionId), disabled: running }}
      link={{ label: linkLabel, onClick: () => fishy.notNow(notNowAction), disabled: running }}
      className="guided-fishy"
    >
      {children}
    </StepFrame>
  );
}
