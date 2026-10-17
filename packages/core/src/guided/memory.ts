import type { RuleId } from "../domain/finding";
import type { ExplainerId } from "../ports/explainer-port";

export type PermissionKind = "full_disk_access" | "automation";

/** localStorage["talos.guided"]. Only rule ids and dates; no rule text, paths or evidence. */
export interface GuidedMemory {
  readonly version: 1;
  /** ruleId -> ISO until. */
  readonly snoozed: Readonly<Record<string, string>>;
  readonly laterCount: Readonly<Record<string, number>>;
  /** Watcher timed out: ruleId -> ISO until. */
  readonly waiting: Readonly<Record<string, string>>;
  readonly pendingRestart: readonly RuleId[];
  readonly paywallSnoozedUntil: string | null;
  readonly permissionAskedAt: Readonly<Partial<Record<PermissionKind, string>>>;
  /** ISO when the person last said "Not now" to connecting an AI; null when never. */
  readonly aiAskedAt: string | null;
  /** ruleId -> ISO when the person said "Leave it alone, I know the risk". */
  readonly accepted: Readonly<Record<string, string>>;
  /** The last settled probe that answered available: which provider and when. The chat home reads it at boot. */
  readonly aiLastAvailable: AiLastAvailable | null;
}

export type AiProviderId = Exclude<ExplainerId, "none">;

export interface AiLastAvailable {
  readonly provider: AiProviderId;
  readonly at: string;
}

export const EMPTY_GUIDED_MEMORY: GuidedMemory = {
  version: 1,
  snoozed: {},
  laterCount: {},
  waiting: {},
  pendingRestart: [],
  paywallSnoozedUntil: null,
  permissionAskedAt: {},
  aiAskedAt: null,
  accepted: {},
  aiLastAvailable: null,
};

/** How long a stored "available" keeps the chat as the home without a fresh probe. */
export const AI_LAST_AVAILABLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** True when the stored availability names `provider` and is less than the TTL old. */
export function aiAvailableRecently(memory: Pick<GuidedMemory, "aiLastAvailable">, provider: AiProviderId, now: string): boolean {
  const stored = memory.aiLastAvailable;
  if (stored === null || stored.provider !== provider) return false;
  const at = Date.parse(stored.at);
  const current = Date.parse(now);
  if (Number.isNaN(at) || Number.isNaN(current)) return false;
  return current - at < AI_LAST_AVAILABLE_TTL_MS;
}

/** How long "Not now" on the AI connect screen is honoured. */
export const AI_ASK_AGAIN_MS = 14 * 24 * 60 * 60 * 1000;

/** True when aiAskedAt is set and less than AI_ASK_AGAIN_MS before now. */
export function aiAskedRecently(memory: Pick<GuidedMemory, "aiAskedAt">, now: string): boolean {
  if (memory.aiAskedAt === null) return false;
  const asked = Date.parse(memory.aiAskedAt);
  const at = Date.parse(now);
  if (Number.isNaN(asked) || Number.isNaN(at)) return false;
  return at - asked < AI_ASK_AGAIN_MS;
}

const PERMISSION_KINDS: readonly PermissionKind[] = ["full_disk_access", "automation"];
const AI_PROVIDER_IDS: readonly AiProviderId[] = ["apple", "chatgpt", "claude_plan", "claude", "ollama"];
const RULE_ID = /^TL-(MAC|WIN|LNX|ANY)-[A-Za-z0-9]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isRuleId(value: unknown): value is RuleId {
  return typeof value === "string" && RULE_ID.test(value);
}

function dateMap(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, until] of Object.entries(value)) {
    if (isRuleId(key) && isIsoDate(until)) {
      out[key] = until;
    }
  }
  return out;
}

function countMap(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (isRuleId(key) && typeof count === "number" && Number.isInteger(count) && count >= 0) {
      out[key] = count;
    }
  }
  return out;
}

function ruleIdList(value: unknown): readonly RuleId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter(isRuleId))];
}

function permissionMap(value: unknown): Readonly<Partial<Record<PermissionKind, string>>> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Partial<Record<PermissionKind, string>> = {};
  for (const kind of PERMISSION_KINDS) {
    const at = value[kind];
    if (isIsoDate(at)) {
      out[kind] = at;
    }
  }
  return out;
}

function aiLastAvailableOf(value: unknown): AiLastAvailable | null {
  if (!isRecord(value)) {
    return null;
  }
  const { provider, at } = value;
  if (typeof provider !== "string" || !(AI_PROVIDER_IDS as readonly string[]).includes(provider) || !isIsoDate(at)) {
    return null;
  }
  return { provider: provider as AiProviderId, at };
}

/** Field by field with fallbacks, like parseSettings. A wrong version or a non-object yields the empty memory. */
export function parseGuidedMemory(raw: unknown): GuidedMemory {
  if (!isRecord(raw) || raw.version !== 1) {
    return EMPTY_GUIDED_MEMORY;
  }
  return {
    version: 1,
    snoozed: dateMap(raw.snoozed),
    laterCount: countMap(raw.laterCount),
    waiting: dateMap(raw.waiting),
    pendingRestart: ruleIdList(raw.pendingRestart),
    paywallSnoozedUntil: isIsoDate(raw.paywallSnoozedUntil) ? raw.paywallSnoozedUntil : null,
    permissionAskedAt: permissionMap(raw.permissionAskedAt),
    aiAskedAt: isIsoDate(raw.aiAskedAt) ? raw.aiAskedAt : null,
    accepted: dateMap(raw.accepted),
    aiLastAvailable: aiLastAvailableOf(raw.aiLastAvailable),
  };
}
