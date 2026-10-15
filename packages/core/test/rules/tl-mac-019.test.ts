import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_019 } from "../../src/rules/macos/tl-mac-019";
import type { ServiceState } from "../../src/domain/system-state";
import { describeRule, patchSection } from "../helpers";

function ssh(service: ServiceState) {
  return patchSection(HARDENED, "remoteAccess", { ssh: service });
}

describeRule(TL_MAC_019, [
  { name: "pass when off and nothing listens", state: HARDENED, status: "pass", keys: ["serviceLoaded"], kinds: ["bool"] },
  {
    name: "fail when the service is loaded",
    state: ssh({ serviceLoaded: true, listeningPort: null }),
    status: "fail",
    keys: ["serviceLoaded"],
    kinds: ["bool"],
  },
  {
    name: "fail when port 22 is bound even if launchctl says disabled",
    state: ssh({ serviceLoaded: false, listeningPort: 22 }),
    status: "fail",
    keys: ["serviceLoaded", "listeningPort"],
    kinds: ["bool", "number"],
  },
  {
    name: "pass on the port alone when launchctl did not parse",
    state: ssh({ serviceLoaded: null, listeningPort: null }),
    status: "pass",
    keys: [],
  },
  {
    name: "fail on the port alone when launchctl did not parse",
    state: ssh({ serviceLoaded: null, listeningPort: 22 }),
    status: "fail",
    keys: ["listeningPort"],
    kinds: ["number"],
  },
]);
