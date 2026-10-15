import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_024 } from "../../src/rules/macos/tl-mac-024";
import { describeRule, patchSection } from "../helpers";

describeRule(TL_MAC_024, [
  { name: "pass with no items", state: HARDENED, status: "pass", keys: ["orphanCount"], kinds: ["number"] },
  { name: "pass when every program exists", state: DEV_MACHINE, status: "pass", keys: ["orphanCount"] },
  {
    name: "fail when an item points at a missing program",
    state: patchSection(HARDENED, "persistence", {
      items: [
        {
          scope: "user_agent",
          plistPath: "/Users/sam/Library/LaunchAgents/com.old.helper.plist",
          label: "com.old.helper",
          program: "/Applications/Old.app/Contents/MacOS/helper",
          programExists: false,
          runAtLoad: true,
        },
      ],
    }),
    status: "fail",
    keys: ["orphanCount", "orphanPlist", "orphanProgram"],
    kinds: ["number", "path", "path"],
  },
  {
    name: "an item with no program is not an orphan",
    state: patchSection(HARDENED, "persistence", {
      items: [
        {
          scope: "system_daemon",
          plistPath: "/Library/LaunchDaemons/com.example.plist",
          label: "com.example",
          program: null,
          programExists: null,
          runAtLoad: false,
        },
      ],
    }),
    status: "pass",
    keys: ["orphanCount"],
  },
]);
