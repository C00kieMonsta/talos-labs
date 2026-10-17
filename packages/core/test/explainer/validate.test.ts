import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { explainerEligibleRuleIds, toExplainerContext } from "../../src/explainer/context";
import { buildOnDevicePrompt } from "../../src/explainer/on-device-prompt";
import { containsCommandText, validateAnswer, validateExplanation, validatePrioritisation } from "../../src/explainer/validate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor } from "../helpers";

const report = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const eligible = [...explainerEligibleRuleIds(report)];
const REJECTED = { ok: false, reason: "rejected_output" };

const goodExplanation = {
  ruleId: "TL-MAC-001",
  whyItMattersForYou: "Your laptop leaves home, so a lost bag means lost files.",
  whatCouldHappen: "Anyone with the disk can read everything.",
  urgency: "today",
};

describe("containsCommandText", () => {
  it("flags fenced blocks and command lines, including indented ones", () => {
    expect(containsCommandText("run this:\n```\nls\n```")).toBe(true);
    expect(containsCommandText("sudo rm -rf /")).toBe(true);
    expect(containsCommandText("first line\n  $ ls")).toBe(true);
    expect(containsCommandText("curl http://x")).toBe(true);
    expect(containsCommandText("bash script.sh")).toBe(true);
    expect(containsCommandText("Open System Settings and turn FileVault on.")).toBe(false);
    expect(containsCommandText("The sudo command is not needed here.")).toBe(false);
  });

  it("catches a streamed partial that opens a fenced block before it is closed", () => {
    expect(containsCommandText("First turn FileVault on:\n```\nsudo fdese")).toBe(true);
    expect(validateExplanation({ ...goodExplanation, whyItMattersForYou: "Try this:\n```" }, report)).toEqual(REJECTED);
  });
});

describe("validateExplanation", () => {
  it("accepts a well-formed explanation and drops unknown fields", () => {
    const result = validateExplanation({ ...goodExplanation, extra: "dropped", steps: ["sudo x"] }, report);
    expect(result).toEqual({ ok: true, value: goodExplanation });
  });

  it("rejects a ruleId that is not in the report", () => {
    expect(validateExplanation({ ...goodExplanation, ruleId: "TL-MAC-999" }, report)).toEqual(REJECTED);
  });

  it("rejects a fenced block and a sudo line", () => {
    expect(validateExplanation({ ...goodExplanation, whyItMattersForYou: "```\nls\n```" }, report)).toEqual(REJECTED);
    expect(validateExplanation({ ...goodExplanation, whatCouldHappen: "Do this:\nsudo fdesetup enable" }, report)).toEqual(REJECTED);
  });

  it("rejects oversize strings", () => {
    expect(validateExplanation({ ...goodExplanation, whyItMattersForYou: "a".repeat(1201) }, report)).toEqual(REJECTED);
    expect(validateExplanation({ ...goodExplanation, whyItMattersForYou: "a".repeat(1200) }, report).ok).toBe(true);
  });

  it("rejects a bad urgency, a missing field, an empty text and non-object input", () => {
    expect(validateExplanation({ ...goodExplanation, urgency: "now" }, report)).toEqual(REJECTED);
    expect(validateExplanation({ ...goodExplanation, whatCouldHappen: undefined }, report)).toEqual(REJECTED);
    expect(validateExplanation({ ...goodExplanation, whatCouldHappen: "   " }, report)).toEqual(REJECTED);
    expect(validateExplanation(null, report)).toEqual(REJECTED);
    expect(validateExplanation("text", report)).toEqual(REJECTED);
    expect(validateExplanation([goodExplanation], report)).toEqual(REJECTED);
  });
});

describe("validatePrioritisation", () => {
  const good = {
    order: [...eligible].reverse(),
    reasons: [{ ruleId: eligible[0], reason: "It is the biggest risk." }],
    startWith: eligible.slice(0, 3),
  };

  it("accepts a permutation of the eligible finding ids", () => {
    const result = validatePrioritisation({ ...good, junk: 1 }, report, eligible);
    expect(result).toEqual({ ok: true, value: good });
  });

  it("rejects a foreign id in order", () => {
    const order = [...good.order];
    order[0] = "TL-MAC-999";
    expect(validatePrioritisation({ ...good, order }, report, eligible)).toEqual(REJECTED);
  });

  it("rejects a non-permutation: missing, duplicated, or a passing rule", () => {
    expect(validatePrioritisation({ ...good, order: good.order.slice(1) }, report, eligible)).toEqual(REJECTED);
    expect(validatePrioritisation({ ...good, order: [...good.order.slice(1), good.order[1]] }, report, eligible)).toEqual(REJECTED);
    const withPass = [...good.order.slice(1), "TL-MAC-004"];
    expect(validatePrioritisation({ ...good, order: withPass }, report, eligible)).toEqual(REJECTED);
  });

  it("rejects oversize lists and command text in reasons", () => {
    const reasons = Array.from({ length: 11 }, () => ({ ruleId: eligible[0], reason: "x" }));
    expect(validatePrioritisation({ ...good, reasons }, report, eligible)).toEqual(REJECTED);
    expect(validatePrioritisation({ ...good, startWith: Array.from({ length: 11 }, () => eligible[0]) }, report, eligible)).toEqual(REJECTED);
    expect(validatePrioritisation({ ...good, reasons: [{ ruleId: eligible[0], reason: "$ ls" }] }, report, eligible)).toEqual(REJECTED);
    expect(validatePrioritisation({ ...good, reasons: [{ ruleId: "TL-MAC-999", reason: "x" }] }, report, eligible)).toEqual(REJECTED);
    expect(validatePrioritisation({ ...good, startWith: ["nope"] }, report, eligible)).toEqual(REJECTED);
  });

  it("rejects a missing list or a non-object", () => {
    expect(validatePrioritisation({ order: good.order, reasons: [] }, report, eligible)).toEqual(REJECTED);
    expect(validatePrioritisation(42, report, eligible)).toEqual(REJECTED);
  });
});

describe("validateAnswer", () => {
  const good = { answer: "Turn FileVault on first.", relatedRuleIds: ["TL-MAC-001"], outsideScope: false };

  it("accepts a well-formed answer and drops unknown fields", () => {
    expect(validateAnswer({ ...good, tools: [] }, report)).toEqual({ ok: true, value: good });
  });

  it("rejects a foreign related id, a bad boolean, command text and oversize", () => {
    expect(validateAnswer({ ...good, relatedRuleIds: ["TL-WIN-001"] }, report)).toEqual(REJECTED);
    expect(validateAnswer({ ...good, outsideScope: "no" }, report)).toEqual(REJECTED);
    expect(validateAnswer({ ...good, answer: "Try:\nbash -c 'x'" }, report)).toEqual(REJECTED);
    expect(validateAnswer({ ...good, answer: "a".repeat(1201) }, report)).toEqual(REJECTED);
    expect(validateAnswer({ ...good, relatedRuleIds: Array.from({ length: 11 }, () => "TL-MAC-001") }, report)).toEqual(REJECTED);
  });

  it("accepts an empty related list", () => {
    expect(validateAnswer({ ...good, relatedRuleIds: [] }, report).ok).toBe(true);
  });
});

describe("validatePrioritisation against the on-device kept list", () => {
  const profile = { role: "individual", technical: "medium", handlesClientData: false, laptopLeavesHome: false } as const;
  const built = buildOnDevicePrompt("prioritise", toExplainerContext(report, MACOS_CATALOG, profile), MACOS_CATALOG);
  const kept = [...built.kept];
  const good = { order: [...kept].reverse(), reasons: [{ ruleId: eligible[0], reason: "Biggest risk." }], startWith: [eligible[0]] };

  it("dev-machine keeps 12 of its 14 findings and reports two omitted", () => {
    expect(eligible).toHaveLength(14);
    expect(kept).toHaveLength(12);
    expect(built.omitted).toBe(2);
  });

  it("accepts a permutation of kept", () => {
    expect(validatePrioritisation(good, report, kept)).toEqual({ ok: true, value: good });
  });

  it("rejects a permutation of all 13 and a 12-id order missing one kept id", () => {
    expect(validatePrioritisation({ ...good, order: [...eligible].reverse() }, report, kept)).toEqual(REJECTED);
    const dropped = eligible.find((id) => !kept.includes(id));
    expect(dropped).toBeDefined();
    expect(validatePrioritisation({ ...good, order: [...kept.slice(1), dropped] }, report, kept)).toEqual(REJECTED);
  });

  it("lets reasons and startWith name the omitted finding", () => {
    const dropped = eligible.find((id) => !kept.includes(id)) as string;
    const raw = { ...good, reasons: [{ ruleId: dropped, reason: "Later." }], startWith: [dropped] };
    expect(validatePrioritisation(raw, report, kept)).toEqual({ ok: true, value: raw });
  });
});
