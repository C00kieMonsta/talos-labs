import { FISHY } from "../copy";
import { ActionStep } from "./ActionStep";
import { DetailsDisclosure } from "./DetailsDisclosure";
import { SourceLine } from "./SourceLine";

/** Screen 6: back to normal. Wi-Fi on, or allow incoming again on a wired Mac. */
export function RecoverScreen({ wired }: { wired: boolean }) {
  const copy = FISHY.recover;
  return (
    <ActionStep
      title={copy.title}
      body={
        <>
          <p>{copy.body}</p>
          <SourceLine text={copy.source} />
        </>
      }
      actionId={wired ? "watch.allow_incoming" : "watch.wifi_on"}
      primaryLabel={wired ? copy.primaryWired : copy.primary}
      notNowAction="act.reconnect_and_watch"
      linkLabel={copy.link}
      hasPane={false}
    >
      <DetailsDisclosure actionId="act.reconnect_and_watch" />
    </ActionStep>
  );
}
