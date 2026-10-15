import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_021 } from "../../src/rules/macos/tl-mac-021";
import type { ServiceState } from "../../src/domain/system-state";
import { describeRule, patchSection } from "../helpers";

function remoteManagement(service: ServiceState | null) {
  return patchSection(HARDENED, "remoteAccess", { remoteManagement: service });
}

describeRule(TL_MAC_021, [
  { name: "pass when off", state: HARDENED, status: "pass", keys: ["serviceLoaded"], kinds: ["bool"] },
  {
    name: "fail when on",
    state: remoteManagement({ serviceLoaded: true, listeningPort: 3283 }),
    status: "fail",
    keys: ["serviceLoaded", "listeningPort"],
    kinds: ["bool", "number"],
  },
  {
    name: "not applicable when the platform has no Remote Management",
    state: remoteManagement(null),
    status: "not_applicable",
    keys: [],
  },
  {
    name: "unknown (indeterminate) when the service state did not parse",
    state: remoteManagement({ serviceLoaded: null, listeningPort: null }),
    status: "unknown",
    reason: "indeterminate",
    keys: [],
  },
]);
