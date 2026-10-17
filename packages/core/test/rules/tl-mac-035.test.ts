import { describe, expect, it } from "vitest";
import type { FlaggedBundle, Section, AppsCheck } from "../../src/domain/system-state";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_035 } from "../../src/rules/macos/tl-mac-035";
import { describeRule, patchSection, runRule } from "../helpers";

function withApps(apps: Section<AppsCheck>) {
  return patchSection(HARDENED, "platformIntegrity", { apps });
}

function flagged(signature: FlaggedBundle["signature"], quarantined: boolean): FlaggedBundle {
  return { path: "/Applications/Helper.app", name: "Helper.app", signature, quarantined };
}

const ok = (list: readonly FlaggedBundle[]): Section<AppsCheck> => ({ status: "ok", data: { bundleCount: 40, checkedCount: 40, flagged: list } });

describeRule(TL_MAC_035, [
  { name: "pass when every bundle was checked and none is flagged", state: HARDENED, status: "pass", keys: ["bundleCount", "checkedCount", "flaggedCount"], kinds: ["number", "number", "number"] },
  {
    name: "fail on an unsigned bundle with no download mark",
    state: withApps(ok([flagged("unsigned", false)])),
    status: "fail",
    keys: ["bundleCount", "checkedCount", "flaggedCount", "bundlePath", "signature"],
    kinds: ["number", "number", "number", "path", "enum"],
  },
  { name: "pass with an adhoc bundle as evidence only", state: withApps(ok([flagged("adhoc", false)])), status: "pass", keys: ["bundleCount", "checkedCount", "flaggedCount", "bundlePath", "signature"] },
  { name: "pass when the unsigned bundle still carries the download mark", state: withApps(ok([flagged("unsigned", true)])), status: "pass", keys: ["bundleCount", "checkedCount", "flaggedCount", "bundlePath", "signature"] },
  { name: "pass on a broken signature, never a fail", state: withApps(ok([flagged("invalid", false)])), status: "pass" },
  { name: "pass when the budget left bundles unchecked", state: withApps({ status: "ok", data: { bundleCount: 90, checkedCount: 60, flagged: [] } }), status: "pass", keys: ["bundleCount", "checkedCount", "flaggedCount"] },
  {
    name: "unknown with the nested reason when the app scan failed",
    state: withApps({ status: "unavailable", reason: "timeout", detail: "bin: codesign" }),
    status: "unknown",
    reason: "timeout",
    keys: [],
  },
]);

describe("TL-MAC-035 text", () => {
  it("is left alone with a Finder reveal, no pane and no CIS section", () => {
    expect(TL_MAC_035.cis).toBeNull();
    expect(TL_MAC_035.fix.apply).toEqual({ kind: "manual", watch: ["platformIntegrity"], watchEvery: 5, reveal: "file" });
    expect(TL_MAC_035.fix.settingsPane).toBeNull();
    expect(TL_MAC_035.guided.verb).toBe("Details");
    expect(TL_MAC_035.evidenceVocabulary["signature"]).toEqual(["apple", "app_store", "developer_id", "adhoc", "unsigned", "invalid"]);
    expect(TL_MAC_035.fix.steps[0]).toBe("In Finder, look at the app shown. If you did not install it, get help before you open it again.");
    for (const step of [...TL_MAC_035.fix.steps, TL_MAC_035.fix.summary, TL_MAC_035.guided.done]) expect(step).not.toMatch(/\bdelete\b/i);
  });

  it("emits one path and one signature per flagged bundle, in listing order", () => {
    const result = runRule(TL_MAC_035, withApps(ok([flagged("adhoc", false), { path: "/Users/sam/Applications/Other.app", name: "Other.app", signature: "unsigned", quarantined: false }])));
    expect(result.status).toBe("fail");
    expect(result.evidence.map((e) => e.key)).toEqual(["bundleCount", "checkedCount", "flaggedCount", "bundlePath", "signature", "bundlePath", "signature"]);
    expect(result.evidence[2]?.value).toEqual({ kind: "number", value: 2, unit: "count" });
    expect(result.evidence[6]?.value).toEqual({ kind: "enum", value: "unsigned" });
  });
});
