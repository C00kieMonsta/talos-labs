import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_007 } from "../../src/rules/macos/tl-mac-007";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_007, [
  {
    name: "pass when both switches are on",
    state: HARDENED,
    status: "pass",
    keys: ["automaticCheck", "automaticDownload"],
    kinds: ["enum", "enum"],
  },
  { name: "pass when check is unset (OS default on)", state: DEV_MACHINE, status: "pass", keys: ["automaticCheck", "automaticDownload"] },
  {
    name: "fail when download is off",
    state: patchSection(HARDENED, "updates", { automaticDownload: false }),
    status: "fail",
    keys: ["automaticCheck", "automaticDownload"],
    kinds: ["enum", "enum"],
  },
  {
    name: "fail when check is off",
    state: patchSection(HARDENED, "updates", { automaticCheck: false }),
    status: "fail",
  },
]);

describe("TL-MAC-007 fix", () => {
  it("carries one command per switch and no step that names a command", () => {
    expect(TL_MAC_007.fix.commands.map((command) => command.args[2])).toEqual(["AutomaticCheckEnabled", "AutomaticDownload"]);
    for (const step of TL_MAC_007.fix.steps) {
      expect(step).not.toMatch(/\b(command|commands|terminal)\b/i);
    }
  });
});
