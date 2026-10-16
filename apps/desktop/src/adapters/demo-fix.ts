import type {
  BatchItemOutcome,
  BatchOutcome,
  BatchPlan,
  BatchPlanItem,
  FixApplyInput,
  FixApplyOptions,
  FixChoice,
  FixError,
  FixOutcome,
  FixPlan,
  FixPlanLine,
  FixPort,
  Rule,
  RuleCatalog,
  RuleId,
  SectionKey,
} from "@talos/core";
import { recordDemoCall, wait } from "./demo-shared";

/** What every demo Apply ends with. The FixError values stand in for both failure channels. */
export type DemoFixOutcome = "ok" | "still_failing" | FixError;

export const DEMO_FIX_OUTCOMES: readonly DemoFixOutcome[] = [
  "ok",
  "still_failing",
  "cancelled",
  "wrong_password",
  "command_failed",
  "timeout",
  "plan_expired",
  "precondition_changed",
  "not_in_catalog",
  "invalid_choice",
  "invalid_input",
  "busy",
];

/** What every demo batch ends with; partial fails the second item at step 0, the other three fail the dialog. */
export type DemoBatchOutcome = "ok" | "partial" | "cancelled" | "wrong_password" | "timeout";

export const DEMO_BATCH_OUTCOMES: readonly DemoBatchOutcome[] = ["ok", "partial", "cancelled", "wrong_password", "timeout"];

/** Errors the real engine raises before anything runs; the demo reports them with no step. */
const PRE_RUN: readonly FixError[] = ["plan_expired", "precondition_changed", "not_in_catalog", "invalid_choice", "invalid_input", "busy"];

export const DEMO_PLAN_TTL_MS = 5 * 60_000;

export interface DemoFixOptions {
  readonly catalog: RuleCatalog;
  readonly outcome: DemoFixOutcome;
  readonly batch?: DemoBatchOutcome;
  /** Pause between phases so each sheet state can be seen. */
  readonly delayMs: number;
  /** Called on ok so the fixture's sections turn passing before the recheck. */
  readonly onApplied: (recheck: readonly SectionKey[]) => void;
}

function choiceMatches(rule: Rule, choice: FixChoice): boolean {
  if (rule.fix.apply.kind !== "in_app") return false;
  switch (rule.fix.apply.choice) {
    case "none":
    case "all_ssh_keys":
      return choice.kind === "none";
    case "share":
      return choice.kind === "share";
    case "ssh_key":
      return choice.kind === "ssh_key";
  }
}

/** Mirrors Rust's batchable(): in-app, no path, no passphrase. */
function batchable(rule: Rule): boolean {
  return rule.fix.apply.kind === "in_app" && rule.fix.apply.choice === "none" && !rule.fix.apply.passphrase;
}

function lines(rule: Rule, choice: FixChoice): FixPlanLine[] {
  const path = choice.kind === "none" ? "" : choice.path;
  const rendered = rule.fix.commands.map(
    (command): FixPlanLine => ({
      text: [command.program, ...command.args.map((arg) => arg.split("{path}").join(path))].join(" "),
      privilege: command.needsAdmin ? "admin" : "user",
    }),
  );
  return rendered.length > 0 ? rendered : [{ text: `# ${rule.fix.summary}`, privilege: "user" }];
}

/** Plans from the catalog, applies nothing, and records every call. */
export class DemoFixPort implements FixPort {
  private readonly rules: ReadonlyMap<RuleId, Rule>;
  private readonly plans = new Map<string, FixPlan>();
  private readonly batches = new Map<string, BatchPlan>();
  private counter = 0;

  constructor(private readonly options: DemoFixOptions) {
    this.rules = new Map(options.catalog.rules.map((rule) => [rule.id, rule]));
  }

  async preview(ruleId: RuleId, choice: FixChoice): Promise<FixPlan> {
    recordDemoCall({ kind: "fixPreview", arg: ruleId });
    const rule = this.rules.get(ruleId);
    if (rule === undefined || rule.fix.apply.kind !== "in_app") throw "not_in_catalog";
    if (!choiceMatches(rule, choice)) throw "invalid_choice";
    this.counter += 1;
    const plan: FixPlan = {
      planId: `demo-${this.counter}`,
      ruleId,
      lines: lines(rule, choice),
      needsPassword: rule.fix.apply.needsPassword,
      needsPassphrase: rule.fix.apply.passphrase,
      recheck: rule.fix.apply.recheck,
      reversible: rule.fix.apply.reversible,
      previous: ruleId === "TL-MAC-013" ? "60" : null,
      expiresAt: new Date(Date.now() + DEMO_PLAN_TTL_MS).toISOString(),
    };
    this.plans.set(plan.planId, plan);
    return plan;
  }

  async apply(planId: string, _input: FixApplyInput, options?: FixApplyOptions): Promise<FixOutcome> {
    recordDemoCall({ kind: "fixApply", arg: planId });
    const plan = this.plans.get(planId);
    if (plan === undefined) return { ok: false, error: "plan_expired", step: null };
    const { outcome, delayMs } = this.options;
    if ((PRE_RUN as readonly string[]).includes(outcome)) return { ok: false, error: outcome as FixError, step: null };
    const signal = options?.signal;
    const of = plan.lines.length;
    try {
      if (plan.needsPassword) {
        options?.onProgress?.({ planId, phase: "waiting_for_password", step: 1, of });
        await wait(delayMs, signal);
        if (outcome === "cancelled" || outcome === "wrong_password") return { ok: false, error: outcome, step: 1 };
      }
      for (let step = 1; step <= of; step += 1) {
        options?.onProgress?.({ planId, phase: "running", step, of });
        await wait(delayMs, signal);
        if (outcome === "command_failed" && step === Math.min(2, of)) return { ok: false, error: "command_failed", step };
        if (outcome === "timeout" && step === 1) return { ok: false, error: "timeout", step };
      }
    } catch {
      recordDemoCall({ kind: "fixCancel", arg: planId });
      return { ok: false, error: "cancelled", step: 1 };
    }
    if (outcome === "cancelled") return { ok: false, error: "cancelled", step: 1 };
    if (outcome === "ok") this.options.onApplied(plan.recheck);
    return { ok: true };
  }

  async previewBatch(ruleIds: readonly RuleId[]): Promise<BatchPlan> {
    recordDemoCall({ kind: "fixPreviewBatch", arg: [...ruleIds] });
    if (ruleIds.length === 0 || new Set(ruleIds).size !== ruleIds.length) throw "invalid_choice";
    const items: BatchPlanItem[] = [];
    let needsPassword = false;
    const recheck: SectionKey[] = [];
    for (const ruleId of ruleIds) {
      const rule = this.rules.get(ruleId);
      if (rule === undefined || rule.fix.apply.kind !== "in_app") throw "not_in_catalog";
      if (!batchable(rule)) throw "invalid_choice";
      needsPassword = needsPassword || rule.fix.apply.needsPassword;
      for (const key of rule.fix.apply.recheck) if (!recheck.includes(key)) recheck.push(key);
      items.push({ ruleId, lines: lines(rule, { kind: "none" }), recheck: rule.fix.apply.recheck, previous: ruleId === "TL-MAC-013" ? "60" : null });
    }
    this.counter += 1;
    const plan: BatchPlan = {
      planId: `demo-batch-${this.counter}`,
      items,
      excluded: [],
      needsPassword,
      recheck,
      expiresAt: new Date(Date.now() + DEMO_PLAN_TTL_MS).toISOString(),
    };
    this.batches.set(plan.planId, plan);
    return plan;
  }

  async applyBatch(planId: string, options?: FixApplyOptions): Promise<BatchOutcome> {
    recordDemoCall({ kind: "fixApplyBatch", arg: planId });
    const plan = this.batches.get(planId);
    if (plan === undefined) return { ok: false, items: [], error: "plan_expired" };
    this.batches.delete(planId);
    const batch = this.options.batch ?? "ok";
    const { delayMs } = this.options;
    const signal = options?.signal;
    const of = plan.items.reduce((sum, item) => sum + item.lines.length, 0);
    const notRun = (from: number): BatchItemOutcome[] =>
      plan.items.slice(from).map((item) => ({ ruleId: item.ruleId, status: "not_run", error: null, step: null }));
    const done: BatchItemOutcome[] = [];
    try {
      if (plan.needsPassword) {
        options?.onProgress?.({ planId, phase: "waiting_for_password", step: 1, of: 1 });
        await wait(delayMs, signal);
        if (batch === "cancelled" || batch === "wrong_password") return { ok: false, items: notRun(0), error: batch };
      }
      let step = 0;
      for (const [index, item] of plan.items.entries()) {
        for (let line = 0; line < item.lines.length; line += 1) {
          step += 1;
          options?.onProgress?.({ planId, phase: "running", step, of, item: index });
          await wait(delayMs, signal);
          if (batch === "partial" && index === 1 && line === 0) {
            this.options.onApplied(done.flatMap((d) => plan.items.find((i) => i.ruleId === d.ruleId)?.recheck ?? []));
            return {
              ok: false,
              items: [...done, { ruleId: item.ruleId, status: "failed", error: "command_failed", step: 0 }, ...notRun(index + 1)],
              // Rust sets the batch error only when the dialog itself failed.
              error: null,
            };
          }
          if (batch === "timeout" && index === 0 && line === 0) {
            return { ok: false, items: notRun(0), error: "timeout" };
          }
        }
        done.push({ ruleId: item.ruleId, status: "done", error: null, step: null });
      }
    } catch {
      recordDemoCall({ kind: "fixCancel", arg: planId });
      return { ok: false, items: notRun(0), error: "cancelled" };
    }
    this.options.onApplied(plan.recheck);
    return { ok: true, items: done, error: null };
  }

  async reveal(ruleId: RuleId, choice: FixChoice): Promise<void> {
    recordDemoCall({ kind: "fixReveal", arg: ruleId, prompt: choice.kind === "none" ? undefined : choice.path });
  }

  async openBuyPage(): Promise<void> {
    recordDemoCall({ kind: "openBuyPage" });
  }
}
