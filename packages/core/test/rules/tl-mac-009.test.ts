import { describe, expect, it } from "vitest";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_009 } from "../../src/rules/macos/tl-mac-009";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_009, [
  { name: "pass when on", state: HARDENED, status: "pass", keys: ["autoInstallSecurityResponses"], kinds: ["enum"] },
  { name: "pass when unset", state: FRESH_INSTALL, status: "pass", keys: ["autoInstallSecurityResponses"] },
  {
    name: "fail when off",
    state: patchSection(HARDENED, "updates", { autoInstallSecurityResponses: false }),
    status: "fail",
    keys: ["autoInstallSecurityResponses"],
    kinds: ["enum"],
  },
]);

describe("TL-MAC-009 fix", () => {
  it("carries one command per key and no step that names a command", () => {
    expect(TL_MAC_009.fix.commands.map((command) => command.args[2])).toEqual(["ConfigDataInstall", "CriticalUpdateInstall"]);
    for (const step of TL_MAC_009.fix.steps) {
      expect(step).not.toMatch(/\b(command|commands|terminal)\b/i);
    }
  });
});
