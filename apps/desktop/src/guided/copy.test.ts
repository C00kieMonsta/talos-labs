import { describe, expect, it } from "vitest";
import * as copy from "./copy";
import { CONNECT, CONNECTING, CONNECT_FAILED, END, EXPLAIN, GUIDED_SECTION_LABELS, PAYWALL, failureCopy } from "./copy";
import { AI_BADGES, AI_OPEN_APPLE_SETTINGS, AI_UNAVAILABLE_COPY } from "../app/labels";

const BANNED = ["finding", "findings", "severity", "CIS", "rule", "rules", "policy", "configuration", "SSH", "launchd", "plist", "daemon", "sudo", "Terminal", "TCC", "stealth", "sysadminctl", "command", "points"];
const BANNED_PATTERN = new RegExp(`\\b(${BANNED.join("|")})\\b`, "i");

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe("guided copy", () => {
  it("has no banned word in any fixed string", () => {
    const all = strings(Object.fromEntries(Object.entries(copy).filter(([, v]) => typeof v !== "function")));
    expect(all.length).toBeGreaterThan(50);
    for (const text of all) expect(text, text).not.toMatch(BANNED_PATTERN);
  });

  it("walks the AI strings, including the badges EXPLAIN.badge points at", () => {
    const all = strings({ CONNECT, CONNECTING, CONNECT_FAILED, EXPLAIN, PAYWALL, END });
    expect(all).toContain(AI_BADGES.chatgpt);
    expect(all).toContain(AI_BADGES.apple);
    expect(all.length).toBeGreaterThan(60);
    for (const text of all) expect(text, text).not.toMatch(BANNED_PATTERN);
    expect(EXPLAIN.badge).toBe(AI_BADGES);
    // The Apple Intelligence lines and their button are the expert card's, walked here under the banned words.
    expect(EXPLAIN.apple).toBe(AI_UNAVAILABLE_COPY);
    expect(all).toContain(AI_UNAVAILABLE_COPY.apple_intelligence_not_enabled);
    expect(EXPLAIN.openAppleSettings).toBe(AI_OPEN_APPLE_SETTINGS);
    expect(EXPLAIN.notOffered.chatgpt).toBe("ChatGPT isn't available in this version yet.");
    expect(CONNECT.primary).toEqual({ chatgpt: "Connect ChatGPT", claude_plan: "Connect Claude", apple: "Use this Mac" });
    expect(PAYWALL.buy).toBe("Buy the full version, €24 a year");
    expect(END.explained).toBe("Get things explained");
  });

  it("overrides the three scanning rows that carried banned words", () => {
    expect(GUIDED_SECTION_LABELS.ssh).toBe("Checking your login keys");
    expect(GUIDED_SECTION_LABELS.passwordPolicy).toBe("Checking password settings");
    expect(GUIDED_SECTION_LABELS.dotfiles).toBe("Checking files for saved passwords");
    for (const text of Object.values(GUIDED_SECTION_LABELS)) expect(text, text).not.toMatch(BANNED_PATTERN);
  });

  it("keeps the failure tables free of banned words and names the right actions", () => {
    const errors = ["cancelled", "wrong_password", "command_failed", "timeout", "plan_expired", "precondition_changed", "not_in_catalog", "invalid_choice", "invalid_input", "busy", "still_failing", "unreadable"] as const;
    for (const error of errors) {
      for (const batch of [true, false]) {
        for (const pane of [true, false]) {
          const c = failureCopy(error, batch, pane);
          for (const text of [c.title, c.body ?? ""]) expect(text, text).not.toMatch(BANNED_PATTERN);
        }
      }
    }
    expect(failureCopy("command_failed", false, true)).toMatchObject({ primary: "show_where", later: true });
    expect(failureCopy("command_failed", false, false)).toMatchObject({ primary: "next", later: false });
    expect(failureCopy("command_failed", true, false)).toMatchObject({ title: "That did not work.", body: "Nothing was changed.", primary: "try_again" });
    expect(failureCopy("unreadable", false, false)).toMatchObject({ primary: "next", later: false });
    expect(failureCopy("still_failing", false, false).primary).toBe("check_again");
  });
});
