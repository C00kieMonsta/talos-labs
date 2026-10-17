import { describe, expect, it } from "vitest";
import type { LibraryInserts, Section } from "../../src/domain/system-state";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_036 } from "../../src/rules/macos/tl-mac-036";
import { describeRule, patchSection } from "../helpers";

function withInserts(inserts: Section<LibraryInserts>) {
  return patchSection(HARDENED, "platformIntegrity", { inserts });
}

const KEYS = ["dyldInsertSet", "loginHookSet", "launchdConfPresent"];

describeRule(TL_MAC_036, [
  { name: "pass when nothing is set", state: HARDENED, status: "pass", keys: KEYS, kinds: ["bool", "bool", "bool"] },
  { name: "fail when the insert variable is set", state: withInserts({ status: "ok", data: { dyldInsertSet: true, loginHookSet: false, launchdConfPresent: false } }), status: "fail", keys: KEYS },
  { name: "fail when a login hook is set", state: withInserts({ status: "ok", data: { dyldInsertSet: false, loginHookSet: true, launchdConfPresent: false } }), status: "fail", keys: KEYS },
  { name: "fail when the legacy launchd file exists", state: withInserts({ status: "ok", data: { dyldInsertSet: false, loginHookSet: false, launchdConfPresent: true } }), status: "fail", keys: KEYS },
  {
    name: "unknown with the nested reason when the inserts read failed",
    state: withInserts({ status: "unavailable", reason: "tool_missing", detail: "bin: launchctl" }),
    status: "unknown",
    reason: "tool_missing",
    keys: [],
  },
]);

describe("TL-MAC-036 text", () => {
  it("is left alone with no reveal, no pane and no CIS section, and sends the reader for help first", () => {
    expect(TL_MAC_036.cis).toBeNull();
    expect(TL_MAC_036.fix.apply).toEqual({ kind: "manual", watch: ["platformIntegrity"], watchEvery: 5, reveal: null });
    expect(TL_MAC_036.fix.settingsPane).toBeNull();
    expect(TL_MAC_036.guided.verb).toBe("Details");
    expect(TL_MAC_036.fix.steps[0]).toBe("Get help from someone you trust; this is not something to fix alone.");
    expect(TL_MAC_036.explanation).toContain("running session");
  });
});
