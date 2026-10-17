import { describe, expect, it } from "vitest";
import { RUST_PROBE_IDS } from "../../src/ports/watch-port";
import { VALIDATE_CASES } from "../../src/watch/cases";
import { BANNED_VERBS, PATH_LIKE, PORT_LIKE, safeSentence, validateWatchVerdict } from "../../src/watch/validate";

const base = VALIDATE_CASES[0];
if (base === undefined || base.expected === "rejected") throw new Error("the first validate case must be the kept verdict");
const CONTEXT = base.context;
const GOOD = base.raw as Record<string, unknown>;

describe("validateWatchVerdict", () => {
  it("keeps a full verdict with the clamped rating", () => {
    const result = validateWatchVerdict(GOOD, CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rating).toBe("act_now");
    expect(result.value.basedOn).toEqual(["sig.persistence_new", "sig.listener_new_ports"]);
    expect(result.value.probes).toHaveLength(1);
    expect(result.value.actions).toEqual([{ actionId: "act.disconnect_network", sentence: "Cut the Mac off first." }]);
  });

  it("every fixture case answers as recorded", () => {
    for (const c of VALIDATE_CASES) {
      const result = validateWatchVerdict(c.raw, c.context);
      if (c.expected === "rejected") expect(result, c.name).toEqual({ ok: false, reason: "rejected_output" });
      else expect(result, c.name).toEqual({ ok: true, value: c.expected });
    }
  });

  it("has one case per rejection, one per drop and both clamps", () => {
    const names = VALIDATE_CASES.map((c) => c.name);
    for (const needle of [
      "rejected: not an object",
      "rejected: rating outside the enum",
      "rejected: unknown signal id",
      "rejected: duplicate signal id",
      "rejected: basedOn over the cap",
      "rejected: unknown probe id",
      "rejected: a Rust-only probe",
      "rejected: duplicate probe",
      "rejected: probes over the cap",
      "rejected: unknown action id",
      "rejected: duplicate action",
      "rejected: actions over the cap",
      "clamped: rating above the ceiling",
      "clamped: rating below the floor",
      "dropped: command text in the reason",
      "dropped: a path in the reason",
      "dropped: a port in the reason",
      "dropped: a reason over 120 characters",
      "kept: a reason of exactly 120 characters",
      "dropped: an action sentence over 300 characters stays dropped, a 200-character one is kept",
      "dropped: an action whose floor is above the clamped rating",
      "dropped: an action with no changed trigger",
    ]) {
      expect(names, needle).toContain(needle);
    }
    for (const verb of ["pid", "process", "kill", "delete", "remove", "rm", "unload"]) {
      expect(names).toContain(`dropped: the verb ${verb} in an action sentence`);
    }
  });

  it("rejects both Rust-only probes even when the context lists them", () => {
    for (const id of RUST_PROBE_IDS) {
      const context = { ...CONTEXT, probesAvailable: [...CONTEXT.probesAvailable, id as never] };
      expect(validateWatchVerdict({ ...GOOD, probes: [{ probeId: id, reason: "" }] }, context).ok).toBe(false);
    }
  });

  it("never throws on odd shapes", () => {
    for (const raw of [null, undefined, 1, [], "", { rating: "calm" }, { rating: "calm", ratingReason: "", basedOn: null, probes: [], actions: [] }]) {
      expect(validateWatchVerdict(raw, CONTEXT)).toEqual({ ok: false, reason: "rejected_output" });
    }
  });
});

describe("safeSentence and the three patterns", () => {
  it("accepts plain sentences, including times with one colon-free form", () => {
    expect(safeSentence("Two things changed within the hour.")).toBe(true);
    expect(safeSentence("")).toBe(true);
  });

  it("refuses paths, tildes, ports, the seven verbs and command text", () => {
    expect(PATH_LIKE.test("/usr/bin")).toBe(true);
    expect(PATH_LIKE.test("~/Library")).toBe(true);
    expect(PATH_LIKE.test('"/Users/alice"')).toBe(true);
    expect(PATH_LIKE.test("(/tmp/x)")).toBe(true);
    expect(PATH_LIKE.test("folder:/Library")).toBe(true);
    expect(PATH_LIKE.test("and/or")).toBe(false);
    expect(PATH_LIKE.test("24/7")).toBe(false);
    expect(PORT_LIKE.test("on :8080 now")).toBe(true);
    expect(PORT_LIKE.test("port :8080")).toBe(true);
    expect(PORT_LIKE.test("at 14:32")).toBe(false);
    expect(PORT_LIKE.test("18:00")).toBe(false);
    expect(PORT_LIKE.test("ratio 1:2")).toBe(false);
    for (const verb of ["pid", "Process", "KILL", "delete", "remove", "rm", "unload"]) expect(BANNED_VERBS.test(`please ${verb} it`), verb).toBe(true);
    expect(BANNED_VERBS.test("the processor is warm")).toBe(false);
    expect(safeSentence("$ ls -la")).toBe(false);
    expect(safeSentence("a".repeat(301))).toBe(false);
    expect(safeSentence("a".repeat(300))).toBe(true);
  });
});
