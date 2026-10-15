import { describe, expect, it } from "vitest";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_030 } from "../../src/rules/macos/tl-mac-030";
import { describeRule, patchSection } from "../helpers";

const key = { path: "/Users/sam/.ssh/id_ed25519", format: "openssh" as const, encrypted: true };

describeRule(TL_MAC_030, [
  {
    name: "pass with 700 and 600",
    state: HARDENED,
    status: "pass",
    keys: ["dirPrivate", "dirMode", "looseKeyCount"],
    kinds: ["bool", "text", "number"],
  },
  { name: "pass with a 400 key", state: patchSection(HARDENED, "ssh", { keys: [{ ...key, mode: "400" }] }), status: "pass" },
  {
    name: "fail when the folder is 755",
    state: patchSection(HARDENED, "ssh", { dirMode: "755" }),
    status: "fail",
    keys: ["dirPrivate", "dirMode", "looseKeyCount"],
    kinds: ["bool", "text", "number"],
  },
  {
    name: "fail when a key is 644",
    state: patchSection(HARDENED, "ssh", { keys: [{ ...key, mode: "644" }] }),
    status: "fail",
    keys: ["dirPrivate", "dirMode", "looseKeyCount", "keyPath", "keyMode"],
    kinds: ["bool", "text", "number", "path", "text"],
  },
  {
    name: "a key with no mode is ignored",
    state: patchSection(HARDENED, "ssh", { keys: [{ ...key, mode: null }] }),
    status: "pass",
  },
  { name: "not applicable when the folder is absent", state: FRESH_INSTALL, status: "not_applicable", keys: [] },
  {
    name: "unknown (indeterminate) when the folder exists but its mode is unknown",
    state: patchSection(HARDENED, "ssh", { dirMode: null }),
    status: "unknown",
    reason: "indeterminate",
    keys: [],
  },
]);

describe("TL-MAC-030 fix commands", () => {
  it("carries the folder command first, then the per-key command, and no step spells either out", () => {
    expect(TL_MAC_030.fix.commands).toEqual([
      { program: "chmod", args: ["700", "~/.ssh"], needsAdmin: false, interactive: false, appliesTo: null },
      { program: "chmod", args: ["600", "{path}"], needsAdmin: false, interactive: false, appliesTo: "keyPath" },
    ]);
    expect(TL_MAC_030.fix.steps).toHaveLength(2);
    for (const step of TL_MAC_030.fix.steps) {
      expect(step).not.toMatch(/\bchmod\b/);
    }
    expect(TL_MAC_030.fix.steps[0]).toMatch(/first command/);
    expect(TL_MAC_030.fix.steps[1]).toMatch(/second command/);
  });
});
