import { describe, expect, it } from "vitest";
import { MACOS_CATALOG } from "@talos/core";
import { ACTIVITY } from "./copy";

// The same list as guided/copy.test.ts; copied, not imported, while that file is held.
const BANNED = ["finding", "findings", "severity", "CIS", "rule", "rules", "policy", "configuration", "SSH", "launchd", "plist", "daemon", "sudo", "Terminal", "TCC", "stealth", "sysadminctl", "command", "points"];
const BANNED_PATTERN = new RegExp(`\\b(${BANNED.join("|")})\\b`, "i");

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe("ACTIVITY copy", () => {
  const all = strings(ACTIVITY);

  it("has no banned word, no em-dash and no exclamation mark", () => {
    expect(all.length).toBeGreaterThan(20);
    for (const text of all) {
      expect(text, text).not.toMatch(BANNED_PATTERN);
      expect(text, text).not.toContain("\u2014");
      expect(text, text).not.toContain("!");
    }
  });

  it("has one participle per catalogue verb and no extra", () => {
    const verbs = [...new Set(MACOS_CATALOG.rules.map((r) => r.guided.verb))].sort();
    expect([...Object.keys(ACTIVITY.verbs)].sort()).toEqual(verbs);
    for (const participle of Object.values(ACTIVITY.verbs)) expect(participle).toMatch(/ing\b/);
  });

  it("keeps the placeholders the renderer substitutes", () => {
    expect(ACTIVITY.rows.batchAdmin).toContain("{n}");
    expect(ACTIVITY.words.running).toContain("{i}");
    expect(ACTIVITY.words.running).toContain("{n}");
  });

  it("keeps every state word lower-case", () => {
    for (const word of Object.values(ACTIVITY.words)) expect(word).toBe(word.toLowerCase());
  });
});
