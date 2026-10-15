import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_025 } from "../../src/rules/macos/tl-mac-025";
import { describeRule } from "../helpers";

describeRule(TL_MAC_025, [
  { name: "pass with no login items", state: HARDENED, status: "pass", keys: ["loginItemCount"], kinds: ["number"] },
  {
    name: "review with two login items",
    state: DEV_MACHINE,
    status: "review",
    keys: ["loginItemCount", "loginItemName", "loginItemName"],
    kinds: ["number", "text", "text"],
  },
]);
