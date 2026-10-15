import { describe, expect, it } from "vitest";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_031 } from "../../src/rules/macos/tl-mac-031";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_031, [
  {
    name: "pass with no hits",
    state: HARDENED,
    status: "pass",
    keys: ["hitCount", "unreadableCount"],
    kinds: ["number", "number"],
  },
  {
    name: "fail with an AWS key in a dotfile",
    state: patchSection(HARDENED, "dotfiles", {
      unreadable: ["/Users/sam/.netrc"],
      hits: [{ path: "/Users/sam/.zshrc", pattern: "aws_access_key_id", line: 3 }],
    }),
    status: "fail",
    keys: ["hitCount", "unreadableCount", "pattern", "hitPath", "line"],
    kinds: ["number", "number", "enum", "path", "number"],
  },
  {
    name: "unreadable files alone do not fail",
    state: patchSection(HARDENED, "dotfiles", { unreadable: ["/Users/sam/.netrc"], hits: [] }),
    status: "pass",
    keys: ["hitCount", "unreadableCount"],
  },
]);

describe("TL-MAC-031 fix text is split by file kind", () => {
  it("gives one branch for shell start-up files and one for tool config files", () => {
    const steps = TL_MAC_031.fix.steps;
    expect(steps.some((step) => step.startsWith("If it is a shell start-up file") && step.includes("delete the line"))).toBe(true);
    expect(steps.some((step) => step.startsWith("If it is a tool's own config file") && step.includes("do not delete the line"))).toBe(true);
    expect(steps.some((step) => step.includes("aws configure sso") && step.includes("${NPM_TOKEN}"))).toBe(true);
  });

  it("does not claim that tool config files are read on every Terminal start", () => {
    expect(TL_MAC_031.explanation).not.toContain("reads on every start");
    expect(TL_MAC_031.title).toBe("No passwords or keys sitting in plain-text config files");
  });
});
