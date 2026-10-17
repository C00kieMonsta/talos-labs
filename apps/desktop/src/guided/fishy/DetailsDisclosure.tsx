import type { ReactNode } from "react";
import type { ActionId, WatchDetailsItem, WatchModelProvider } from "@talos/core";
import { playbookRow } from "@talos/core";
import { AI_BADGES, DECIDED_BY_APP } from "../../app/labels";
import { FISHY } from "../copy";
import { useFishyController } from "./controller";

/** The local text of a details row: the start-up entry, the program, the port or the process, as plain words. */
export function detailLines(row: WatchDetailsItem | null): readonly string[] {
  if (row === null) return [];
  const lines: string[] = [];
  if (row.label !== undefined) lines.push(row.label);
  if (row.plistPath !== undefined) lines.push(row.plistPath);
  if (row.programPath !== undefined) lines.push(row.programPath);
  if (row.port !== undefined) lines.push(`Port ${row.port}`);
  if (row.processName !== undefined) lines.push(row.processName);
  return lines;
}

export interface DetailsDisclosureProps {
  /** The playbook row this screen stands on: its phase word, outcome id and source URL. */
  readonly actionId: ActionId | null;
  /** The item's details row; its text is shown here and nowhere else. */
  readonly row?: WatchDetailsItem | null;
  /** The model's sentence for an Advise row, under its badge; null shows "Decided by the app itself". */
  readonly model?: { readonly sentence: string | null; readonly provider: WatchModelProvider | null } | null;
  /** Controlled by a row button on screen 5; uncontrolled with its own summary elsewhere. */
  readonly open?: boolean;
  readonly children?: ReactNode;
}

/** The "Details" disclosure: machine text as local words, the playbook's "What experts do" line, the phase and outcome, and the source button that opens the URL from Rust. */
export function DetailsDisclosure({ actionId, row = null, model, open, children }: DetailsDisclosureProps) {
  const fishy = useFishyController();
  const playbook = actionId === null ? undefined : playbookRow(actionId);
  const controlled = open !== undefined;
  const lines = detailLines(row);
  return (
    <details className="guided-explain fishy-details" open={controlled ? open : undefined}>
      <summary className={controlled ? "visually-hidden" : undefined}>{FISHY.noticed.details}</summary>
      <div className="guided-explain-body">
        {lines.length > 0 && (
          <ul className="fishy-detail-lines">
            {lines.map((line) => (
              <li key={line} className="mono">
                {line}
              </li>
            ))}
          </ul>
        )}
        {model !== undefined && model !== null && (
          <>
            {model.sentence !== null && <p className="fishy-model">{model.sentence}</p>}
            <p className="guided-meta guided-explain-badge">{model.provider === null || model.sentence === null ? DECIDED_BY_APP : AI_BADGES[model.provider]}</p>
          </>
        )}
        {children}
        {playbook !== undefined && (
          <>
            <p className="fishy-experts-do">{playbook.whatExpertsDo}</p>
            <p className="guided-meta fishy-phase">
              {playbook.phase}, {playbook.outcome}
            </p>
            <button type="button" className="fishy-source-button" onClick={() => fishy.openSource(playbook.id)}>
              {playbook.step}
            </button>
          </>
        )}
      </div>
    </details>
  );
}
