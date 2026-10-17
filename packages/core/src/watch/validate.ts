import { containsCommandText } from "../explainer/validate";
import type { ExplainerResult } from "../ports/explainer-port";
import type { ActionId, ModelProbeId, Rating, SignalId, WatchContext, WatchVerdict } from "../ports/watch-port";
import { RATING_ORDER, RUST_PROBE_IDS, WATCH_LIMITS } from "../ports/watch-port";
import { PLAYBOOK, type PlaybookAction } from "./playbook";
import { maxRating, minRating } from "./rate";
import { WATCH_BANNED_PATTERN } from "./words";

/** A token that reads like a path: a slash or tilde at a word start followed by path characters; "and/or" passes. */
export const PATH_LIKE = /(^|[^A-Za-z0-9])[~/][A-Za-z0-9._-]+/;
/** A token that reads like a port: a colon not preceded by a digit, so "18:00" passes, or a dotted digit host before the colon, so "127.0.0.1:8080" does not. */
export const PORT_LIKE = /(^|[^0-9]):[0-9]{2,5}\b|\d\.\d+:[0-9]{2,5}\b/;
/** Words a model sentence may never carry: they read as an instruction to act on a program. */
export const BANNED_VERBS = /\b(pid|process|kill|delete|remove|rm|unload)\b/i;
/** The app's voice: a model line is written to the reader, never as the app. */
export const APP_VOICE = /\b(I'll|I've|I'm|I'd|me|my|mine|we|us|our|let's)\b/i;
/** The bare pronoun, case-sensitive so a lower-case "i" is not it; mirrors Rust APP_VOICE_I. */
export const APP_VOICE_I = /\bI\b/;
/** A rule, signal, probe or action id: the judge's vocabulary, never a word in the window. */
export const ID_LIKE = /\bTL-[A-Z]{3}-[A-Za-z0-9]+|\b(sig|probe|act)\.[a-z_]+\b/;
/** A claim that something was changed; the window runs nothing. */
export const ACTION_CLAIM = /(^\s*done\b|\bI've turned\b|\bhas been turned\b|\bis now (on|off)\b)/i;
/** A sentence that starts by telling the reader what to do. */
export const IMPERATIVE_START =
  /(^|[.!?]\s+)(click|press|open|go|run|type|turn|switch|tap|enable|disable|delete|remove|check|set|change|choose|select|install|uninstall|update|restart|lock|unlock|use|make|do|don't|start|stop)\b/i;
/** The words the window never says about the Mac. */
export const REASSURANCE = /\b(safe|safely|protected|secure|secured|clean|fine|all clear|no threat|no malware|no virus)\b/i;
/** A stated duration; the app shows the time, so a calm line may not. */
export const DURATION = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minutes?|hours?|days?|weeks?)\b/i;
/** A second sentence: a terminal stop, a space and any non-space character. */
export const SECOND_SENTENCE = /[.!?]\s+\S/;

const REJECTED: ExplainerResult<never> = { ok: false, reason: "rejected_output" };

class Rejected extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a probe reason or an action sentence may be shown: no command text, no path, no port, none of the banned verbs. */
export function safeSentence(text: string): boolean {
  if (text.length > WATCH_LIMITS.maxSentenceChars) return false;
  if (containsCommandText(text)) return false;
  if (PATH_LIKE.test(text) || PORT_LIKE.test(text) || BANNED_VERBS.test(text)) return false;
  return true;
}

/**
 * True when ratingReason may be drawn in the watch window: one sentence of at most 120
 * characters that passes safeSentence's checks, names no id, is not in the app's voice, claims no action,
 * gives no instruction, carries no banned or reassurance word and, on calm, states no duration.
 * Mirrors Rust safe_window_sentence; the windowSentences fixture pins both.
 */
export function safeWindowSentence(raw: string, rating: Rating): boolean {
  // One line only: a line break would hide a second sentence from the rules below.
  if (/[\n\r]/.test(raw)) return false;
  // Curly apostrophes fold to the ASCII one so "Don’t" and "Let’s" meet the same rules.
  // The rules run on the trimmed text, so a leading space never hides an imperative.
  const text = raw.replace(/[’ʼ]/g, "'").trim();
  if (text.length > WATCH_LIMITS.maxReasonChars || text.length === 0) return false;
  if (containsCommandText(text)) return false;
  if (PATH_LIKE.test(text) || PORT_LIKE.test(text) || BANNED_VERBS.test(text) || ID_LIKE.test(text)) return false;
  if (APP_VOICE_I.test(text) || APP_VOICE.test(text) || ACTION_CLAIM.test(text) || IMPERATIVE_START.test(text)) return false;
  if (WATCH_BANNED_PATTERN.test(text) || REASSURANCE.test(text)) return false;
  if (rating === "calm" && DURATION.test(text)) return false;
  if (SECOND_SENTENCE.test(text)) return false;
  return true;
}

/** A string is kept when safe and dropped to "" otherwise; anything but a string rejects the verdict. */
function readSentence(value: unknown, safe: (text: string) => boolean = safeSentence): string {
  if (typeof value !== "string") throw new Rejected();
  return safe(value) ? value : "";
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
 * rating or none of its triggers changed. ratingReason is dropped to "" unless it passes
 * safeWindowSentence for the clamped rating, and kept trimmed; probe reasons and action sentences unless safeSentence.
 */
export function validateWatchVerdict(raw: unknown, context: WatchContext, playbook: readonly PlaybookAction[] = PLAYBOOK): ExplainerResult<WatchVerdict> {
  try {
    if (!isRecord(raw)) throw new Rejected();
    const rating = raw["rating"];
    if (typeof rating !== "string" || !RATING_ORDER.includes(rating as Rating)) throw new Rejected();
    const clamped = maxRating(context.floor, minRating(rating as Rating, context.ceiling));
    const ratingReason = readSentence(raw["ratingReason"], (text) => safeWindowSentence(text, clamped)).trim();
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
