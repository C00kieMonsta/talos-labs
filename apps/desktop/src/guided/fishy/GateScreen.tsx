import type { GatedKind } from "@talos/core";
import { formatTime } from "../../app/labels";
import { StepFrame } from "../StepFrame";
import { FISHY } from "../copy";
import { useFishyController } from "./controller";

/** Screen 0: "Did you just change this?", for the flips a person makes in System Settings. */
export function GateScreen({ kind, changedAt }: { kind: GatedKind; changedAt: string }) {
  const fishy = useFishyController();
  const body = FISHY.gate.body[kind].replace("{time}", formatTime(changedAt));
  return <StepFrame progress={null} title={FISHY.gate.title} body={<p>{body}</p>} primary={{ label: FISHY.gate.primary, onClick: () => fishy.answerGate(false) }} link={{ label: FISHY.gate.link, onClick: () => fishy.answerGate(true) }} className="guided-fishy" />;
}
