// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { fakePlan } from "../app/testing";
import type { FixingState } from "../scan/machine";
import { useFixActivity } from "./useActivity";

afterEach(cleanup);

const plan = fakePlan({ ruleId: "TL-MAC-002", needsPassword: true });

function single(phase: FixingState["phase"], extra: Partial<Extract<FixingState, { kind: "single" }>> = {}): FixingState {
  return { kind: "single", plan, phase, step: 1, of: 1, error: null, result: null, ...extra };
}

interface Props {
  cardId: string;
  fixing: FixingState | null;
  preparing: boolean;
}

function setup(initial: Props) {
  let tick = 100;
  const now = () => {
    tick += 10;
    return tick;
  };
  const hook = renderHook((p: Props) => useFixActivity(p.cardId, p.fixing, p.preparing, now), { initialProps: initial });
  return hook;
}

describe("useFixActivity", () => {
  it("accumulates rows in order, keeps the first row's `at`, and keeps rows once the fix settles", () => {
    const hook = setup({ cardId: "s1", fixing: null, preparing: true });
    expect(hook.result.current.map((r) => r.kind)).toEqual(["preparing"]);
    const firstAt = hook.result.current[0]?.at;
    hook.rerender({ cardId: "s1", fixing: single("confirm"), preparing: true });
    hook.rerender({ cardId: "s1", fixing: single("waiting_for_password"), preparing: false });
    hook.rerender({ cardId: "s1", fixing: single("rechecking"), preparing: false });
    hook.rerender({ cardId: "s1", fixing: single("done", { result: "pass" }), preparing: false });
    expect(hook.result.current.map((r) => `${r.kind}:${r.status}`)).toEqual(["preparing:done", "fixing:done", "rechecking:done"]);
    expect(hook.result.current[0]?.at).toBe(firstAt);
    hook.rerender({ cardId: "s1", fixing: null, preparing: false });
    expect(hook.result.current.length).toBe(3);
  });

  it("clears on a new card", () => {
    const hook = setup({ cardId: "s1", fixing: single("waiting_for_password"), preparing: false });
    expect(hook.result.current.length).toBe(2);
    hook.rerender({ cardId: "s2", fixing: null, preparing: false });
    expect(hook.result.current).toEqual([]);
    hook.rerender({ cardId: "s2", fixing: null, preparing: true });
    expect(hook.result.current.map((r) => r.kind)).toEqual(["preparing"]);
  });

  it("clears on a second tap after a failed sequence, and keeps the rows on the settle render", () => {
    const hook = setup({ cardId: "s1", fixing: null, preparing: true });
    hook.rerender({ cardId: "s1", fixing: single("rechecking"), preparing: false });
    hook.rerender({ cardId: "s1", fixing: single("done", { result: "still_failing" }), preparing: false });
    expect(hook.result.current.at(-1)?.status).toBe("failed");
    hook.rerender({ cardId: "s1", fixing: null, preparing: false });
    expect(hook.result.current.length).toBe(3);
    hook.rerender({ cardId: "s1", fixing: null, preparing: true });
    expect(hook.result.current.map((r) => `${r.kind}:${r.status}`)).toEqual(["preparing:running"]);
  });

  it("has no rows when nothing ran", () => {
    const hook = setup({ cardId: "s1", fixing: null, preparing: false });
    expect(hook.result.current).toEqual([]);
    hook.rerender({ cardId: "s1", fixing: null, preparing: false });
    expect(hook.result.current).toEqual([]);
  });

  it("returns the same array when nothing changed", () => {
    const hook = setup({ cardId: "s1", fixing: single("waiting_for_password"), preparing: false });
    const first = hook.result.current;
    hook.rerender({ cardId: "s1", fixing: single("waiting_for_password"), preparing: false });
    expect(hook.result.current).toEqual(first);
  });
});
