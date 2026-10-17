import type { ActivityEvent } from "@talos/core";
import { ActivityList } from "../activity/ActivityList";
import { useFixActivity } from "../activity/useActivity";
import type { FixingState } from "../scan/machine";

/**
 * The rows under a working or settled card: the fix rows from the scan machine (DESIGN-AGENT's timeline, read
 * through useFixActivity) plus the rows the chat adds itself (the watcher, the watch check). The rows carry no live region.
 */
export function ChatActivity({ cardId, fixing, preparing, extra }: { cardId: string; fixing: FixingState | null; preparing: boolean; extra: readonly ActivityEvent[] }) {
  const fixRows = useFixActivity(cardId, fixing, preparing);
  const rows = extra.length === 0 ? fixRows : [...fixRows, ...extra];
  if (rows.length === 0) return null;
  return <ActivityList rows={rows} listClass="chat-activity" />;
}

/** A watcher or watch-check row the chat owns; `kind` picks the label, `status` and `outcome` the word. */
export function chatActivityRow(cardId: string, kind: "watching" | "watch_check", status: ActivityEvent["status"], at: number, outcome: ActivityEvent["outcome"] = null, count: number | null = null): ActivityEvent {
  return { id: `${cardId}:${kind}`, cardId, kind, status, at, endedAt: status === "running" ? null : at, ruleId: null, count, step: null, of: null, probeId: null, sectionKey: null, outcome, modelLine: null };
}
