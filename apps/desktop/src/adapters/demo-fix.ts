import type { FixApplyInput, FixApplyOptions, FixChoice, FixError, FixOutcome, FixPlan, FixPlanLine, FixPort, Rule, RuleCatalog, RuleId, SectionKey } from "@talos/core";
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

/** Errors the real engine raises before anything runs; the demo reports them with no step. */
const PRE_RUN: readonly FixError[] = ["plan_expired", "precondition_changed", "not_in_catalog", "invalid_choice", "invalid_input", "busy"];

export const DEMO_PLAN_TTL_MS = 5 * 60_000;

export interface DemoFixOptions {
  readonly catalog: RuleCatalog;
  readonly outcome: DemoFixOutcome;
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

  async reveal(ruleId: RuleId, choice: FixChoice): Promise<void> {
    recordDemoCall({ kind: "fixReveal", arg: ruleId, prompt: choice.kind === "none" ? undefined : choice.path });
  }

  async openBuyPage(): Promise<void> {
    recordDemoCall({ kind: "openBuyPage" });
  }
}
