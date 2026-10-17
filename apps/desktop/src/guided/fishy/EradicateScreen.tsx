import type { WatchDetailsItem } from "@talos/core";
import { StepFrame } from "../StepFrame";
import { REVEAL_LABEL } from "../../components/FixCard";
import { FISHY } from "../copy";
import { DetailsDisclosure } from "./DetailsDisclosure";
import { SourceLine } from "./SourceLine";
import { useFishyController } from "./controller";

/** Screen 4: keep it from starting again. Opens Login Items and asks the watch to re-read, then carries on. */
export function EradicateScreen({ row }: { row: WatchDetailsItem | null }) {
  const fishy = useFishyController();
  const copy = FISHY.eradicate;
  const show = () => {
    fishy.showPane("login_items");
    fishy.next();
  };
  return (
    <StepFrame
      progress={null}
      title={copy.title}
      body={
        <>
          <p>{copy.body}</p>
          <SourceLine text={copy.source} />
        </>
      }
      primary={{ label: copy.primary, onClick: show }}
      link={{ label: copy.link, onClick: () => fishy.notNow("act.review_background_programs") }}
      className="guided-fishy"
    >
      <DetailsDisclosure actionId="act.review_background_programs" row={row}>
        {row?.plistPath !== undefined && (
          <button type="button" className="button button-small fishy-reveal" onClick={fishy.reveal}>
            {REVEAL_LABEL}
          </button>
        )}
      </DetailsDisclosure>
    </StepFrame>
  );
}
