import { describe, expect, it } from "vitest";
import type { RuleId } from "../../src/domain/finding";
import type { ScanReport } from "../../src/domain/report";
import { evaluate } from "../../src/engine/evaluate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { containsMachineText } from "../../src/explainer/prose";
import { EMPTY_GUIDED_MEMORY, type GuidedMemory } from "../../src/guided/memory";
import { buildGuidedPlan, type GuidedPlan } from "../../src/guided/plan";
import { freeFixRuleIds } from "../../src/license/entitled";
import type { ExplainerProfile } from "../../src/ports/explainer-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { DONE_PREFIX, buildWriteUp, type WriteUpInput, type WriteUpStrings } from "../../src/chat/writeup";
import { ctxFor, NOW } from "../helpers";

const PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };
const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const AT = "2026-10-10T09:00:00.000Z";
/** The desktop copy test's list, copied so core needs no desktop import. */
const BANNED = /\b(finding|findings|severity|CIS|rule|rules|policy|configuration|SSH|launchd|plist|daemon|sudo|Terminal|TCC|stealth|sysadminctl|command|points)\b/i;

/** Authored test strings in the shape the desktop's ACTIVITY.writeUp block passes. */
const STRINGS: WriteUpStrings = {
  title: "Talos Labs check-up, {date}",
  score: "Score {n} out of 100, {grade}.",
  fixed: "Fixed today:",
  todo: "Still to do:",
  later: "Left for later:",
  left: "Left alone by choice:",
  watch: "The menu bar watch:",
  watchWords: { calm: "Nothing changed", look: "Something to look at", act: "Act now" },
  grade: { good: "Good", fair: "Fair", poor: "Poor", at_risk: "At risk" },
  quote: "ChatGPT wrote this. Not verified:",
};

function planFor(memory: GuidedMemory = EMPTY_GUIDED_MEMORY, report: ScanReport = DEV): GuidedPlan {
  return buildGuidedPlan(report, { freeFixes: freeFixRuleIds(report), licensed: true }, PROFILE, memory, NOW);
}

function inputFor(overrides: Partial<WriteUpInput> = {}): WriteUpInput {
  return { plan: planFor(), report: DEV, fixed: [], watch: "calm", brief: null, date: "17 October 2026", ...overrides };
}

const guided = (id: RuleId) => MACOS_CATALOG.rules.find((rule) => rule.id === id)?.guided;

describe("buildWriteUp on the dev machine", () => {
  const out = buildWriteUp(inputFor(), STRINGS);
  const lines = out.text.split("\n");

  it("starts with the title and the score, then every undone headline with its why, and drops nothing", () => {
    expect(lines[0]).toBe("Talos Labs check-up, 17 October 2026");
    expect(lines[1]).toBe(`Score ${DEV.score.value} out of 100, ${STRINGS.grade[DEV.score.grade ?? "good"]}.`);
    expect(out.dropped).toBe(0);
    const plan = planFor();
    const undone = plan.steps.flatMap((step) => (step.kind === "batch" ? step.ruleIds : step.kind === "fix" || step.kind === "show" ? [step.ruleId] : []));
    expect(undone.length).toBeGreaterThan(3);
    for (const id of undone) {
      const g = guided(id);
      expect(out.text, id).toContain(`  ${g?.headline} ${g?.why}`);
    }
    expect(lines).toContain("Still to do:");
    expect(lines).not.toContain("Fixed today:");
  });

  it("carries no path, no rule id, no where text, no label, no port and no sharePath value", () => {
    expect(out.text).not.toContain("/");
    expect(out.text).not.toContain("TL-MAC-");
    expect(out.text).not.toContain("Users");
    expect(out.text).not.toContain("alice");
    expect(out.text).not.toContain("com.docker.vmnetd");
    expect(out.text).not.toContain("Where:");
    for (const rule of MACOS_CATALOG.rules) {
      if (rule.guided.where !== null) expect(out.text, rule.id).not.toContain(rule.guided.where);
    }
    for (const line of lines) {
      expect(containsMachineText(line), line).toBe(false);
      expect(line, line).not.toMatch(BANNED);
    }
    expect(out.text.length).toBeLessThan(8000);
    expect(out.text).not.toContain("—");
  });

  it("the watch line reads the word for the state and is left out when the watch is not active", () => {
    expect(lines).toContain("The menu bar watch: Nothing changed");
    expect(buildWriteUp(inputFor({ watch: "act" }), STRINGS).text).toContain("The menu bar watch: Act now");
    expect(buildWriteUp(inputFor({ watch: null }), STRINGS).text).not.toContain("The menu bar watch:");
  });

  it("fixed ids read their done line without the Done. prefix, under the fixed label, and leave the to-do list", () => {
    const fixed = buildWriteUp(inputFor({ fixed: ["TL-MAC-002", "TL-MAC-022"] }), STRINGS);
    const done002 = guided("TL-MAC-002")?.done ?? "";
    expect(done002.startsWith(DONE_PREFIX)).toBe(true);
    expect(fixed.text).toContain(`Fixed today:\n  ${done002.slice(DONE_PREFIX.length)}\n  ${(guided("TL-MAC-022")?.done ?? "").slice(DONE_PREFIX.length)}`);
    expect(fixed.text).not.toContain(DONE_PREFIX);
    expect(fixed.text).not.toContain(`  ${guided("TL-MAC-002")?.headline} ${guided("TL-MAC-002")?.why}`);
    expect(fixed.dropped).toBe(0);
  });

  it("later and accepted ids sit under their labels as headlines", () => {
    const memory: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, snoozed: { "TL-MAC-010": "2026-12-01T00:00:00.000Z" }, accepted: { "TL-MAC-026": AT } };
    const plan = planFor(memory);
    expect(plan.later).toEqual(["TL-MAC-010"]);
    expect(plan.accepted).toEqual(["TL-MAC-026"]);
    const text = buildWriteUp(inputFor({ plan }), STRINGS).text;
    expect(text).toContain(`Left for later:\n  ${guided("TL-MAC-010")?.headline}`);
    expect(text).toContain(`Left alone by choice:\n  ${guided("TL-MAC-026")?.headline}`);
    expect(text.indexOf("Still to do:")).toBeLessThan(text.indexOf("Left for later:"));
    expect(text.indexOf("Left for later:")).toBeLessThan(text.indexOf("Left alone by choice:"));
    expect(text).not.toContain(`  ${guided("TL-MAC-010")?.headline} ${guided("TL-MAC-010")?.why}`);
  });

  it("the brief appears only when one is passed and the quote prefix exists, as the last line, in quotes", () => {
    expect(out.text).not.toContain("wrote this");
    const brief = { summary: "Your Mac goes out with you and its disk is not locked.", provider: "chatgpt" as const };
    const quoted = buildWriteUp(inputFor({ brief }), STRINGS);
    expect(quoted.text.split("\n").at(-1)).toBe(`${STRINGS.quote} "${brief.summary}"`);
    expect(buildWriteUp(inputFor({ brief }), { ...STRINGS, quote: null }).text).not.toContain(brief.summary);
  });

  it("drops and counts a line that carries machine text, and skips the score when there is none", () => {
    const brief = { summary: "Run sudo rm -rf / from ~/Library", provider: "claude" as const };
    const dropped = buildWriteUp(inputFor({ brief }), STRINGS);
    expect(dropped.dropped).toBe(1);
    expect(dropped.text).not.toContain("sudo");
    expect(dropped.text).not.toContain("Library");
    const bad = buildWriteUp(inputFor({ date: "/Users/alice" }), STRINGS);
    expect(bad.dropped).toBe(1);
    expect(bad.text.startsWith("Score ")).toBe(true);
    const unscored = buildWriteUp(inputFor({ report: { ...DEV, score: { ...DEV.score, value: null, grade: null } } }), STRINGS);
    expect(unscored.text).not.toContain("Score ");
    expect(unscored.dropped).toBe(0);
  });
});
