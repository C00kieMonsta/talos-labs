import { useApp } from "../app/context";
import { useGuidedHero } from "./GuidedShell";
import { StepFrame } from "./StepFrame";
import { FISHY, WATCH } from "./copy";
import { DisconnectScreen } from "./fishy/DisconnectScreen";
import { EradicateScreen } from "./fishy/EradicateScreen";
import { ExpertsScreen } from "./fishy/ExpertsScreen";
import { GateScreen } from "./fishy/GateScreen";
import { NoticedScreen } from "./fishy/NoticedScreen";
import { RecoverScreen } from "./fishy/RecoverScreen";
import { StopScreen } from "./fishy/StopScreen";
import { useFishyController } from "./fishy/controller";
import { detailsItemFor, isGatedKind } from "./fishy/useFishy";

/**
 * The "something seems fishy" flow (DESIGN-WATCH.md section 6): one StepFrame per stage, no
 * progress line, one primary and at most one link per screen. Strings come from FISHY only.
 */
export function FishyFlow() {
  const { settings } = useApp();
  const fishy = useFishyController();
  useGuidedHero(false, true);
  const { item, details } = fishy;
  const row = detailsItemFor(details, item);
  if (item === null) {
    // Opened with nothing to show: the calm word and the way back.
    return <StepFrame progress={null} title={WATCH.calm} primary={{ label: FISHY.experts.primary, onClick: fishy.done }} className="guided-fishy" />;
  }
  const changedAt = item.changedAt ?? new Date().toISOString();
  switch (fishy.stage) {
    case "gate":
      return isGatedKind(item.kind) ? <GateScreen kind={item.kind} changedAt={changedAt} /> : <NoticedScreen kind={item.kind} changedAt={changedAt} row={row} />;
    case "noticed":
      return <NoticedScreen kind={item.kind} changedAt={changedAt} row={row} />;
    case "disconnect":
      return <DisconnectScreen wired={fishy.wired} />;
    case "stop":
      return <StopScreen hasEntry={item.hasStartupEntry} row={row} />;
    case "eradicate":
      return <EradicateScreen row={row} />;
    case "experts":
      return <ExpertsScreen item={item} handlesClientData={settings.profile.handlesClientData} />;
    case "recover":
      return <RecoverScreen wired={fishy.wired} />;
  }
}
