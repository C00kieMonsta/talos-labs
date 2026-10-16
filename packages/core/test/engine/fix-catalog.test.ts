import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SectionKey } from "../../src/domain/system-state";
import { SECTION_KEYS } from "../../src/domain/system-state";
import { fixCatalogEntries, fixCatalogJson } from "../../src/rules/fix-catalog";
import { MACOS_CATALOG } from "../../src/rules/macos/index";

const FILE = join(__dirname, "..", "..", "fixtures", "fix-catalog.json");

/** Sections a rule's commands change beyond what it reads. */
const COMMAND_SIDE_EFFECTS: Readonly<Record<string, readonly SectionKey[]>> = {
  "TL-MAC-019": ["listeners"],
  "TL-MAC-020": ["listeners"],
  "TL-MAC-021": ["listeners"],
  "TL-MAC-022": ["listeners"],
};

describe("FixApply catalog invariants", () => {
  it("every in_app rule has a confirm title ending in a question mark and a verb", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const apply = rule.fix.apply;
      if (apply.kind !== "in_app") {
        continue;
      }
      expect(apply.confirmTitle.trim().length, rule.id).toBeGreaterThan(0);
      expect(apply.confirmTitle.endsWith("?"), rule.id).toBe(true);
      expect(apply.confirmVerb.trim().length, rule.id).toBeGreaterThan(0);
      expect(apply.confirmVerb.endsWith("..."), rule.id).toBe(false);
    }
  });

  it("recheck is a subset of requires plus the sections the commands change, and never empty", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const apply = rule.fix.apply;
      if (apply.kind !== "in_app") {
        continue;
      }
      const allowed = new Set<SectionKey>([...rule.requires, ...(COMMAND_SIDE_EFFECTS[rule.id] ?? [])]);
      expect(apply.recheck.length, rule.id).toBeGreaterThan(0);
      for (const section of apply.recheck) {
        expect(allowed.has(section), `${rule.id} rechecks ${section}`).toBe(true);
      }
      expect(new Set(apply.recheck).size, rule.id).toBe(apply.recheck.length);
    }
  });

  it("019 to 022 recheck listeners as well as their own section", () => {
    for (const id of Object.keys(COMMAND_SIDE_EFFECTS)) {
      const rule = MACOS_CATALOG.rules.find((r) => r.id === id);
      expect(rule?.fix.apply.kind, id).toBe("in_app");
      if (rule?.fix.apply.kind === "in_app") {
        expect(rule.fix.apply.recheck, id).toContain("listeners");
      }
    }
  });

  it("every deep_link names a pane that matches the fix's settingsPane", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const apply = rule.fix.apply;
      if (apply.kind !== "deep_link") {
        continue;
      }
      expect(apply.pane.length, rule.id).toBeGreaterThan(0);
      expect(rule.fix.settingsPane, rule.id).toBe(apply.pane);
    }
  });

  it("every watch section exists and the interval is positive", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const apply = rule.fix.apply;
      if (apply.kind === "in_app") {
        continue;
      }
      for (const section of apply.watch) {
        expect(SECTION_KEYS, `${rule.id} watches ${section}`).toContain(section);
      }
      expect(apply.watchEvery, rule.id).toBeGreaterThan(0);
    }
  });

  it("only 029 asks for a passphrase and only ssh_key or all_ssh_keys choices do", () => {
    for (const rule of MACOS_CATALOG.rules) {
      const apply = rule.fix.apply;
      if (apply.kind !== "in_app") {
        continue;
      }
      expect(apply.passphrase, rule.id).toBe(rule.id === "TL-MAC-029");
      if (apply.passphrase) {
        expect(["ssh_key", "all_ssh_keys"], rule.id).toContain(apply.choice);
      }
    }
  });
});

describe("packages/core/fixtures/fix-catalog.json", () => {
  it("has one entry per rule in catalog order", () => {
    const entries = fixCatalogEntries(MACOS_CATALOG);
    expect(entries.map((e) => e.ruleId)).toEqual(MACOS_CATALOG.rules.map((r) => r.id));
    for (const entry of entries) {
      expect(Object.keys(entry)).toEqual(["ruleId", "kind", "choice", "passphrase", "needsPassword", "recheck", "pane", "watch"]);
    }
  });

  it("matches the committed file (run pnpm fixtures:emit otherwise)", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).toBe(fixCatalogJson(MACOS_CATALOG));
    expect(JSON.parse(text)).toEqual(fixCatalogEntries(MACOS_CATALOG));
  });

  it("matches the snapshot", () => {
    expect(fixCatalogEntries(MACOS_CATALOG)).toMatchSnapshot();
  });
});
