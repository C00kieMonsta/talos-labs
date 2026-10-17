import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROBE_IDS } from "@talos/core";
import * as copy from "./copy";
import { CONNECT, CONNECTING, CONNECT_FAILED, END, EXPLAIN, FISHY, GUIDED_SECTION_LABELS, NOT_ANTIVIRUS, PAYWALL, WATCH, WATCH_ON, WATCH_SETTINGS, WELCOME, failureCopy } from "./copy";
import { AI_BADGES, AI_OPEN_APPLE_SETTINGS, AI_UNAVAILABLE_COPY, DECIDED_BY_APP, WATCH_PROBE_LABELS } from "../app/labels";

const BANNED = ["finding", "findings", "severity", "CIS", "rule", "rules", "policy", "configuration", "SSH", "launchd", "plist", "daemon", "sudo", "Terminal", "TCC", "stealth", "sysadminctl", "command", "points"];
const BANNED_PATTERN = new RegExp(`\\b(${BANNED.join("|")})\\b`, "i");

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** The fixed counter from DESIGN-V03.md section 6. Errs long on purpose. */
export function syllablesPerWord(text: string): number {
  const words = text
    .split(/\s+/)
    .filter((token) => /[a-z]/i.test(token))
    .map((token) => token.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return 0;
  }
  let total = 0;
  for (const word of words) {
    const runs = word.match(/[aeiouy]+/g)?.length ?? 0;
    let count = runs;
    if (runs > 1 && word.endsWith("e") && !word.endsWith("le")) {
      count -= 1;
    }
    total += Math.max(1, count);
  }
  return total / words.length;
}

const WATCH_CASES_FILE = join(__dirname, "..", "..", "..", "..", "packages", "core", "fixtures", "watch-cases.json");

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

  it("the paywall and welcome bodies name the watch, not the AI, and read under 1.6 syllables per word", () => {
    expect(PAYWALL.body).toBe("The full version does them all and keeps an eye on your Mac from the menu bar.");
    expect(WELCOME.body).toBe("I'll look at your Mac's safety settings and fix what I can. Nothing leaves your Mac.");
    expect(syllablesPerWord(PAYWALL.body)).toBeLessThanOrEqual(1.6);
    expect(syllablesPerWord(WELCOME.body)).toBeLessThanOrEqual(1.6);
    expect("locked" in EXPLAIN).toBe(false);
    expect("unlock" in EXPLAIN).toBe(false);
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

  it("failureCopy swaps the unreadable body while the watch is on, and nothing else", () => {
    expect(failureCopy("unreadable", false, false).body).toBe("I'll check next time you open me.");
    expect(failureCopy("unreadable", false, false, true).body).toBe(WATCH_ON.tryAgain);
    expect(failureCopy("unreadable", false, false, true)).toMatchObject({ title: "I made the change but could not check it.", primary: "next", later: false });
    expect(`${failureCopy("unreadable", false, false, true).title} ${failureCopy("unreadable", false, false, true).body}`).toBe(WATCH_ON.couldNotCheck);
    for (const error of ["cancelled", "command_failed", "busy", "still_failing"] as const) {
      expect(failureCopy(error, false, true, true)).toEqual(failureCopy(error, false, true, false));
    }
  });
});

describe("watch copy", () => {
  it("the three swapped strings and the Welcome additions are the spec's", () => {
    expect(WATCH_ON).toEqual({
      nextTime: "I'll keep checking from the menu bar.",
      tryAgain: "I'll check again within the hour.",
      couldNotCheck: "I made the change but could not check it. I'll check again within the hour.",
    });
    expect(WELCOME.body).toBe("I'll look at your Mac's safety settings and fix what I can. Nothing leaves your Mac.");
    expect(WELCOME.notAntivirus).toBe(NOT_ANTIVIRUS);
    expect(WELCOME.allowNotifications).toBe("Tell me when something needs doing now");
    expect(NOT_ANTIVIRUS.startsWith("I'm not antivirus.")).toBe(true);
    expect(WATCH_SETTINGS.notify).toBe(WELCOME.allowNotifications);
  });

  it("the window, settings and probe labels carry no banned word", () => {
    for (const text of [...strings({ WATCH, WATCH_SETTINGS, WATCH_ON, FISHY, NOT_ANTIVIRUS }), DECIDED_BY_APP, ...Object.values(WATCH_PROBE_LABELS)]) {
      expect(text, text).not.toMatch(BANNED_PATTERN);
    }
    expect(Object.keys(WATCH_PROBE_LABELS)).toEqual([...PROBE_IDS]);
    expect(Object.keys(WATCH.why)).toEqual(["persistence", "listener", "guard", "remote", "admin", "dns", "backup"]);
    expect(Object.keys(FISHY.gate.body)).toEqual(["guard", "remote", "admin", "backup"]);
  });

  it("the headlines and the notification tail equal the core fixture Rust reads", () => {
    const cases = JSON.parse(readFileSync(WATCH_CASES_FILE, "utf8")) as { headlines: Record<string, string>; notifyTail: string; statusWords: Record<string, string> };
    expect(cases.headlines).toEqual(FISHY.noticed.headline);
    expect(cases.notifyTail).toBe(FISHY.notifyTail);
    expect(cases.statusWords).toEqual({ calm: WATCH.calm, look: WATCH.look, lookOne: WATCH.lookOne, lookMany: WATCH.lookMany, act: WATCH.act });
  });

  it("every title, headline, gate body, expert row, why line and the first-run line read under 1.6 syllables per word", () => {
    const perString = [
      FISHY.gate.title,
      FISHY.disconnect.title,
      FISHY.stop.title,
      FISHY.eradicate.title,
      FISHY.experts.title,
      FISHY.recover.title,
      ...Object.values(FISHY.noticed.headline),
      ...Object.values(FISHY.gate.body),
      ...Object.values(FISHY.experts.rows).map((row) => row.text),
      ...Object.values(WATCH.why),
      WATCH.firstRun,
    ];
    expect(perString.length).toBe(6 + 7 + 4 + 9 + 7 + 1);
    for (const text of perString) expect(syllablesPerWord(text), text).toBeLessThanOrEqual(1.6);
  });

  it("every body sentence reads under 1.6 syllables per word, scored whole", () => {
    const bodies = [
      FISHY.noticed.body,
      FISHY.disconnect.body,
      FISHY.disconnect.bodyWired,
      FISHY.disconnect.keepOn,
      FISHY.stop.body,
      FISHY.stop.bodyNoEntry,
      FISHY.eradicate.body,
      FISHY.recover.body,
      FISHY.evidence,
      FISHY.lessons,
    ];
    for (const text of bodies) expect(syllablesPerWord(text), text).toBeLessThanOrEqual(1.6);
  });

  it("every primary is at or under 28 characters", () => {
    const primaries: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value !== "object" || value === null) return;
      for (const [key, v] of Object.entries(value)) {
        if (key.startsWith("primary") && typeof v === "string") primaries.push(v);
        else walk(v);
      }
    };
    walk(FISHY);
    expect(primaries.length).toBe(10);
    for (const text of primaries) expect(text.length, text).toBeLessThanOrEqual(28);
    expect(FISHY.disconnect.primaryWired).toBe("Block incoming connections");
    expect(FISHY.stop.primaryNoEntry).toBe("Block incoming connections");
  });

  it("the source lines name a source and a step, and the exempt strings are what they are", () => {
    for (const source of [FISHY.noticed.source, FISHY.disconnect.source, FISHY.disconnect.keepOnSource, FISHY.stop.source, FISHY.eradicate.source, FISHY.recover.source, WATCH.sourceAct]) {
      expect(source).toMatch(/SANS|CISA|NIST|Apple/);
    }
    expect(FISHY.noticed.ransom).toBe("I saw a message asking for money");
    expect(FISHY.experts.more).toBe("More experts suggest");
    expect(FISHY.experts.primary).toBe("Done");
  });
});
