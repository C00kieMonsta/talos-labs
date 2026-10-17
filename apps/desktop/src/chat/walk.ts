import type { GuidedStep } from "@talos/core";
import { ACTIVITY } from "../guided/copy";
import { guidedFor, ruleIdsOf } from "../guided/plan";
import type { ChatMessage, WalkChecklist, WalkRow } from "./state";

/** The "Do them all" checklist (docs/DESIGN-AGENT.md 2c): one row per undone step, a batch expanded to its rules, read off the card messages. */

type Card = Extract<ChatMessage, { kind: "card" }>;

/** The rows at the walk's start: every undone step, all pending, in plan order. */
export function walkChecklist(steps: readonly GuidedStep[]): WalkChecklist {
  const rows: WalkRow[] = [];
  for (const step of steps) {
    if (step.kind === "paywall") continue;
    for (const ruleId of ruleIdsOf(step)) rows.push({ stepId: step.id, ruleId, text: guidedFor(ruleId).headline, icon: "pending" });
  }
  return { done: 0, of: rows.length, rows };
}

/** The newest card drawn for the step, or null. */
function cardForStep(messages: readonly ChatMessage[], stepId: string): Card | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.kind === "card" && m.step?.id === stepId) return m;
  }
  return null;
}

function rowFor(row: WalkRow, card: Card | null): WalkRow {
  const base: WalkRow = { stepId: row.stepId, ruleId: row.ruleId, text: row.text, icon: "pending" };
  if (card === null) return base;
  switch (card.state) {
    case "idle":
      return card.live ? { ...base, icon: "running" } : base;
    case "working":
      // A show card whose pane is open waits for the person; the walk does not move on by itself.
      return card.card.kind === "show" && card.result !== null ? { ...base, icon: "running", tag: ACTIVITY.rows.waitingForYou } : { ...base, icon: "running" };
    case "resolved": {
      if (card.outcome === "snoozed") return { ...base, tag: ACTIVITY.rows.anotherDay };
      const done = card.rows.find((r) => r.ruleId === row.ruleId);
      if (done !== undefined) return { ...base, icon: done.ok ? "ok" : "failed", ...(done.tag === undefined ? {} : { tag: done.tag }) };
      return card.outcome === "fixed" || card.outcome === "watch_passed" || card.outcome === "checked" ? { ...base, icon: "ok" } : { ...base, icon: "failed" };
    }
    case "failed": {
      const done = card.rows.find((r) => r.ruleId === row.ruleId);
      return { ...base, icon: "failed", ...(done?.tag === undefined ? {} : { tag: done.tag }) };
    }
    case "stale":
      return base;
  }
}

/** The checklist with every row's icon and tag read off the cards; `done` counts the ticked rows. */
export function syncWalk(checklist: WalkChecklist, messages: readonly ChatMessage[]): WalkChecklist {
  const rows = checklist.rows.map((row) => rowFor(row, cardForStep(messages, row.stepId)));
  return { done: rows.filter((r) => r.icon === "ok").length, of: checklist.of, rows };
}

/** A row the person can still act on in this walk: running, or pending with no "Another day" tag. */
export function openWalkRow(row: WalkRow): boolean {
  return row.icon === "running" || (row.icon === "pending" && row.tag === undefined);
}

/** Settled and put-off rows fold into the progress line; the live step's rows (a batch is several) and the next two show, the rest is "and {n} more". */
export function visibleWalkRows(checklist: WalkChecklist): { rows: readonly WalkRow[]; more: number } {
  const open = checklist.rows.filter(openWalkRow);
  const running = open.filter((r) => r.icon === "running");
  const pending = open.filter((r) => r.icon === "pending");
  const rows = [...running, ...pending.slice(0, 2)];
  return { rows, more: open.length - rows.length };
}

export function sameChecklist(a: WalkChecklist, b: WalkChecklist): boolean {
  return a.done === b.done && a.of === b.of && a.rows.length === b.rows.length && a.rows.every((r, i) => r.icon === b.rows[i]?.icon && r.tag === b.rows[i]?.tag && r.stepId === b.rows[i]?.stepId);
}
