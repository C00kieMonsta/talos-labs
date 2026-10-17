import type { ActivityEvent, ActivityStrings } from "@talos/core";
import { activityLabel } from "@talos/core";
import { ICONS } from "../app/icons";
import { WATCH_PROBE_LABELS } from "../app/labels";
import { Icon } from "../components/Icon";
import { GUIDED_SECTION_LABELS } from "../guided/copy";
import { activityWord } from "./activityWord";
import { ACTIVITY } from "./copy";

/** The desktop's strings for core's activityLabel. */
export const ACTIVITY_STRINGS: ActivityStrings = {
  preparing: ACTIVITY.rows.preparing,
  batchAdmin: ACTIVITY.rows.batchAdmin,
  checking: ACTIVITY.rows.checking,
  watching: ACTIVITY.rows.watching,
  watchCheck: ACTIVITY.rows.watchCheck,
  verbs: ACTIVITY.verbs,
  probes: WATCH_PROBE_LABELS,
  sections: GUIDED_SECTION_LABELS,
};

function RowIcon({ row, word }: { row: ActivityEvent; word: string }) {
  switch (row.status) {
    case "running":
      // No motion while macOS's own dialog is up: the key is static.
      if (word === ACTIVITY.words.password) return <Icon icon={ICONS.password} size={20} className="activity-key" />;
      return <Icon icon={ICONS.spinner} size={20} className="spin" />;
    case "done":
      return <Icon icon={ICONS.check} size={20} className="guided-tick" />;
    case "failed":
      return <Icon icon={ICONS.close} size={20} />;
  }
}

/**
 * The activity rows under a working step or card: icon slot, authored label, visible state word.
 * `announce` adds one visually-hidden status line for the newest row; the rows themselves carry no live region.
 */
export function ActivityList({ rows, listClass, announce = false }: { rows: readonly ActivityEvent[]; listClass: "guided-activity" | "chat-activity"; announce?: boolean }) {
  const newest = rows[rows.length - 1] ?? null;
  return (
    <>
      <ul className={listClass} role="list">
        {rows.map((row) => {
          const word = activityWord(row);
          return (
            <li key={row.id} className="chat-activity-row" data-state={row.status} data-activity={row.kind}>
              <span className="activity-icon" aria-hidden="true">
                <RowIcon row={row} word={word} />
              </span>
              <span className="activity-label">{activityLabel(row, ACTIVITY_STRINGS)}</span>
              <span className="activity-word">{word}</span>
            </li>
          );
        })}
      </ul>
      {announce && newest !== null && (
        <p className="visually-hidden guided-activity-status" role="status">
          {activityLabel(newest, ACTIVITY_STRINGS)}, {activityWord(newest)}
        </p>
      )}
    </>
  );
}
