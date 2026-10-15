import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSystemState } from "../../src/domain/system-state.guard";
import { FIXTURES } from "../../src/fixtures/index";

const DIR = join(__dirname, "..", "..", "fixtures");

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe("packages/core/fixtures/*.json", () => {
  it("has one file per fixture, up to date with the TypeScript source (run pnpm fixtures:emit otherwise)", () => {
    for (const [name, state] of Object.entries(FIXTURES)) {
      const text = readFileSync(join(DIR, `${name}.json`), "utf8");
      expect(text, name).toBe(`${JSON.stringify(sortKeys(state), null, 2)}\n`);
      const parsed: unknown = JSON.parse(text);
      expect(parsed).toEqual(state);
      expect(() => assertSystemState(parsed)).not.toThrow();
    }
  });

  it("covers all nine UnavailableReason values across the fixtures", () => {
    const reasons = new Set<string>();
    for (const state of Object.values(FIXTURES)) {
      for (const section of Object.values(state.sections)) {
        if (section.status === "unavailable") {
          reasons.add(section.reason);
        }
      }
    }
    expect([...reasons].sort()).toEqual(
      ["collector_error", "needs_admin", "needs_automation_permission", "needs_full_disk_access", "not_supported_on_os", "parse_error", "permission_denied", "timeout", "tool_missing"],
    );
  });
});
