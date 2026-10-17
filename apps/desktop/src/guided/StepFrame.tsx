import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { RuleId } from "@talos/core";
import { useApp } from "../app/context";
import { MARK_GRADIENT_FILL } from "../components/GradientDefs";
import { CheckIcon } from "../components/icons";
import { ExplainPanel } from "./ExplainPanel";

export interface StepAction {
  readonly label: string;
  onClick(): void;
  readonly disabled?: boolean;
}

export interface StepFrameProps {
  /** null hides the progress line (welcome, end). The bar fills to `done`, the number shown. */
  readonly progress: { readonly done: number; readonly of: number } | null;
  /** Shown after the progress line in Developer mode. */
  readonly devId?: string | null;
  readonly title: string;
  /** An id for the headline, so a group inside the step can be labelled by it. */
  readonly titleId?: string;
  /** One or two short sentences. */
  readonly body?: ReactNode;
  /** Lists, forms, status lines. */
  readonly children?: ReactNode;
  readonly primary?: StepAction | null;
  readonly link?: StepAction | null;
  /** The "Explain this" disclosure, whenever AI is switched on; the panel itself says when nothing is connected. */
  readonly explainRuleId?: RuleId | null;
  /** Unlock in the disclosure's locked line: opens the paywall step. */
  onUnlock?(): void;
  /** A one-line notice from the step before (the watcher cap). */
  readonly notice?: string | null;
  /** A status line with the rust dot and role="status". */
  readonly status?: string | null;
  /** A done step: the status mark, and the live region reads the headline as the result. */
  readonly done?: boolean;
  /** true draws the 56 px status mark without the done semantics; false keeps a done step without the mark (a batch). */
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
  const { progress, devId, title, titleId, body, children, primary, link, explainRuleId, onUnlock, notice, status, done, mark, className, afterPrimary } = props;
  const { settings, ai } = useApp();
  const heading = useRef<HTMLHeadingElement>(null);
  // The disclosure shows whenever AI is on; its body carries the not-connected and locked states itself.
  const wantsExplain = explainRuleId !== null && explainRuleId !== undefined && settings.explainer.aiEnabled;
  // The probe is lazy; a step with a disclosure asks once, like the expert AI card does.
  useEffect(() => {
    if (wantsExplain && ai.availability === null) void ai.probe();
  }, [wantsExplain, ai]);
  // The launch screen is left alone, like the expert home; every step after the first interaction takes focus.
  useEffect(() => {
    if (interacted) heading.current?.focus();
  }, [title]);
  const percent = progress === null || progress.of === 0 ? 0 : (progress.done / progress.of) * 100;
  // A div: the guided shell owns the main landmark.
  return (
    <div className={className === undefined ? "guided-step" : `guided-step ${className}`} data-guided-done={done === true ? "true" : undefined}>
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
          <div className="guided-bar" role="progressbar" aria-label="Check-up progress" aria-valuemin={0} aria-valuemax={progress.of} aria-valuenow={progress.done} aria-valuetext={`Step ${progress.done} of ${progress.of}`}>
            <div style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
      {((done === true && mark !== false) || mark === true) && (
        <div className="guided-status-mark" aria-hidden="true">
          <svg className="guided-status-disc" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
            <circle cx="28" cy="28" r="28" fill={MARK_GRADIENT_FILL} />
          </svg>
          <CheckIcon size={28} strokeWidth={1.75} className="guided-tick" aria-hidden="true" focusable="false" />
        </div>
      )}
      <h1 ref={heading} id={titleId} tabIndex={-1} className="guided-title">
        <span>{title}</span>
      </h1>
      <span role="status" className="visually-hidden">
        {done === true ? title : `Next: ${title}`}
      </span>
      {body !== undefined && body !== null && <div className="guided-body">{body}</div>}
      {children}
      {status !== null && status !== undefined && (
        <p className="guided-status" role="status">
          <span className="scan-dot scan-dot-active" aria-hidden="true" />
          <span>{status}</span>
        </p>
      )}
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
      {wantsExplain && explainRuleId !== null && explainRuleId !== undefined && <ExplainPanel ruleId={explainRuleId} onUnlock={onUnlock} />}
    </div>
  );
}
