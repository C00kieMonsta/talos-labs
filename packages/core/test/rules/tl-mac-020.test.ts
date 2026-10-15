import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_020 } from "../../src/rules/macos/tl-mac-020";
import type { RemoteAccess, ServiceState } from "../../src/domain/system-state";
import { describeRule, patchSection } from "../helpers";

function screenSharing(service: ServiceState) {
  return patchSection(HARDENED, "remoteAccess", { screenSharing: service });
}

function remoteAccess(patch: Partial<RemoteAccess>) {
  return patchSection(HARDENED, "remoteAccess", patch);
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
  {
    name: "pass as covered when Remote Management is on and serves port 5900",
    state: remoteAccess({
      screenSharing: { serviceLoaded: null, listeningPort: 5900 },
      remoteManagement: { serviceLoaded: true, listeningPort: 5900 },
    }),
    status: "pass",
    keys: ["listeningPort", "coveredByRemoteManagement"],
    kinds: ["number", "bool"],
  },
  {
    name: "pass as covered when Remote Management is on and Screen Sharing is off",
    state: remoteAccess({ remoteManagement: { serviceLoaded: true, listeningPort: 3283 } }),
    status: "pass",
    keys: ["serviceLoaded", "coveredByRemoteManagement"],
    kinds: ["bool", "bool"],
  },
  {
    name: "fail on port 5900 when the Remote Management state is unknown",
    state: remoteAccess({
      screenSharing: { serviceLoaded: null, listeningPort: 5900 },
      remoteManagement: { serviceLoaded: null, listeningPort: 5900 },
    }),
    status: "fail",
    keys: ["listeningPort"],
  },
  {
    name: "fail when loaded and remoteManagement is null",
    state: remoteAccess({ screenSharing: { serviceLoaded: true, listeningPort: 5900 }, remoteManagement: null }),
    status: "fail",
    keys: ["serviceLoaded", "listeningPort"],
  },
]);
