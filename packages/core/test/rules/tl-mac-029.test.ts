import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_029 } from "../../src/rules/macos/tl-mac-029";
import { describeRule, patchSection, runRule } from "../helpers";

const mixedFormats = patchSection(HARDENED, "ssh", {
  keys: [
    { path: "/Users/sam/.ssh/id_rsa", format: "openssh", encrypted: false, mode: "600" },
    { path: "/Users/sam/.ssh/aws.pem", format: "pem", encrypted: false, mode: "600" },
    { path: "/Users/sam/.ssh/legacy.key", format: "pkcs8", encrypted: false, mode: "600" },
    { path: "/Users/sam/.ssh/id_ed25519", format: "openssh", encrypted: true, mode: "600" },
  ],
});

describeRule(TL_MAC_029, [
  {
    name: "pass when every key has a passphrase",
    state: HARDENED,
    status: "pass",
    keys: ["keyCount", "unprotectedCount", "unrecognisedCount"],
    kinds: ["number", "number", "number"],
  },
  {
    name: "fail with two unprotected keys, the .pem under its own key",
    state: DEV_MACHINE,
    status: "fail",
    keys: ["keyCount", "unprotectedCount", "unrecognisedCount", "keyPath", "pemKeyPath"],
    kinds: ["number", "number", "number", "path", "path"],
  },
  {
    name: "each unprotected key lands under the evidence key for its format",
    state: mixedFormats,
    status: "fail",
    keys: ["keyCount", "unprotectedCount", "unrecognisedCount", "keyPath", "pemKeyPath", "pkcs8KeyPath"],
    kinds: ["number", "number", "number", "path", "path", "path"],
  },
  {
    name: "an unrecognised header is not a failure",
    state: patchSection(HARDENED, "ssh", {
      keys: [{ path: "/Users/sam/.ssh/odd", format: "unknown", encrypted: null, mode: "600" }],
    }),
    status: "pass",
    keys: ["keyCount", "unprotectedCount", "unrecognisedCount"],
  },
  { name: "not applicable with no keys", state: FRESH_INSTALL, status: "not_applicable", keys: [] },
]);

describe("TL-MAC-029 fix commands keep the key format", () => {
  it("has one command per path evidence key; only the PEM and PKCS8 ones pass -m", () => {
    const byKey = new Map(TL_MAC_029.fix.commands.map((command) => [command.appliesTo, command.args]));
    expect([...byKey.keys()]).toEqual(["keyPath", "pemKeyPath", "pkcs8KeyPath"]);
    expect(byKey.get("keyPath")).toEqual(["-p", "-f", "{path}"]);
    expect(byKey.get("pemKeyPath")).toEqual(["-p", "-m", "PEM", "-f", "{path}"]);
    expect(byKey.get("pkcs8KeyPath")).toEqual(["-p", "-m", "PKCS8", "-f", "{path}"]);
  });

  it("puts the dev machine's .pem under pemKeyPath and the OpenSSH key under keyPath", () => {
    const result = runRule(TL_MAC_029, DEV_MACHINE);
    const paths = (key: string) =>
      result.evidence.filter((entry) => entry.key === key).map((entry) => (entry.value.kind === "path" ? entry.value.value : null));
    expect(paths("pemKeyPath")).toEqual(["/Users/alice/.ssh/aws-eu-west-1.pem"]);
    expect(paths("keyPath")).toEqual(["/Users/alice/.ssh/id_ed25519"]);
    expect(paths("pkcs8KeyPath")).toEqual([]);
  });
});
