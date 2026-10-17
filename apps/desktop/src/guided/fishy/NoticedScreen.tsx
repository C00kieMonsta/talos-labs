import { useId } from "react";
import type { FishyKind, WatchDetailsItem } from "@talos/core";
import { formatTime } from "../../app/labels";
import { StepFrame } from "../StepFrame";
import { REVEAL_LABEL } from "../../components/FixCard";
import { FISHY } from "../copy";
import { DetailsDisclosure } from "./DetailsDisclosure";
import { SourceLine } from "./SourceLine";
import { useFishyController } from "./controller";

/** Screen 1: what I noticed. The program's name, port, folder or changed file sits under Details only, with the evidence sentence beside it. */
export function NoticedScreen({ kind, changedAt, row }: { kind: FishyKind; changedAt: string; row: WatchDetailsItem | null }) {
  const fishy = useFishyController();
  const ransomId = useId();
  const body = FISHY.noticed.body.replace("{time}", formatTime(changedAt));
  // A start-up entry and an app bundle can be shown in Finder; a changed file carries its time instead.
  const canReveal = row?.plistPath !== undefined || (row?.signature !== undefined && row.programPath !== undefined);
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
        {row?.filePath !== undefined && <p className="fishy-changed-at mono">{FISHY.noticed.changedAt.replace("{time}", formatTime(changedAt))}</p>}
        <p className="fishy-evidence">{FISHY.evidence}</p>
        <label className="fishy-ransom" htmlFor={ransomId}>
          <input id={ransomId} type="checkbox" checked={fishy.ransomNote} onChange={(event) => fishy.setRansomNote(event.target.checked)} />
          {FISHY.noticed.ransom}
        </label>
        {canReveal && (
          <button type="button" className="button button-small fishy-reveal" onClick={fishy.reveal}>
            {REVEAL_LABEL}
          </button>
        )}
      </DetailsDisclosure>
    </StepFrame>
  );
}
