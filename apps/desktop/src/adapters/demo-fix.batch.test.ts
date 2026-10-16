import { afterEach, describe, expect, it } from "vitest";
import type { FixProgress } from "@talos/core";
import { createDemoAdapters } from "./demo";
import type { DemoBatchOutcome } from "./demo-fix";

const IDS = ["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"] as const;

afterEach(() => {
  delete window.__talosDemoCalls;
});

async function run(batch: DemoBatchOutcome) {
  const adapters = createDemoAdapters({ fixture: "dev-machine", batch, fixDelayMs: 0, collectDelayMs: 0 });
  const plan = await adapters.fixes.previewBatch(IDS);
  const progress: FixProgress[] = [];
  const outcome = await adapters.fixes.applyBatch(plan.planId, { onProgress: (p) => progress.push(p) });
  return { adapters, plan, progress, outcome };
}

describe("DemoFixPort batch", () => {
  it("previewBatch builds one item per rule from the catalog and records the call with the id list", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", fixDelayMs: 0 });
    const plan = await adapters.fixes.previewBatch(IDS);
    expect(plan.items.map((i) => i.ruleId)).toEqual([...IDS]);
    expect(plan.items.every((i) => i.lines.length > 0)).toBe(true);
    expect(plan.excluded).toEqual([]);
    expect(plan.needsPassword).toBe(true);
    expect(plan.recheck).toContain("firewall");
    expect(new Set(plan.recheck).size).toBe(plan.recheck.length);
    expect(window.__talosDemoCalls).toEqual([{ kind: "fixPreviewBatch", arg: [...IDS] }]);
    expect(JSON.stringify(window.__talosDemoCalls)).not.toMatch(/https?:/);
  });

  it("previewBatch refuses a duplicate, a rule that takes a path, a passphrase rule and an unknown rule", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", fixDelayMs: 0 });
    await expect(adapters.fixes.previewBatch(["TL-MAC-002", "TL-MAC-002"])).rejects.toBe("invalid_choice");
    await expect(adapters.fixes.previewBatch(["TL-MAC-022"])).rejects.toBe("invalid_choice");
    await expect(adapters.fixes.previewBatch(["TL-MAC-029"])).rejects.toBe("invalid_choice");
    await expect(adapters.fixes.previewBatch(["TL-MAC-001"])).rejects.toBe("not_in_catalog");
    await expect(adapters.fixes.previewBatch([])).rejects.toBe("invalid_choice");
  });

  it("batch=ok runs every item with item progress, passes the touched sections and records the apply", async () => {
    const { adapters, plan, progress, outcome } = await run("ok");
    expect(outcome).toEqual({ ok: true, items: IDS.map((ruleId) => ({ ruleId, status: "done", error: null, step: null })), error: null });
    expect(progress[0]).toEqual({ planId: plan.planId, phase: "waiting_for_password", step: 1, of: 1 });
    expect(progress.filter((p) => p.phase === "running").map((p) => p.item)).toEqual(plan.items.flatMap((item, i) => item.lines.map(() => i)));
    expect((await adapters.systemState.collectSection("firewall")).status).toBe("ok");
    expect(window.__talosDemoCalls?.map((c) => c.kind)).toEqual(["fixPreviewBatch", "fixApplyBatch"]);
    expect(window.__talosDemoCalls?.[1]?.arg).toBe(plan.planId);
    expect(await adapters.fixes.applyBatch(plan.planId)).toEqual({ ok: false, items: [], error: "plan_expired" });
  });

  it("batch=partial fails the second item at step 0 with command_failed, no batch error, the first item's sections passing", async () => {
    const { adapters, outcome } = await run("partial");
    expect(outcome).toEqual({
      ok: false,
      items: [
        { ruleId: "TL-MAC-002", status: "done", error: null, step: null },
        { ruleId: "TL-MAC-003", status: "failed", error: "command_failed", step: 0 },
        { ruleId: "TL-MAC-011", status: "not_run", error: null, step: null },
      ],
      error: null,
    });
    expect((await adapters.systemState.collectSection("firewall")).status).toBe("ok");
  });

  it.each(["cancelled", "wrong_password"] as const)("batch=%s ends at the password dialog with nothing run", async (batch) => {
    const { outcome, progress } = await run(batch);
    expect(outcome).toEqual({ ok: false, items: IDS.map((ruleId) => ({ ruleId, status: "not_run", error: null, step: null })), error: batch });
    expect(progress.map((p) => p.phase)).toEqual(["waiting_for_password"]);
  });

  it("batch=timeout fails the dialog with nothing run", async () => {
    const { outcome } = await run("timeout");
    expect(outcome).toEqual({ ok: false, items: IDS.map((ruleId) => ({ ruleId, status: "not_run", error: null, step: null })), error: "timeout" });
  });

  it("an aborted signal during the run reports cancelled and records fixCancel", async () => {
    const adapters = createDemoAdapters({ fixture: "dev-machine", fixDelayMs: 50 });
    const plan = await adapters.fixes.previewBatch(IDS);
    const controller = new AbortController();
    const pending = adapters.fixes.applyBatch(plan.planId, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ ok: false, items: IDS.map((ruleId) => ({ ruleId, status: "not_run", error: null, step: null })), error: "cancelled" });
    expect(window.__talosDemoCalls?.map((c) => c.kind)).toEqual(["fixPreviewBatch", "fixApplyBatch", "fixCancel"]);
  });
});
