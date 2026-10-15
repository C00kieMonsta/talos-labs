import { describe, expect, it } from "vitest";
import type { EvidenceValue, RuleResult, RuleStatus, UnknownReason } from "../src/domain/finding";
import type { Rule, RuleContext } from "../src/domain/rule";
import type { Os, SectionKey, SystemState, UnavailableReason } from "../src/domain/system-state";
import { evaluateRule } from "../src/engine/evaluate";
import { ALL_UNAVAILABLE } from "../src/fixtures/all-unavailable";
import { HARDENED } from "../src/fixtures/hardened";
import { WINDOWS_MINIMAL } from "../src/fixtures/windows-minimal";
import type { SectionDataMap } from "../src/rules/helpers";

export const NOW = "2026-10-15T10:00:00.000Z";

export function ctxFor(state: SystemState, os: Os = state.host.os): RuleContext {
  return { now: NOW, os };
}

export function withSection<K extends SectionKey>(state: SystemState, key: K, data: SectionDataMap[K]): SystemState {
  return { ...state, sections: { ...state.sections, [key]: { status: "ok", data } } };
}

export function withUnavailable(state: SystemState, key: SectionKey, reason: UnavailableReason): SystemState {
  return { ...state, sections: { ...state.sections, [key]: { status: "unavailable", reason, detail: null } } };
}

/** Patches an ok section's data. Throws when the base section is unavailable. */
export function patchSection<K extends SectionKey>(
  state: SystemState,
  key: K,
  patch: Partial<SectionDataMap[K]>,
): SystemState {
  const current = state.sections[key];
  if (current.status !== "ok") {
    throw new Error(`fixture section ${key} is unavailable`);
  }
  return withSection(state, key, Object.assign({}, current.data, patch) as SectionDataMap[K]);
}

export function runRule(rule: Rule, state: SystemState, os?: Os): RuleResult {
  return evaluateRule(rule, state, ctxFor(state, os));
}

export function keysOf(result: RuleResult): string[] {
  return result.evidence.map((entry) => entry.key);
}

export function kindsOf(result: RuleResult): EvidenceValue["kind"][] {
  return result.evidence.map((entry) => entry.value.kind);
}

export interface Row {
  readonly name: string;
  readonly state: SystemState;
  readonly os?: Os;
  readonly status: RuleStatus;
  readonly reason?: UnknownReason;
  /** Exact evidence keys in order. */
  readonly keys?: readonly string[];
  /** Exact evidence kinds in order. */
  readonly kinds?: readonly EvidenceValue["kind"][];
}

/** Table runner: the given rows plus the unavailable, all-unavailable and windows rows every rule must satisfy. */
export function describeRule(rule: Rule, rows: readonly Row[]): void {
  const firstRequired = rule.requires[0];
  if (firstRequired === undefined) {
    throw new Error(`${rule.id} declares no requires`);
  }
  const allUnavailableSection = ALL_UNAVAILABLE.sections[firstRequired];
  const standard: Row[] = [
    {
      name: `unknown with the section reason when ${firstRequired} is unavailable`,
      state: withUnavailable(HARDENED, firstRequired, "permission_denied"),
      status: "unknown",
      reason: "permission_denied",
      keys: [],
    },
    {
      name: "unknown on all-unavailable with the first requires reason",
      state: ALL_UNAVAILABLE,
      status: "unknown",
      reason: allUnavailableSection.status === "unavailable" ? allUnavailableSection.reason : "collector_error",
      keys: [],
    },
    {
      name: "not applicable on windows-minimal",
      state: WINDOWS_MINIMAL,
      status: "not_applicable",
      keys: [],
    },
    {
      name: "not applicable when ctx.os is linux even with macOS data",
      state: HARDENED,
      os: "linux",
      status: "not_applicable",
      keys: [],
    },
  ];
  describe(rule.id, () => {
    for (const row of [...rows, ...standard]) {
      it(row.name, () => {
        const result = runRule(rule, row.state, row.os);
        expect(result.ruleId).toBe(rule.id);
        expect(result.status).toBe(row.status);
        expect(result.unknownReason).toBe(row.reason ?? null);
        if (row.keys !== undefined) {
          expect(keysOf(result)).toEqual(row.keys);
        }
        if (row.kinds !== undefined) {
          expect(kindsOf(result)).toEqual(row.kinds);
        }
        for (const key of keysOf(result)) {
          expect(rule.evidenceKeys).toContain(key);
        }
        if (row.status === "fail") {
          expect(result.points).toBeGreaterThanOrEqual(0);
        } else {
          expect(result.points).toBe(0);
        }
      });
    }
  });
}
