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
