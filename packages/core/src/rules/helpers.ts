import type { Evidence, EvidenceUnit } from "../domain/finding";
import type { RuleOutcome } from "../domain/rule";
import type {
  Os,
  Section,
  SectionKey,
  SystemState,
  SystemStateSections,
  Tri,
  UnavailableReason,
} from "../domain/system-state";

export const MACOS_ONLY: readonly Os[] = ["macos"];

/** Shape of each section's ok payload, keyed by section name. */
export type SectionDataMap = {
  readonly [K in SectionKey]: SystemStateSections[K] extends Section<infer T> ? T : never;
};

/** Returns a section's data. Throws when it is unavailable; the engine's requires check prevents that. */
export function section<K extends SectionKey>(state: SystemState, key: K): SectionDataMap[K] {
  const s = state.sections[key];
  if (s.status !== "ok") {
    throw new Error(`section ${key} is unavailable`);
  }
  return s.data as SectionDataMap[K];
}

/** Evidence values a Tri setting can take once rendered as an enum. */
export const TRI_VOCABULARY: readonly string[] = ["true", "false", "unset"];

export const VERSION_PATTERN = /^[0-9][0-9A-Za-z.-]{0,31}$/;

export const ev = {
  bool(key: string, label: string, value: boolean): Evidence {
    return { key, label, value: { kind: "bool", value } };
  },
  number(key: string, label: string, value: number, unit: EvidenceUnit | null = null): Evidence {
    return { key, label, value: { kind: "number", value, unit } };
  },
  enum(key: string, label: string, value: string): Evidence {
    return { key, label, value: { kind: "enum", value } };
  },
  /** Emits version kind only when the string looks like a version; anything else stays local as text. */
  version(key: string, label: string, value: string): Evidence {
    const kind = VERSION_PATTERN.test(value) ? "version" : "text";
    return { key, label, value: { kind, value } };
  },
  path(key: string, label: string, value: string): Evidence {
    return { key, label, value: { kind: "path", value } };
  },
  text(key: string, label: string, value: string): Evidence {
    return { key, label, value: { kind: "text", value } };
  },
  tri(key: string, label: string, value: Tri): Evidence {
    return { key, label, value: { kind: "enum", value: value === "unset" ? "unset" : String(value) } };
  },
};

export function pass(evidence: readonly Evidence[] = []): RuleOutcome {
  return { status: "pass", evidence };
}

export function fail(evidence: readonly Evidence[] = []): RuleOutcome {
  return { status: "fail", evidence };
}

export function review(evidence: readonly Evidence[] = []): RuleOutcome {
  return { status: "review", evidence };
}

export function unknown(
  reason: UnavailableReason | "indeterminate",
  evidence: readonly Evidence[] = [],
): RuleOutcome {
  return { status: "unknown", reason, evidence };
}

export function notApplicable(evidence: readonly Evidence[] = []): RuleOutcome {
  return { status: "not_applicable", evidence };
}

/** A Tri passes "not false" for true and "unset". */
export function notFalse(value: Tri): boolean {
  return value !== false;
}

/** Hours between two ISO timestamps, or null when either does not parse. */
export function hoursBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return null;
  }
  return (to - from) / 3_600_000;
}
