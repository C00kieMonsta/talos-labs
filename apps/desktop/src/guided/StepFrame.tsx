import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { RuleId } from "@talos/core";
import { useApp } from "../app/context";
import { CircleCheck } from "lucide-react";
import { ICONS } from "../app/icons";
import { Icon } from "../components/Icon";
import { ExplainPanel } from "./ExplainPanel";

export interface StepAction {
  readonly label: string;
  onClick(): void;
  readonly disabled?: boolean;
}

export interface StepFrameProps {
  /** null hides the progress line (welcome, end). */
  readonly progress: { readonly done: number; readonly of: number } | null;
  /** Shown after the progress line in Developer mode. */
  readonly devId?: string | null;
  readonly title: string;
  /** One or two short sentences. */
  readonly body?: ReactNode;
  /** Lists, forms, status lines. */
  readonly children?: ReactNode;
  readonly primary?: StepAction | null;
  readonly link?: StepAction | null;
  /** The "Explain this" disclosure, only when AI is usable. */
  readonly explainRuleId?: RuleId | null;
  /** A one-line notice from the step before (the watcher cap). */
  readonly notice?: string | null;
  /** A spinner line with role="status". */
  readonly status?: string | null;
  /** The tick next to the headline. */
  readonly done?: boolean;
  /** Rendered between the primary button and the link (the paywall's licence field). */
  readonly afterPrimary?: ReactNode;
  readonly className?: string;
}

let interacted = false;
if (typeof window !== "undefined") {
  const mark = () => {
    interacted = true;
  };
  window.addEventListener("pointerdown", mark, { capture: true });
  window.addEventListener("keydown", mark, { capture: true });
}

/** For tests: pretend the person has already interacted, so headings take focus. */
export function markInteracted(): void {
  interacted = true;
}

/** Progress, headline, sentences, one primary button and one text link. Focus moves to the headline on every step. */
export function StepFrame(props: StepFrameProps) {
  const { progress, devId, title, body, children, primary, link, explainRuleId, notice, status, done, className, afterPrimary } = props;
  const { settings, aiUsable, ai } = useApp();
  const heading = useRef<HTMLHeadingElement>(null);
  // The on-device probe is lazy; a step that can explain asks once, like the expert AI card does.
  const wantsExplain = explainRuleId !== null && explainRuleId !== undefined && settings.explainer.aiEnabled;
  useEffect(() => {
    if (wantsExplain && ai.availability === null) void ai.probe();
  }, [wantsExplain, ai]);
  // The launch screen is left alone, like the expert home; every step after the first interaction takes focus.
  useEffect(() => {
    if (interacted) heading.current?.focus();
  }, [title]);
  const percent = progress === null || progress.of === 0 ? 0 : Math.round((progress.done / progress.of) * 100);
  return (
    <main className={className === undefined ? "guided-step" : `guided-step ${className}`} data-guided-done={done === true ? "true" : undefined}>
      {notice !== null && notice !== undefined && (
        <p className="guided-notice" role="status">
          {notice}
        </p>
      )}
      {progress !== null && (
        <div className="guided-progress">
          <p className="guided-meta">
            {progress.done} of {progress.of}
            {settings.developer.enabled && devId !== null && devId !== undefined && <span className="mono"> {devId}</span>}
          </p>
          <div className="guided-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.of} aria-valuenow={progress.done} aria-valuetext={`Step ${progress.done} of ${progress.of}`}>
            <div style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      <h1 ref={heading} tabIndex={-1} className="guided-title">
        {done === true && <CircleCheck size={26} aria-hidden="true" className="guided-tick" />}
        <span>{title}</span>
      </h1>
      <span role="status" className="visually-hidden">
        {done === true ? title : `Next: ${title}`}
      </span>
      {body !== undefined && body !== null && <div className="guided-body">{body}</div>}
      {children}
      {status !== null && status !== undefined && (
        <p className="guided-status" role="status">
          <Icon icon={ICONS.spinner} size={20} className="spin" />
          <span>{status}</span>
        </p>
      )}
      {aiUsable && explainRuleId !== null && explainRuleId !== undefined && <ExplainPanel ruleId={explainRuleId} />}
      {primary !== null && primary !== undefined && (
        <div className="guided-actions">
          <button type="button" className="button button-primary guided-primary" onClick={primary.onClick} disabled={primary.disabled} aria-disabled={primary.disabled}>
            {primary.label}
          </button>
        </div>
      )}
      {afterPrimary}
      {link !== null && link !== undefined && (
        <button type="button" className="guided-link" onClick={link.onClick} disabled={link.disabled}>
          {link.label}
        </button>
      )}
    </main>
  );
}
