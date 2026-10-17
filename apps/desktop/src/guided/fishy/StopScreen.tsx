import type { WatchDetailsItem } from "@talos/core";
import { FISHY } from "../copy";
import { ActionStep } from "./ActionStep";
import { DetailsDisclosure } from "./DetailsDisclosure";
import { SourceLine } from "./SourceLine";
import { stopActionFor } from "./useFishy";

/** Screen 3: stop the program. A listener with no start-up entry gets the block-incoming variant. */
export function StopScreen({ hasEntry, row }: { hasEntry: boolean; row: WatchDetailsItem | null }) {
  const copy = FISHY.stop;
  const actionId = hasEntry ? stopActionFor(row) : "watch.block_incoming";
  const notNowAction = hasEntry ? "act.stop_background_program" : "act.block_incoming";
  return (
    <ActionStep
      title={copy.title}
      body={
        <>
          <p>{hasEntry ? copy.body : copy.bodyNoEntry}</p>
          <SourceLine text={copy.source} />
        </>
      }
      actionId={actionId}
      primaryLabel={hasEntry ? copy.primary : copy.primaryNoEntry}
      notNowAction={notNowAction}
      linkLabel={copy.link}
      hasPane={hasEntry}
    >
      <DetailsDisclosure actionId={notNowAction} row={row} />
    </ActionStep>
  );
}
