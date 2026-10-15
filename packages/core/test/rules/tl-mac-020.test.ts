import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_020 } from "../../src/rules/macos/tl-mac-020";
import type { ServiceState } from "../../src/domain/system-state";
import { describeRule, patchSection } from "../helpers";

function screenSharing(service: ServiceState) {
  return patchSection(HARDENED, "remoteAccess", { screenSharing: service });
}

describeRule(TL_MAC_020, [
  { name: "pass when off and nothing listens", state: HARDENED, status: "pass", keys: ["serviceLoaded"], kinds: ["bool"] },
  {
    name: "fail when the service is loaded",
    state: screenSharing({ serviceLoaded: true, listeningPort: 5900 }),
    status: "fail",
    keys: ["serviceLoaded", "listeningPort"],
    kinds: ["bool", "number"],
  },
  {
    name: "pass on the port alone when launchctl did not parse",
    state: screenSharing({ serviceLoaded: null, listeningPort: null }),
    status: "pass",
    keys: [],
  },
  {
    name: "fail on the port alone when launchctl did not parse",
    state: screenSharing({ serviceLoaded: null, listeningPort: 5900 }),
    status: "fail",
    keys: ["listeningPort"],
  },
]);
