import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { AIRDROP_VOCABULARY, TL_MAC_032 } from "../../src/rules/macos/tl-mac-032";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_032, [
  { name: "pass on Contacts Only", state: HARDENED, status: "pass", keys: ["airdrop"], kinds: ["enum"] },
  { name: "fail on Everyone", state: DEV_MACHINE, status: "fail", keys: ["airdrop"], kinds: ["enum"] },
  { name: "pass on Off", state: patchSection(HARDENED, "remoteAccess", { airdrop: "off" }), status: "pass", keys: ["airdrop"] },
  { name: "pass when the key is unset", state: FRESH_INSTALL, status: "pass", keys: ["airdrop"] },
]);

describe("TL-MAC-032 text", () => {
  it("is a partial pin on 2.3.1.1 that opens the AirDrop pane and declares every mode", () => {
    expect(TL_MAC_032.cis).toBe("2.3.1.1");
    expect(TL_MAC_032.fix.apply).toEqual({ kind: "deep_link", pane: "airdrop", watch: ["remoteAccess"], watchEvery: 3, reveal: null });
    expect(TL_MAC_032.fix.settingsPane).toBe("airdrop");
    expect(TL_MAC_032.evidenceVocabulary["airdrop"]).toEqual(AIRDROP_VOCABULARY);
    expect(AIRDROP_VOCABULARY).toEqual(["everyone", "contacts_only", "off", "unset"]);
    expect(TL_MAC_032.guided.headline).toBe("Anyone nearby can send you files");
    expect(TL_MAC_032.guided.verb).toBe("Show me where");
    expect(TL_MAC_032.fix.steps[0]).toContain("Contacts Only");
  });
});
