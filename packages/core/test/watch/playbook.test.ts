import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_IDS, SIGNAL_IDS, WATCH_ACTION_IDS } from "../../src/ports/watch-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { PLAYBOOK, PLAYBOOK_URLS, playbookJson, playbookRow } from "../../src/watch/playbook";

const FILE = join(__dirname, "..", "..", "fixtures", "playbook.json");
const BANNED = ["finding", "findings", "severity", "CIS", "rule", "rules", "policy", "configuration", "SSH", "launchd", "plist", "daemon", "sudo", "Terminal", "TCC", "stealth", "sysadminctl", "command", "points"];
const BANNED_PATTERN = new RegExp(`\\b(${BANNED.join("|")})\\b`, "i");

/** The fixed counter from DESIGN-V03.md section 6, as in test/engine/guided-strings.test.ts. */
function syllablesPerWord(text: string): number {
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
const FIELDS = ["id", "source", "step", "url", "kind", "floor", "triggers", "title", "whatExpertsDo", "phase", "outcome"];
const IN_APP = new Set(MACOS_CATALOG.rules.filter((r) => r.fix.apply.kind === "in_app").map((r) => r.id));

describe("packages/core/fixtures/playbook.json", () => {
  it("equals playbookJson() (run pnpm fixtures:emit otherwise)", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).toBe(playbookJson());
    expect(JSON.parse(text)).toEqual(PLAYBOOK);
  });

  it("writes the eleven keys in declaration order on every row", () => {
    for (const row of JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>[]) {
      expect(Object.keys(row)).toEqual(FIELDS);
    }
  });
});

describe("PLAYBOOK", () => {
  it("has the 26 rows in ACTION_IDS order, one per id", () => {
    expect(PLAYBOOK.map((r) => r.id)).toEqual([...ACTION_IDS]);
    expect(PLAYBOOK).toHaveLength(26);
  });

  it("the two benchmark rows open a pane, name the section without the banned word, and carry the benchmark url", () => {
    expect(PLAYBOOK_URLS.CIS).toBe("https://www.cisecurity.org/benchmark/apple_os");
    const airdrop = playbookRow("act.limit_airdrop");
    expect(airdrop?.source).toBe("CIS");
    expect(airdrop?.step).toBe("Apple macOS 26 Benchmark, section 2.3.1.1");
    expect(airdrop?.kind).toEqual({ kind: "pane", pane: "airdrop" });
    expect(airdrop?.floor).toBe("keep_an_eye");
    expect(airdrop?.triggers).toEqual(["sig.airdrop_everyone"]);
    expect(airdrop?.title).toBe("Limit AirDrop to people you know");
    expect([airdrop?.phase, airdrop?.outcome]).toEqual(["containment", "RS.MI-02"]);
    const sharing = playbookRow("act.stop_internet_sharing");
    expect(sharing?.source).toBe("CIS");
    expect(sharing?.step).toBe("Apple macOS 26 Benchmark, section 2.3.3.7");
    expect(sharing?.kind).toEqual({ kind: "pane", pane: "sharing" });
    expect(sharing?.triggers).toEqual(["sig.internet_sharing_on"]);
    expect(sharing?.title).toBe("Turn Internet Sharing off");
    expect(sharing?.whatExpertsDo).toBe("Experts turn Internet Sharing off unless the Mac is meant to hand out its connection.");
    for (const row of [airdrop, sharing]) expect(row?.url).toBe(PLAYBOOK_URLS.CIS);
  });

  it("the review row covers the app listing and get_help covers the two look-only counts", () => {
    const review = playbookRow("act.review_background_programs");
    for (const id of ["sig.launch_label_masquerade", "sig.launch_label_masquerade_unsigned", "sig.app_set", "sig.app_new_unquarantined", "sig.app_new_unsigned", "sig.library_apps_count"]) {
      expect(review?.triggers, id).toContain(id);
    }
    const help = playbookRow("act.get_help");
    expect(help?.triggers.slice(-2)).toEqual(["sig.path_dir_writable_count", "sig.library_apps_count"]);
    expect(help?.triggers).toHaveLength(33 + 2);
  });

  it("every string field is non-empty and every url is https from the source table", () => {
    for (const row of PLAYBOOK) {
      for (const key of ["step", "url", "title", "whatExpertsDo", "phase", "outcome"] as const) {
        expect(row[key].length, `${row.id}.${key}`).toBeGreaterThan(0);
      }
      expect(row.url.startsWith("https://"), row.id).toBe(true);
      expect(row.url).toBe(PLAYBOOK_URLS[row.source]);
      expect(row.triggers.length, row.id).toBeGreaterThan(0);
      for (const t of row.triggers) expect(SIGNAL_IDS).toContain(t);
    }
  });

  it("every fix row names an in-app rule or a watch catalogue id; reveal rows name 023 or 024", () => {
    for (const row of PLAYBOOK) {
      if (row.kind.kind === "fix") {
        const ok = IN_APP.has(row.kind.spec as never) || (WATCH_ACTION_IDS as readonly string[]).includes(row.kind.spec);
        expect(ok, `${row.id}: ${row.kind.spec}`).toBe(true);
      }
      if (row.kind.kind === "reveal") expect(["TL-MAC-023", "TL-MAC-024"]).toContain(row.kind.rule);
    }
    expect(playbookRow("act.disconnect_network")?.kind).toEqual({ kind: "fix", spec: "watch.wifi_off" });
    expect(playbookRow("act.reconnect_and_watch")?.kind).toEqual({ kind: "fix", spec: "watch.wifi_on" });
    expect(playbookRow("act.block_incoming")?.kind).toEqual({ kind: "fix", spec: "watch.block_incoming" });
    expect(playbookRow("act.stop_background_program")?.kind).toEqual({ kind: "fix", spec: "watch.stop_user_agent" });
    expect(playbookRow("act.run_full_checkup")?.kind).toEqual({ kind: "recheck" });
  });

  it("titles and expert lines carry no banned word; the expert sentences read under 1.6 syllables per word", () => {
    for (const row of PLAYBOOK) {
      expect(row.title, row.id).not.toMatch(BANNED_PATTERN);
      expect(row.whatExpertsDo, row.id).not.toMatch(BANNED_PATTERN);
      expect(row.step, row.id).not.toMatch(BANNED_PATTERN);
      // Titles are names and verbs ("Block incoming connections", "Lockdown Mode") and sit under the same exemption as the spec's primaries.
      expect(syllablesPerWord(row.whatExpertsDo), `${row.id}: ${row.whatExpertsDo}`).toBeLessThanOrEqual(1.6);
    }
  });

  it("the containment rows are act-now rows and the lockdown row is never act-now", () => {
    expect(playbookRow("act.disconnect_network")?.floor).toBe("act_now");
    expect(playbookRow("act.do_not_power_off")?.floor).toBe("act_now");
    expect(playbookRow("act.lockdown_mode")?.floor).toBe("keep_an_eye");
    expect(playbookRow("act.report")?.outcome).toBe("RS.CO-03");
  });
});
