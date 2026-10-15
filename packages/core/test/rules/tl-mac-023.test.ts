import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_023 } from "../../src/rules/macos/tl-mac-023";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_023, [
  { name: "pass with no background items", state: HARDENED, status: "pass", keys: ["itemCount"], kinds: ["number"] },
  {
    name: "review with a daemon and a user agent",
    state: DEV_MACHINE,
    status: "review",
    keys: ["itemCount", "itemLabel", "daemonPlist", "itemLabel", "agentPlist"],
    kinds: ["number", "text", "path", "text", "path"],
  },
  {
    name: "a system agent is reported under agentPlist",
    state: patchSection(HARDENED, "persistence", {
      items: [
        {
          scope: "system_agent",
          plistPath: "/Library/LaunchAgents/com.example.agent.plist",
          label: "com.example.agent",
          program: "/Applications/Example.app/Contents/MacOS/agent",
          programExists: true,
          runAtLoad: true,
        },
      ],
    }),
    status: "review",
    keys: ["itemCount", "itemLabel", "agentPlist"],
    kinds: ["number", "text", "path"],
  },
]);

describe("TL-MAC-023 text", () => {
  it("has a title and fail title that read as sentences", () => {
    expect(TL_MAC_023.title).toBe("No program is set to start in the background");
    expect(TL_MAC_023.failTitle).toBe("Some programs start in the background on their own");
  });

  it("keeps the launchctl commands out of the steps so the Settings path stands alone", () => {
    expect(TL_MAC_023.fix.commands).toHaveLength(2);
    for (const step of TL_MAC_023.fix.steps) {
      expect(step).not.toMatch(/\b(command|commands|terminal)\b/i);
    }
  });
});
