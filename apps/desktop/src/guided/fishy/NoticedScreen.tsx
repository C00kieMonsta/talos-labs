import { useId } from "react";
import type { FishyKind, WatchDetailsItem } from "@talos/core";
import { formatTime } from "../../app/labels";
import { StepFrame } from "../StepFrame";
import { REVEAL_LABEL } from "../../components/FixCard";
import { FISHY } from "../copy";
import { DetailsDisclosure } from "./DetailsDisclosure";
import { SourceLine } from "./SourceLine";
import { useFishyController } from "./controller";

/** Screen 1: what I noticed. The program's name, port or folder sits under Details only, with the evidence sentence beside it. */
export function NoticedScreen({ kind, changedAt, row }: { kind: FishyKind; changedAt: string; row: WatchDetailsItem | null }) {
  const fishy = useFishyController();
  const ransomId = useId();
  const body = FISHY.noticed.body.replace("{time}", formatTime(changedAt));
  return (
    <StepFrame
      progress={null}
      title={FISHY.noticed.headline[kind]}
      body={
        <>
          <p>{body}</p>
          <SourceLine text={FISHY.noticed.source} />
        </>
      }
      primary={{ label: FISHY.noticed.primary, onClick: fishy.next }}
      link={{ label: FISHY.noticed.link, onClick: fishy.thisIsFine }}
      className="guided-fishy"
    >
      <DetailsDisclosure actionId="act.note_what_you_saw" row={row}>
        <p className="fishy-evidence">{FISHY.evidence}</p>
        <label className="fishy-ransom" htmlFor={ransomId}>
          <input id={ransomId} type="checkbox" checked={fishy.ransomNote} onChange={(event) => fishy.setRansomNote(event.target.checked)} />
          {FISHY.noticed.ransom}
        </label>
        {row?.plistPath !== undefined && (
          <button type="button" className="button button-small fishy-reveal" onClick={fishy.reveal}>
            {REVEAL_LABEL}
          </button>
        )}
      </DetailsDisclosure>
    </StepFrame>
  );
}
