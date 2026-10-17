import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_034 } from "../../src/rules/macos/tl-mac-034";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_034, [
  { name: "pass when off", state: HARDENED, status: "pass", keys: ["internetSharing"], kinds: ["enum"] },
  { name: "pass when the domain is absent", state: DEV_MACHINE, status: "pass", keys: ["internetSharing"], kinds: ["enum"] },
  { name: "fail when on", state: patchSection(HARDENED, "remoteAccess", { internetSharing: true }), status: "fail", keys: ["internetSharing"], kinds: ["enum"] },
]);

describe("TL-MAC-034 text", () => {
  it("cites 2.3.3.7 and opens the Sharing pane with the tri vocabulary declared", () => {
    expect(TL_MAC_034.cis).toBe("2.3.3.7");
    expect(TL_MAC_034.fix.apply).toEqual({ kind: "deep_link", pane: "sharing", watch: ["remoteAccess"], watchEvery: 3, reveal: null });
    expect(TL_MAC_034.evidenceVocabulary["internetSharing"]).toEqual(["true", "false", "unset"]);
    expect(TL_MAC_034.guided.headline).toBe("Your Mac is passing its internet on to others");
    expect(TL_MAC_034.guided.verb).toBe("Show me where");
  });
});
