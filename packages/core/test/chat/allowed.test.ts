import { describe, expect, it } from "vitest";
import type { RuleId } from "../../src/domain/finding";
import type { ScanReport } from "../../src/domain/report";
import { evaluate } from "../../src/engine/evaluate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { EMPTY_GUIDED_MEMORY, type GuidedMemory } from "../../src/guided/memory";
import { buildGuidedPlan, type GuidedGate, type GuidedPlan } from "../../src/guided/plan";
import { freeFixRuleIds } from "../../src/license/entitled";
import type { ExplainerProfile } from "../../src/ports/explainer-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { WATCH_AGENT_PORTS_READY, buildAllowed, cardsFromRelated, intentsFor, lockedFor, stillAllowed, toAllowedInput, type Allowed, type AllowedSource } from "../../src/chat/allowed";
import { ctxFor, NOW } from "../helpers";

const PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };
const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const AT = "2026-10-10T09:00:00.000Z";
const WATCH_ITEMS = ["sig.persistence_new", "sig.persistence_in_temp_or_hidden"] as const;
const AGENT_KINDS = ["investigate", "close_watch", "remind_rule", "write_up", "what_if"] as const;

function gateFor(report: ScanReport, licensed: boolean): GuidedGate {
  return { freeFixes: freeFixRuleIds(report), licensed };
}

function sourceFor(licensed: boolean, memory: GuidedMemory = EMPTY_GUIDED_MEMORY, overrides: Partial<AllowedSource> = {}): AllowedSource {
  const gate = gateFor(DEV, licensed);
  const plan = buildGuidedPlan(DEV, gate, PROFILE, memory, NOW);
  return { plan, report: DEV, gate, scanReady: true, watchEnabled: true, memory, doneStepIds: [], watchItems: WATCH_ITEMS, ...overrides };
}

function undoneIds(plan: GuidedPlan, done: readonly string[] = []): RuleId[] {
  const out: RuleId[] = [];
  for (const step of plan.steps) {
    if (done.includes(step.id)) continue;
    if (step.kind === "batch") out.push(...step.ruleIds);
    if (step.kind === "fix" || step.kind === "show") out.push(step.ruleId);
  }
  return [...new Set(out)];
}

describe("buildAllowed on the licensed dev machine", () => {
  const source = sourceFor(true);
  const allowed = buildAllowed(source);
  const undone = undoneIds(source.plan);

  it("fix, show, batch and explain are subsets of the undone step ids", () => {
    expect(allowed.batch).toEqual(["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"]);
    expect(allowed.fix).toEqual(["TL-MAC-022"]);
    expect(allowed.show).toEqual(["TL-MAC-026", "TL-MAC-032", "TL-MAC-001", "TL-MAC-010"]);
    expect(allowed.explain).toEqual(undone);
    for (const list of [allowed.fix, allowed.show, allowed.batch, allowed.explain, allowed.snooze]) {
      for (const id of list) expect(undone).toContain(id);
    }
  });

  it("details is every rule id in the report; accepted and snoozed mirror the plan", () => {
    expect(allowed.details).toEqual(DEV.results.map((r) => r.ruleId));
    expect(allowed.accepted).toEqual(source.plan.accepted);
    expect(allowed.snoozed).toEqual(source.plan.later);
  });

  it("kinds holds every kind when the scan is ready and the watch is on, the two watch-agent kinds behind the constant", () => {
    const gated = WATCH_AGENT_PORTS_READY ? ["investigate", "close_watch"] : [];
    expect(allowed.kinds).toEqual([
      "fix_rule",
      "fix_batch",
      "show_where",
      "explain_rule",
      "open_details",
      "show_list",
      "rescan",
      "change_ai",
      "snooze_rule",
      "accept_rule",
      "open_watch",
      ...gated,
      "remind_rule",
      "write_up",
      "what_if",
    ]);
    for (const kind of ["remind_rule", "write_up", "what_if"]) expect(allowed.kinds).toContain(kind);
    expect(allowed.kinds.includes("investigate")).toBe(WATCH_AGENT_PORTS_READY);
    expect(allowed.kinds.includes("close_watch")).toBe(WATCH_AGENT_PORTS_READY);
    expect(allowed.investigate).toEqual(WATCH_AGENT_PORTS_READY ? [...WATCH_ITEMS] : []);
  });

  it("the constant is false until the watch port exists; the true branch is reachable through the second argument", () => {
    expect(WATCH_AGENT_PORTS_READY).toBe(false);
    const ready = buildAllowed(source, true);
    expect(ready.kinds.slice(-5)).toEqual([...AGENT_KINDS]);
    expect(ready.investigate).toEqual([...WATCH_ITEMS]);
    expect(buildAllowed({ ...source, watchItems: [...WATCH_ITEMS, "sig.persistence_new"] }, true).investigate).toEqual([...WATCH_ITEMS]);
    const noWatch = buildAllowed({ ...source, watchEnabled: false }, true);
    expect(noWatch.kinds).not.toContain("investigate");
    expect(noWatch.kinds).not.toContain("close_watch");
    expect(noWatch.investigate).toEqual([]);
    const { watchItems, ...withoutItems } = source;
    void watchItems;
    const noItems = buildAllowed(withoutItems, true);
    expect(noItems.investigate).toEqual([]);
    expect(noItems.kinds).toContain("investigate");
    const closed = buildAllowed(source, false);
    expect(closed.kinds).not.toContain("investigate");
    expect(closed.investigate).toEqual([]);
  });

  it("remind is the snoozable undone ids plus plan.later minus accepted; whatIf is every failing rule in report order", () => {
    expect(allowed.remind).toEqual(allowed.snooze);
    expect(allowed.whatIf).toEqual(DEV.results.filter((r) => r.status === "fail").map((r) => r.ruleId));
    expect(allowed.whatIf).toContain("TL-MAC-001");
    expect(allowed.whatIf).toContain("TL-MAC-014");
    expect(allowed.whatIf).not.toContain("TL-MAC-004");
    const memory: GuidedMemory = {
      ...EMPTY_GUIDED_MEMORY,
      laterCount: { "TL-MAC-022": 3 },
      snoozed: { "TL-MAC-010": "2026-12-01T00:00:00.000Z" },
      accepted: { "TL-MAC-026": AT },
    };
    const out = buildAllowed(sourceFor(true, memory));
    expect(out.remind).not.toContain("TL-MAC-022");
    expect(out.remind).toContain("TL-MAC-010");
    expect(out.remind).not.toContain("TL-MAC-026");
    expect(out.whatIf).toContain("TL-MAC-026");
    expect(out.whatIf).toContain("TL-MAC-010");
  });

  it("a done step leaves every action list", () => {
    const done = buildAllowed({ ...source, doneStepIds: ["batch", "show:TL-MAC-001"] });
    expect(done.batch).toEqual([]);
    expect(done.show).toEqual(["TL-MAC-026", "TL-MAC-032", "TL-MAC-010"]);
    expect(done.explain).not.toContain("TL-MAC-002");
    expect(done.explain).not.toContain("TL-MAC-001");
    expect(done.snooze).not.toContain("TL-MAC-001");
    expect(done.accept).not.toContain("TL-MAC-001");
    expect(done.details).toContain("TL-MAC-001");
  });

  it("snooze drops ids with laterCount at 3; accept adds plan.later and drops memory.accepted", () => {
    const memory: GuidedMemory = {
      ...EMPTY_GUIDED_MEMORY,
      laterCount: { "TL-MAC-022": 3, "TL-MAC-001": 2 },
      snoozed: { "TL-MAC-010": "2026-12-01T00:00:00.000Z" },
      accepted: { "TL-MAC-026": AT },
    };
    const src = sourceFor(true, memory);
    const out = buildAllowed(src);
    expect(src.plan.later).toEqual(["TL-MAC-010"]);
    expect(src.plan.accepted).toEqual(["TL-MAC-026"]);
    expect(out.snooze).not.toContain("TL-MAC-022");
    expect(out.snooze).toContain("TL-MAC-001");
    expect(out.accept).toContain("TL-MAC-010");
    expect(out.accept).not.toContain("TL-MAC-026");
    for (const list of [out.fix, out.show, out.batch, out.explain, out.snooze]) {
      expect(list).not.toContain("TL-MAC-010");
      expect(list).not.toContain("TL-MAC-026");
      for (const id of src.plan.leftAlone) expect(list).not.toContain(id);
    }
  });

  it("fix, show and batch are empty and their kinds absent when the scan is not ready", () => {
    const out = buildAllowed({ ...source, scanReady: false });
    expect(out.fix).toEqual([]);
    expect(out.show).toEqual([]);
    expect(out.batch).toEqual([]);
    expect(out.explain).toEqual(undone);
    expect(out.kinds).not.toContain("fix_rule");
    expect(out.kinds).not.toContain("fix_batch");
    expect(out.kinds).not.toContain("show_where");
    expect(out.kinds).toContain("open_watch");
  });

  it("open_watch leaves kinds when the watch is off", () => {
    expect(buildAllowed({ ...source, watchEnabled: false }).kinds).not.toContain("open_watch");
  });

  it("toAllowedInput drops accepted and snoozed and nothing else, in the serialised key order", () => {
    expect(Object.keys(toAllowedInput(allowed))).toEqual(["fix", "batch", "show", "explain", "details", "snooze", "accept", "investigate", "remind", "whatIf", "kinds"]);
  });
});

describe("lockedFor", () => {
  it("is plan.locked only for an unlicensed gate", () => {
    const free = sourceFor(false);
    expect(lockedFor(free.plan, free.gate)).toEqual(["TL-MAC-003", "TL-MAC-011", "TL-MAC-022", "TL-MAC-026", "TL-MAC-032"]);
    const paid = sourceFor(true);
    expect(lockedFor(paid.plan, paid.gate)).toEqual([]);
  });
});

describe("cardsFromRelated", () => {
  const base = buildAllowed(sourceFor(true));
  const allowed: Allowed = { ...base, accepted: ["TL-MAC-014"], snoozed: [] };

  it("prefers fix, then show, then details per id, at most three, in allowed order, accepted dropped", () => {
    // 022 fix, 001 show, 029 details only, 014 accepted, plus 010 and 026 shows: five candidates after the drop.
    const out = cardsFromRelated(["TL-MAC-029", "TL-MAC-014", "TL-MAC-001", "TL-MAC-022", "TL-MAC-010", "TL-MAC-026"], allowed);
    expect(out).toEqual([
      { kind: "fix_rule", ruleId: "TL-MAC-022" },
      { kind: "show_where", ruleId: "TL-MAC-026" },
      { kind: "show_where", ruleId: "TL-MAC-001" },
    ]);
    expect(cardsFromRelated(["TL-MAC-029", "TL-MAC-014"], allowed)).toEqual([{ kind: "open_details", ruleId: "TL-MAC-029" }]);
  });

  it("falls to details when the scan is not ready and ignores unknown ids", () => {
    const notReady = buildAllowed(sourceFor(true, EMPTY_GUIDED_MEMORY, { scanReady: false }));
    expect(cardsFromRelated(["TL-MAC-022", "TL-MAC-999" as RuleId], notReady)).toEqual([{ kind: "open_details", ruleId: "TL-MAC-022" }]);
    expect(cardsFromRelated([], allowed)).toEqual([]);
  });

  it("intentsFor is the validated intents and never derives a card from relatedRuleIds", () => {
    const intents = [{ kind: "rescan" as const, ruleId: null }];
    const pointed = { intents, relatedRuleIds: ["TL-MAC-022" as RuleId] };
    const greeting = { intents: [], relatedRuleIds: ["TL-MAC-022" as RuleId] };
    expect(intentsFor(pointed, allowed)).toBe(intents);
    expect(intentsFor(greeting, allowed)).toEqual([]);
  });
});

describe("stillAllowed", () => {
  const allowed = buildAllowed(sourceFor(true));

  it("checks the kind and the id's list", () => {
    expect(stillAllowed({ kind: "fix_rule", ruleId: "TL-MAC-022" }, allowed)).toBe(true);
    expect(stillAllowed({ kind: "fix_rule", ruleId: "TL-MAC-001" }, allowed)).toBe(false);
    expect(stillAllowed({ kind: "show_where", ruleId: "TL-MAC-001" }, allowed)).toBe(true);
    expect(stillAllowed({ kind: "fix_rule", ruleId: null }, allowed)).toBe(false);
    expect(stillAllowed({ kind: "fix_batch", ruleId: null }, allowed)).toBe(true);
    expect(stillAllowed({ kind: "fix_batch", ruleId: null }, { ...allowed, batch: [] })).toBe(false);
    expect(stillAllowed({ kind: "rescan", ruleId: null }, allowed)).toBe(true);
    expect(stillAllowed({ kind: "open_watch", ruleId: null }, { ...allowed, kinds: allowed.kinds.filter((k) => k !== "open_watch") })).toBe(false);
  });

  it("the agent kinds: remind and what_if by their lists, write_up by kinds, investigate by signal or details id, the gated two by kinds", () => {
    expect(stillAllowed({ kind: "remind_rule", ruleId: "TL-MAC-022", when: "tomorrow" }, allowed)).toBe(true);
    expect(stillAllowed({ kind: "remind_rule", ruleId: "TL-MAC-014", when: "tomorrow" }, allowed)).toBe(false);
    expect(stillAllowed({ kind: "what_if", ruleId: "TL-MAC-014" }, allowed)).toBe(true);
    expect(stillAllowed({ kind: "what_if", ruleId: "TL-MAC-004" }, allowed)).toBe(false);
    expect(stillAllowed({ kind: "write_up", ruleId: null }, allowed)).toBe(true);
    expect(stillAllowed({ kind: "write_up", ruleId: null }, { ...allowed, kinds: allowed.kinds.filter((k) => k !== "write_up") })).toBe(false);
    expect(stillAllowed({ kind: "close_watch", ruleId: null }, allowed)).toBe(WATCH_AGENT_PORTS_READY);
    expect(stillAllowed({ kind: "investigate", ruleId: null, signalId: "sig.persistence_new" }, allowed)).toBe(WATCH_AGENT_PORTS_READY);
    const ready = buildAllowed(sourceFor(true), true);
    expect(stillAllowed({ kind: "close_watch", ruleId: null }, ready)).toBe(true);
    expect(stillAllowed({ kind: "investigate", ruleId: null, signalId: "sig.persistence_new" }, ready)).toBe(true);
    expect(stillAllowed({ kind: "investigate", ruleId: null, signalId: "sig.listener_new_ports" }, ready)).toBe(false);
    expect(stillAllowed({ kind: "investigate", ruleId: "TL-MAC-004", signalId: null }, ready)).toBe(true);
    expect(stillAllowed({ kind: "investigate", ruleId: null, signalId: null }, ready)).toBe(false);
  });
});
