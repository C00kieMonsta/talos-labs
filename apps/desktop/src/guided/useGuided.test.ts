import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import { DEV_MACHINE, HARDENED } from "@talos/core";
import { fakeAdapters, fakeSystemState } from "../app/testing";
import { renderGuided, reportFor } from "./testing";
import { claimLaunchScan, resetLaunchGuard } from "./timing";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetLaunchGuard();
});

/** Runs the paced scan to the ready report: collect, then the pacer's present(). */
async function scanToReady(hook: ReturnType<typeof renderGuided>["hook"]) {
  await act(async () => {
    await hook.result.current.scan.start();
  });
  await act(async () => {
    await hook.result.current.scan.present();
  });
}

describe("useGuided phases", () => {
  it("starts on Welcome when not onboarded, and on scanning when it is", () => {
    const welcome = renderGuided({ settings: { onboarded: false } });
    expect(welcome.hook.result.current.guided.phase.kind).toBe("welcome");
    const scanning = renderGuided();
    expect(scanning.hook.result.current.guided.phase.kind).toBe("scanning");
  });

  it("guards the launch scan: once per 60 s in one process", () => {
    expect(claimLaunchScan(1_000)).toBe(true);
    expect(claimLaunchScan(30_000)).toBe(false);
    expect(claimLaunchScan(62_000)).toBe(true);
  });

  it("lands on the plan with the dev-machine steps and a frozen free set", async () => {
    const { hook } = renderGuided();
    await scanToReady(hook);
    const { phase, progress } = hook.result.current.guided;
    expect(phase.kind).toBe("plan");
    if (phase.kind !== "plan") return;
    expect(phase.plan.steps.map((s) => s.id)).toEqual(["fix:TL-MAC-002", "show:TL-MAC-001", "show:TL-MAC-010", "permission:full_disk_access", "paywall"]);
    expect(phase.plan.freeFixes).toContain("TL-MAC-002");
    expect(phase.same).toBe(false);
    expect(progress).toEqual({ done: 0, of: 5 });
  });

  it("shows 'since last time' only on a non-empty diff, and 'Same n things' otherwise", async () => {
    const changed = renderGuided({ loadedReport: reportFor(HARDENED) });
    await scanToReady(changed.hook);
    const phase = changed.hook.result.current.guided.phase;
    expect(phase.kind).toBe("since");
    if (phase.kind === "since") expect(phase.diff.appeared.length).toBeGreaterThan(0);
    act(() => changed.hook.result.current.guided.carryOn());
    expect(changed.hook.result.current.guided.phase.kind).toBe("plan");

    const same = renderGuided({ loadedReport: reportFor(DEV_MACHINE) });
    await scanToReady(same.hook);
    const after = same.hook.result.current.guided.phase;
    expect(after.kind).toBe("plan");
    if (after.kind === "plan") expect(after.same).toBe(true);
  });

  it("lands on the failed phase and 'Try again' starts a scan", async () => {
    let calls = 0;
    const adapters = fakeAdapters({
      systemState: fakeSystemState(DEV_MACHINE, {
        collect: vi.fn(async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error("crash"), { kind: "collector_crashed" });
          return DEV_MACHINE;
        }),
      }),
    });
    const { hook } = renderGuided({ adapters });
    await act(async () => {
      await hook.result.current.scan.start();
    });
    const phase = hook.result.current.guided.phase;
    expect(phase).toEqual({ kind: "failed", error: "collector_crashed" });
    await act(async () => {
      hook.result.current.guided.start();
    });
    await waitFor(() => expect(hook.result.current.scan.scan.kind).toBe("presenting"));
    expect(calls).toBe(2);
  });

  it("goes straight to the end state on a hardened Mac", async () => {
    const { hook } = renderGuided({ adapters: fakeAdapters({}, HARDENED) });
    await scanToReady(hook);
    expect(hook.result.current.guided.phase.kind).toBe("end");
  });

  it("resumes at the first step after a guided relaunch, skipping the plan screen", async () => {
    const { hook } = renderGuided({ resume: true, loadedReport: reportFor(HARDENED) });
    await scanToReady(hook);
    const phase = hook.result.current.guided.phase;
    expect(phase.kind).toBe("step");
    if (phase.kind === "step") expect(phase.plan.steps[phase.index]?.id).toBe("fix:TL-MAC-002");
  });
});
