import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { ALL_UNAVAILABLE } from "../../src/fixtures/all-unavailable";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { diffReports } from "../../src/guided/diff";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor } from "../helpers";

const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const HARD = evaluate(HARDENED, MACOS_CATALOG, ctxFor(HARDENED));
const UNAVAILABLE = evaluate(ALL_UNAVAILABLE, MACOS_CATALOG, ctxFor(ALL_UNAVAILABLE));
const DEV_FAILS = ["TL-MAC-001", "TL-MAC-002", "TL-MAC-003", "TL-MAC-010", "TL-MAC-011", "TL-MAC-014", "TL-MAC-022", "TL-MAC-026", "TL-MAC-029", "TL-MAC-032"];

describe("diffReports", () => {
  it("is empty with no previous report", () => {
    expect(diffReports(null, DEV, [])).toEqual({ fixed: [], appeared: [], unreadable: [] });
  });

  it("dev-machine then hardened: ten fixed", () => {
    const diff = diffReports(DEV, HARD, []);
    expect(diff.fixed).toEqual(DEV_FAILS);
    expect(diff.appeared).toEqual([]);
    expect(diff.unreadable).toEqual([]);
  });

  it("hardened then dev-machine: ten appeared, review changes not announced", () => {
    const diff = diffReports(HARD, DEV, []);
    expect(diff.appeared).toEqual(DEV_FAILS);
    expect(diff.fixed).toEqual([]);
    expect(diff.unreadable).toEqual([]);
  });

  it("dev-machine then all-unavailable: ten unreadable", () => {
    const diff = diffReports(DEV, UNAVAILABLE, []);
    expect(diff.unreadable).toEqual(DEV_FAILS);
    expect(diff.fixed).toEqual([]);
    expect(diff.appeared).toEqual([]);
  });

  it("the same report twice: empty", () => {
    expect(diffReports(DEV, DEV, [])).toEqual({ fixed: [], appeared: [], unreadable: [] });
  });

  it("a pendingRestart rule that passes counts as fixed once, even when the previous run already passed it", () => {
    const diff = diffReports(HARD, HARD, ["TL-MAC-001", "TL-MAC-010"]);
    expect(diff.fixed).toEqual(["TL-MAC-001", "TL-MAC-010"]);
    expect(diffReports(DEV, HARD, ["TL-MAC-001"]).fixed).toEqual(DEV_FAILS);
  });

  it("a pendingRestart rule that still fails is not fixed", () => {
    expect(diffReports(DEV, DEV, ["TL-MAC-001"]).fixed).toEqual([]);
  });
});
