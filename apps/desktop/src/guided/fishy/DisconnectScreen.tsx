import { FISHY } from "../copy";
import { ActionStep } from "./ActionStep";
import { DetailsDisclosure } from "./DetailsDisclosure";
import { SourceLine } from "./SourceLine";

/** Screen 2: cut it off from the internet. Wi-Fi off, or block incoming on a wired Mac. */
export function DisconnectScreen({ wired }: { wired: boolean }) {
  const copy = FISHY.disconnect;
  const actionId = wired ? "watch.block_incoming" : "watch.wifi_off";
  const notNowAction = wired ? "act.block_incoming" : "act.disconnect_network";
  return (
    <ActionStep
      title={copy.title}
      body={
        <>
          <p>{wired ? copy.bodyWired : copy.body}</p>
          <SourceLine text={copy.source} />
          <p>{copy.keepOn}</p>
          <SourceLine text={copy.keepOnSource} />
        </>
      }
      actionId={actionId}
      primaryLabel={wired ? copy.primaryWired : copy.primary}
      notNowAction={notNowAction}
      linkLabel={copy.link}
      hasPane={false}
    >
      <DetailsDisclosure actionId={notNowAction} />
    </ActionStep>
  );
}
