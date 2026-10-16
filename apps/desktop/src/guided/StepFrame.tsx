import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { RuleId } from "@talos/core";
import { useApp } from "../app/context";
import { ICONS } from "../app/icons";
import { Icon } from "../components/Icon";
import { CheckIcon } from "../components/icons";
import { ExplainPanel } from "./ExplainPanel";

export interface StepAction {
  readonly label: string;
  onClick(): void;
  readonly disabled?: boolean;
}

export interface StepFrameProps {
  /** null hides the progress line (welcome, end). `completed` fills the bar when it differs from the shown number. */
  readonly progress: { readonly done: number; readonly of: number; readonly completed?: number } | null;
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
  /** A done step: the status mark, and the live region reads the headline as the result. */
  readonly done?: boolean;
  /** The 56 px status mark above the headline without the done semantics (the end screens). */
  readonly mark?: boolean;
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
  window.addEventListener("click", mark, { capture: true });
  window.addEventListener("keydown", mark, { capture: true });
}

/** For tests: pretend the person has already interacted, so headings take focus. */
export function markInteracted(): void {
  interacted = true;
}

/** Progress, headline, sentences, one primary button and one text link. Focus moves to the headline on every step. */
export function StepFrame(props: StepFrameProps) {
  const { progress, devId, title, body, children, primary, link, explainRuleId, notice, status, done, mark, className, afterPrimary } = props;
  const { settings, aiUsable, ai, gate } = useApp();
  // Locked AI (the free tier) hides the disclosure; the paywall step already covers the full version.
  const canExplain = aiUsable && gate.has("explainer");
  const heading = useRef<HTMLHeadingElement>(null);
  // The on-device probe is lazy; a step that can explain asks once, like the expert AI card does.
  const wantsExplain = explainRuleId !== null && explainRuleId !== undefined && settings.explainer.aiEnabled && gate.has("explainer");
  useEffect(() => {
    if (wantsExplain && ai.availability === null) void ai.probe();
  }, [wantsExplain, ai]);
  // The launch screen is left alone, like the expert home; every step after the first interaction takes focus.
  useEffect(() => {
    if (interacted) heading.current?.focus();
  }, [title]);
  const completed = progress?.completed ?? progress?.done ?? 0;
  const percent = progress === null || progress.of === 0 ? 0 : Math.round((completed / progress.of) * 100);
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
          <div className="guided-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.of} aria-valuenow={completed} aria-valuetext={`Step ${progress.done} of ${progress.of}`}>
            <div style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      {(done === true || mark === true) && (
        <div className="guided-status-mark" aria-hidden="true">
          <CheckIcon size={28} strokeWidth={1.75} className="guided-tick" aria-hidden="true" focusable="false" />
        </div>
      )}
      <h1 ref={heading} tabIndex={-1} className="guided-title">
        <span>{title}</span>
      </h1>
      <span role="status" className="visually-hidden">
        {done === true ? title : `Next: ${title}`}
      </span>
      {body !== undefined && body !== null && <div className="guided-body">{body}</div>}
      {children}
      {status !== null && status !== undefined && (
        <p className="guided-status" role="status">
          <Icon icon={ICONS.spinner} size={16} className="spin" />
          <span>{status}</span>
        </p>
      )}
      {canExplain && explainRuleId !== null && explainRuleId !== undefined && <ExplainPanel ruleId={explainRuleId} />}
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
