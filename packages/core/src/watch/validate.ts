import { containsCommandText } from "../explainer/validate";
import type { ExplainerResult } from "../ports/explainer-port";
import type { ActionId, ModelProbeId, Rating, SignalId, WatchContext, WatchVerdict } from "../ports/watch-port";
import { RATING_ORDER, RUST_PROBE_IDS, WATCH_LIMITS } from "../ports/watch-port";
import { PLAYBOOK, type PlaybookAction } from "./playbook";
import { maxRating, minRating } from "./rate";

/** A token that reads like a path: a slash or tilde followed by a path character. */
export const PATH_LIKE = /[~/][A-Za-z0-9._-]/;
/** A token that reads like a port. */
export const PORT_LIKE = /:[0-9]{2,5}\b/;
/** Words a model sentence may never carry: they read as an instruction to act on a program. */
export const BANNED_VERBS = /\b(pid|process|kill|delete|remove|rm|unload)\b/i;

const REJECTED: ExplainerResult<never> = { ok: false, reason: "rejected_output" };

class Rejected extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the text may be shown: no command text, no path, no port, none of the banned verbs. */
export function safeSentence(text: string): boolean {
  if (text.length > WATCH_LIMITS.maxReasonChars) return false;
  if (containsCommandText(text)) return false;
  if (PATH_LIKE.test(text) || PORT_LIKE.test(text) || BANNED_VERBS.test(text)) return false;
  return true;
}

/** A string is kept when safe and dropped to "" otherwise; anything but a string rejects the verdict. */
function readSentence(value: unknown): string {
  if (typeof value !== "string") throw new Rejected();
  return safeSentence(value) ? value : "";
}

function readList(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Rejected();
  return value;
}

function readId<T extends string>(value: unknown, known: readonly T[], seen: Set<string>): T {
  if (typeof value !== "string" || !(known as readonly string[]).includes(value) || seen.has(value)) throw new Rejected();
  seen.add(value);
  return value as T;
}

function triggered(row: PlaybookAction, context: WatchContext): boolean {
  return context.signals.some((s) => s.change !== "same" && row.triggers.includes(s.signalId));
}

/**
 * Rating in the enum, then clamped between the context's floor and ceiling; every id in the
 * matching list of the context; duplicates and over-cap lists rejected; the two Rust-only probes
 * rejected. An action is dropped (the verdict kept) when its row's floor is above the clamped
 * rating or none of its triggers changed. Each sentence is dropped to "" when unsafe.
 */
export function validateWatchVerdict(raw: unknown, context: WatchContext, playbook: readonly PlaybookAction[] = PLAYBOOK): ExplainerResult<WatchVerdict> {
  try {
    if (!isRecord(raw)) throw new Rejected();
    const rating = raw["rating"];
    if (typeof rating !== "string" || !RATING_ORDER.includes(rating as Rating)) throw new Rejected();
    const clamped = maxRating(context.floor, minRating(rating as Rating, context.ceiling));
    const ratingReason = readSentence(raw["ratingReason"]);
    const signalIds: readonly SignalId[] = context.signals.map((s) => s.signalId);
    const seenSignals = new Set<string>();
    const basedOn = readList(raw["basedOn"], WATCH_LIMITS.maxBasedOn).map((id) => readId(id, signalIds, seenSignals));
    const probeIds: readonly ModelProbeId[] = context.probesAvailable.filter((id) => !RUST_PROBE_IDS.includes(id));
    const seenProbes = new Set<string>();
    const probes = readList(raw["probes"], WATCH_LIMITS.maxProbes).map((entry) => {
      if (!isRecord(entry)) throw new Rejected();
      return { probeId: readId(entry["probeId"], probeIds, seenProbes), reason: readSentence(entry["reason"]) };
    });
    const actionIds: readonly ActionId[] = context.actionsAvailable;
    const seenActions = new Set<string>();
    const actions: { actionId: ActionId; sentence: string }[] = [];
    for (const entry of readList(raw["actions"], WATCH_LIMITS.maxActions)) {
      if (!isRecord(entry)) throw new Rejected();
      const actionId = readId(entry["actionId"], actionIds, seenActions);
      const sentence = readSentence(entry["sentence"]);
      const row = playbook.find((r) => r.id === actionId);
      if (row === undefined) throw new Rejected();
      if (RATING_ORDER.indexOf(row.floor) > RATING_ORDER.indexOf(clamped)) continue;
      if (!triggered(row, context)) continue;
      actions.push({ actionId, sentence });
    }
    return { ok: true, value: { rating: clamped, ratingReason, basedOn, probes, actions } };
  } catch (error) {
    if (error instanceof Rejected) return REJECTED;
    throw error;
  }
}
