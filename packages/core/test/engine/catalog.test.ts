import { describe, expect, it } from "vitest";
import { SAFE_STRING_PATTERN } from "../../src/ports/explainer-port";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { unknownHeadline } from "../../src/engine/headline";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor } from "../helpers";

const FIXTURES = [DEV_MACHINE, HARDENED, FRESH_INSTALL];

/** Terminal and the tools the catalog's commands use. Reader-facing lines must not name them. */
const TERMINAL_OR_COMMAND =
  /\b(terminal|fdesetup|socketfilterfw|spctl|csrutil|sysadminctl|pwpolicy|chmod|launchctl|defaults|tmutil|softwareupdate|kickstart|ssh-keygen|lsof|ls -la)\b/i;

describe("macOS catalog invariants", () => {
  it("has 36 rules with unique ids TL-MAC-001 to TL-MAC-036 in order", () => {
    const ids = MACOS_CATALOG.rules.map((r) => r.id);
    expect(ids).toHaveLength(36);
    expect(new Set(ids).size).toBe(36);
    ids.forEach((id, index) => {
      expect(id).toBe(`TL-MAC-${String(index + 1).padStart(3, "0")}`);
      expect(id).toMatch(/^TL-(MAC|WIN|LNX|ANY)-\d{3}$/);
    });
  });

  it("pins the catalog version and benchmark edition", () => {
    expect(MACOS_CATALOG.version).toBe("0.3.0");
    expect(MACOS_CATALOG.cisEdition).toBe("CIS Apple macOS 26 Tahoe Benchmark v1.0.0");
  });

  it("every rule declares macos only and at least one required section", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(rule.os).toEqual(["macos"]);
      expect(rule.requires.length).toBeGreaterThan(0);
    }
  });

  it("every evidenceKeys entry matches SAFE_STRING_PATTERN and vocabulary keys are declared", () => {
    for (const rule of MACOS_CATALOG.rules) {
      for (const key of rule.evidenceKeys) {
        expect(key, `${rule.id} key ${key}`).toMatch(SAFE_STRING_PATTERN);
      }
      for (const [key, values] of Object.entries(rule.evidenceVocabulary)) {
        expect(rule.evidenceKeys, `${rule.id} vocabulary key ${key}`).toContain(key);
        for (const value of values) {
          expect(value).toMatch(SAFE_STRING_PATTERN);
        }
      }
    }
  });

  it("every evidence key emitted on the fixtures is declared and no enum is downgraded", () => {
    for (const state of FIXTURES) {
      for (const rule of MACOS_CATALOG.rules) {
        if (rule.requires.some((key) => state.sections[key].status !== "ok")) {
          continue;
        }
        const outcome = rule.evaluate(state, ctxFor(state));
        for (const entry of outcome.evidence) {
          expect(rule.evidenceKeys, `${rule.id} emitted ${entry.key}`).toContain(entry.key);
          expect(entry.label.length).toBeGreaterThan(0);
          if (entry.value.kind === "enum") {
            expect(rule.evidenceVocabulary[entry.key] ?? [], `${rule.id} enum ${entry.key}`).toContain(entry.value.value);
          }
        }
      }
    }
  });

  it("every rule has a non-empty explanation and fix steps, and British spelling", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(rule.explanation.trim().length, rule.id).toBeGreaterThan(40);
      expect(rule.fix.steps.length, rule.id).toBeGreaterThan(0);
      expect(rule.fix.summary.trim().length, rule.id).toBeGreaterThan(0);
      expect(rule.title.trim().length, rule.id).toBeGreaterThan(0);
      const text = [rule.explanation, rule.fix.summary, ...rule.fix.steps, rule.fix.verify ?? ""].join(" ");
      expect(text, rule.id).not.toMatch(/\b(license|color|center|organize|recognize)\b/i);
    }
  });

  it("every rule has a failTitle that states the problem, differs from the title, and is a bare sentence", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(rule.failTitle.trim().length, rule.id).toBeGreaterThan(0);
      expect(rule.failTitle, rule.id).not.toBe(rule.title);
      expect(rule.failTitle, rule.id).not.toMatch(/\.$/);
      expect(rule.failTitle, rule.id).not.toContain("\u2014");
      expect(rule.failTitle, rule.id).toMatch(/^[A-Z]/);
      expect(rule.failTitle, rule.id).not.toMatch(/\b(license|color|center|organize|recognize)\b/i);
    }
  });

  it("every title is a statement with a finite verb, so the unknown headline reads as a sentence", () => {
    const FINITE_VERB = /\b(is|are|can|stays|install|update|locks|points|opens|ran|came)\b/;
    for (const rule of MACOS_CATALOG.rules) {
      expect(rule.title, rule.id).toMatch(FINITE_VERB);
      expect(rule.title, rule.id).not.toMatch(/^\S+ (that|which) /);
      expect(unknownHeadline(rule.title), rule.id).toMatch(/^Couldn't check whether \S+ /);
    }
  });

  it("a fix with a Settings path and commands never points a step at a command or Terminal", () => {
    const MENTIONS_COMMAND = /\b(command|commands|terminal)\b/i;
    for (const rule of MACOS_CATALOG.rules) {
      if (rule.fix.settingsPath === null || rule.fix.commands.length === 0) {
        continue;
      }
      for (const step of rule.fix.steps) {
        expect(step, rule.id).not.toMatch(MENTIONS_COMMAND);
      }
    }
  });

  it("no verify line sends the reader to Terminal", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(rule.fix.verify ?? "", rule.id).not.toMatch(TERMINAL_OR_COMMAND);
    }
  });

  it("no fix summary names Terminal or a command-line tool, since every reader sees it", () => {
    for (const rule of MACOS_CATALOG.rules) {
      expect(rule.fix.summary, rule.id).not.toMatch(TERMINAL_OR_COMMAND);
    }
  });

  it("no step spells out a program that fix.commands already carries", () => {
    for (const rule of MACOS_CATALOG.rules) {
      for (const command of rule.fix.commands) {
        const program = new RegExp(`(^|\\s)${command.program.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
        for (const step of rule.fix.steps) {
          expect(step, `${rule.id} step names ${command.program}`).not.toMatch(program);
        }
      }
    }
  });

  it("fix commands with a placeholder name an evidence key; others have appliesTo null", () => {
    for (const rule of MACOS_CATALOG.rules) {
      for (const command of rule.fix.commands) {
        const hasPlaceholder = command.args.some((arg) => arg.includes("{path}"));
        if (hasPlaceholder) {
          expect(command.appliesTo, `${rule.id} ${command.program}`).not.toBeNull();
          expect(rule.evidenceKeys).toContain(command.appliesTo);
        } else {
          expect(command.appliesTo, `${rule.id} ${command.program}`).toBeNull();
        }
        expect(command.program).not.toMatch(/^sudo/);
      }
    }
  });

  it("matches the severity, category and CIS table in RULES.md", () => {
    const table: Record<string, [string, string, string | null]> = {
      "TL-MAC-001": ["critical", "encryption", "2.6.6"],
      "TL-MAC-002": ["high", "network", "2.2.1"],
      "TL-MAC-003": ["low", "network", "2.2.2"],
      "TL-MAC-004": ["high", "platform", "2.6.5"],
      "TL-MAC-005": ["high", "platform", "5.1.2"],
      "TL-MAC-006": ["medium", "platform", "5.10"],
      "TL-MAC-007": ["medium", "updates", "1.2"],
      "TL-MAC-008": ["medium", "updates", "1.3"],
      "TL-MAC-009": ["high", "updates", "1.5"],
      "TL-MAC-010": ["high", "updates", "1.1"],
      "TL-MAC-011": ["low", "updates", "1.4"],
      "TL-MAC-012": ["high", "access_control", "2.11.2"],
      "TL-MAC-013": ["medium", "access_control", "2.11.1"],
      "TL-MAC-014": ["low", "access_control", null],
      "TL-MAC-015": ["medium", "access_control", "2.13.1"],
      "TL-MAC-016": ["high", "access_control", "2.13.3"],
      "TL-MAC-017": ["info", "access_control", "5.2.2"],
      "TL-MAC-018": ["medium", "network", null],
      "TL-MAC-019": ["high", "remote_access", "2.3.3.4"],
      "TL-MAC-020": ["high", "remote_access", "2.3.3.1"],
      "TL-MAC-021": ["high", "remote_access", "2.3.3.5"],
      "TL-MAC-022": ["high", "sharing", "2.13.2"],
      "TL-MAC-023": ["info", "persistence", null],
      "TL-MAC-024": ["medium", "persistence", null],
      "TL-MAC-025": ["info", "persistence", null],
      "TL-MAC-026": ["medium", "backup", "2.3.4.1"],
      "TL-MAC-027": ["low", "backup", null],
      "TL-MAC-028": ["low", "browser", null],
      "TL-MAC-029": ["high", "developer", null],
      "TL-MAC-030": ["medium", "developer", null],
      "TL-MAC-031": ["high", "developer", null],
      "TL-MAC-032": ["medium", "sharing", "2.3.1.1"],
      "TL-MAC-033": ["medium", "remote_access", "2.3.3.6"],
      "TL-MAC-034": ["medium", "sharing", "2.3.3.7"],
      "TL-MAC-035": ["medium", "platform", null],
      "TL-MAC-036": ["medium", "persistence", null],
    };
    for (const rule of MACOS_CATALOG.rules) {
      expect([rule.severity, rule.category, rule.cis], rule.id).toEqual(table[rule.id]);
    }
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const rule of MACOS_CATALOG.rules) {
      bySeverity[rule.severity] += 1;
    }
    expect(bySeverity).toEqual({ critical: 1, high: 13, medium: 14, low: 5, info: 3 });
  });
});
