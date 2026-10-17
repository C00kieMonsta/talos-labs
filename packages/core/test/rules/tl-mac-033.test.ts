import { describe, expect, it } from "vitest";
import { HARDENED } from "../../src/fixtures/hardened";
import type { ServiceState } from "../../src/domain/system-state";
import { TL_MAC_033 } from "../../src/rules/macos/tl-mac-033";
import { describeRule, patchSection } from "../helpers";

function remoteAppleEvents(service: ServiceState | null) {
  return patchSection(HARDENED, "remoteAccess", { remoteAppleEvents: service });
}

describeRule(TL_MAC_033, [
  { name: "pass when off and nothing listens", state: HARDENED, status: "pass", keys: ["serviceLoaded"], kinds: ["bool"] },
  {
    name: "fail when the service is loaded",
    state: remoteAppleEvents({ serviceLoaded: true, listeningPort: 3031 }),
    status: "fail",
    keys: ["serviceLoaded", "listeningPort"],
    kinds: ["bool", "number"],
  },
  { name: "fail on the port alone when launchctl did not parse", state: remoteAppleEvents({ serviceLoaded: null, listeningPort: 3031 }), status: "fail", keys: ["listeningPort"] },
  { name: "pass on the port alone when launchctl did not parse", state: remoteAppleEvents({ serviceLoaded: null, listeningPort: null }), status: "pass", keys: [] },
  { name: "pass when loaded is false and the port is null on an unsigned build", state: remoteAppleEvents({ serviceLoaded: false, listeningPort: null }), status: "pass", keys: ["serviceLoaded"] },
  { name: "not applicable when the platform has no such service", state: remoteAppleEvents(null), status: "not_applicable", keys: [] },
]);

describe("TL-MAC-033 text", () => {
  it("cites 2.3.3.6, runs in the app through the admin dialog and rechecks listeners", () => {
    expect(TL_MAC_033.cis).toBe("2.3.3.6");
    expect(TL_MAC_033.fix.apply).toEqual({
      kind: "in_app",
      choice: "none",
      passphrase: false,
      needsPassword: true,
      recheck: ["remoteAccess", "listeners"],
      confirmTitle: "Turn Remote Apple Events off?",
      confirmVerb: "Turn off",
      confirmNote: null,
      reversible: "You can turn it back on in System Settings > General > Sharing > Remote Application Scripting.",
    });
    expect(TL_MAC_033.guided.verb).toBe("Turn it off");
    expect(TL_MAC_033.explanation).toContain("off by default");
  });
});
