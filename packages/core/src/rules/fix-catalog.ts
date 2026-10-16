import type { FixApplyChoice, RuleId, SettingsPane } from "../domain/finding";
import type { RuleCatalog } from "../domain/rule";
import type { SectionKey } from "../domain/system-state";

/** One row per rule in fix-catalog.json, the contract the Rust FIX_CATALOG test reads. */
export interface FixCatalogEntry {
  readonly ruleId: RuleId;
  readonly kind: "in_app" | "deep_link" | "manual";
  /** in_app only; null otherwise. */
  readonly choice: FixApplyChoice | null;
  readonly passphrase: boolean;
  readonly needsPassword: boolean;
  /** in_app only; empty otherwise. */
  readonly recheck: readonly SectionKey[];
  /** deep_link only; null otherwise. */
  readonly pane: SettingsPane | null;
  /** deep_link and manual only; empty otherwise. */
  readonly watch: readonly SectionKey[];
}

export function fixCatalogEntries(catalog: RuleCatalog): FixCatalogEntry[] {
  return catalog.rules.map((rule) => {
    const apply = rule.fix.apply;
    switch (apply.kind) {
      case "in_app":
        return {
          ruleId: rule.id,
          kind: "in_app",
          choice: apply.choice,
          passphrase: apply.passphrase,
          needsPassword: apply.needsPassword,
          recheck: apply.recheck,
          pane: null,
          watch: [],
        };
      case "deep_link":
        return { ruleId: rule.id, kind: "deep_link", choice: null, passphrase: false, needsPassword: false, recheck: [], pane: apply.pane, watch: apply.watch };
      case "manual":
        return { ruleId: rule.id, kind: "manual", choice: null, passphrase: false, needsPassword: false, recheck: [], pane: null, watch: apply.watch };
    }
  });
}

/** The JSON written to packages/core/fixtures/fix-catalog.json. Keys stay in declaration order. */
export function fixCatalogJson(catalog: RuleCatalog): string {
  return `${JSON.stringify(fixCatalogEntries(catalog), null, 2)}\n`;
}
