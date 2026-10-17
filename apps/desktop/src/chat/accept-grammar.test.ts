import { describe, expect, it } from "vitest";
import { MACOS_CATALOG } from "@talos/core";
import { ACCEPT_SYNONYMS, acceptMatches, acceptPhrase } from "./accept-grammar";
import { machineText } from "./guard";
import { planFor } from "./testing";

const PLAN = planFor(true);

describe("the accept grammar", () => {
  it("captures the phrase from each of the three patterns and nothing else", () => {
    expect(acceptPhrase("leave the disk alone")).toBe("the disk");
    expect(acceptPhrase("Skip FileVault")).toBe("FileVault");
    expect(acceptPhrase("I know about the firewall")).toBe("the firewall");
    expect(acceptPhrase("don't remind me about backups")).toBe("backups");
    expect(acceptPhrase("stop asking me about the firewall.")).toBe("the firewall");
    expect(acceptPhrase("why does the disk matter?")).toBeNull();
  });

  it("resolves each spec example to one id, in plan order, and 'leave it' to none", () => {
    expect(acceptMatches("leave the disk alone", PLAN)).toEqual(["TL-MAC-001"]);
    expect(acceptMatches("I know about the firewall", PLAN)).toEqual(["TL-MAC-002"]);
    expect(acceptMatches("don't remind me about backups", PLAN)).toEqual(["TL-MAC-026"]);
    expect(acceptMatches("skip FileVault", PLAN)).toEqual(["TL-MAC-001"]);
    expect(acceptMatches("leave it", PLAN)).toEqual([]);
    expect(acceptMatches("leave it alone", PLAN)).toEqual([]);
  });

  it("two items in one phrase give two ids in plan order; accepted and done steps are never named", () => {
    const two = acceptMatches("ignore the firewall and the disk", PLAN);
    expect(two).toEqual(["TL-MAC-002", "TL-MAC-001"]);
    expect(acceptMatches("leave the disk alone", { ...PLAN, accepted: ["TL-MAC-001"] })).toEqual([]);
    expect(acceptMatches("leave the firewall alone", PLAN, ["batch"])).toEqual([]);
  });

  it("every synonym key is a catalogue rule and every synonym is lower-case", () => {
    const ids = new Set(MACOS_CATALOG.rules.map((r) => r.id));
    for (const [id, synonyms] of Object.entries(ACCEPT_SYNONYMS)) {
      expect(ids.has(id as never), id).toBe(true);
      for (const s of synonyms ?? []) expect(s).toBe(s.toLowerCase());
    }
  });

  it("a path in the phrase is the guard's business, before the grammar", () => {
    expect(machineText("leave /Users/alice/Public alone")).toBe(true);
    expect(machineText("leave the disk alone")).toBe(false);
    expect(machineText("open port :8080")).toBe(true);
    expect(machineText("sudo rm -rf")).toBe(true);
    expect(machineText("Why does the disk matter?")).toBe(false);
  });
});
