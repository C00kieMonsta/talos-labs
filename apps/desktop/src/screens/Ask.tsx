import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import type { Answer, RuleId } from "@talos/core";
import { EXPLAINER_LIMITS } from "@talos/core";
import { AiCard, useAiCardFlow } from "../components/AiCard";
import { Icon } from "../components/Icon";
import { ModelText } from "../components/ModelText";
import { useApp } from "../app/context";
import { ICONS } from "../app/icons";
import { ASK_CONNECT, EXPLAINER_FAILURE_LABELS, aiBadge } from "../app/labels";
import { useConnect } from "../scan/ai-connect";
import { lastReport } from "../scan/machine";
import type { AskMessage } from "../scan/useScan";

/** The counter is read with the box, not on every keystroke; one fixed notice fires near the limit. */
const NEAR_LIMIT = 100;
export const NEAR_LIMIT_NOTICE = `Fewer than ${NEAR_LIMIT} characters left`;
export const AI_OFF_COPY = "AI is switched off. Turn it on in Settings to ask questions about your report.";

/** One card per exchange: the question and the answer that followed it, if it has arrived. */
export function exchanges(messages: readonly AskMessage[]): { question: AskMessage | null; answer: AskMessage | null }[] {
  const out: { question: AskMessage | null; answer: AskMessage | null }[] = [];
  for (const message of messages) {
    const last = out[out.length - 1];
    if (message.turn.role === "user") out.push({ question: message, answer: null });
    else if (last !== undefined && last.answer === null) last.answer = message;
    else out.push({ question: null, answer: message });
  }
  return out;
}

/** The composer: one line with the Ask button. Disabled while no AI is connected; read-only while an answer is written. */
function AskForm({
  question,
  max,
  busy,
  disabled,
  inputRef,
  onChange,
  onSubmit,
}: {
  question: string;
  max: number;
  busy: boolean;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange(next: string): void;
  onSubmit(event: FormEvent): void;
}) {
  const nearLimit = max - question.length < NEAR_LIMIT;
  return (
    <form className={disabled ? "ask-form ask-form-disabled" : "ask-form"} onSubmit={onSubmit} aria-busy={busy} aria-disabled={disabled || undefined}>
      <label htmlFor="question" className="visually-hidden">
        Your question
      </label>
      <div className="ask-form-row">
        <input
          id="question"
          type="text"
          ref={inputRef}
          value={question}
          maxLength={max}
          autoComplete="off"
          placeholder="Ask about anything in your report"
          aria-describedby="question-count"
          onChange={(event) => onChange(event.target.value.slice(0, max))}
          readOnly={busy}
          disabled={disabled}
        />
        <button type="submit" className="button" disabled={disabled || busy || question.trim().length === 0}>
          Ask
        </button>
      </div>
      {/* The count is read with the box; it only shows once the limit is near. */}
      <span id="question-count" className={nearLimit ? "muted small ask-count" : "visually-hidden"}>
        {question.length} / {max}
      </span>
      <span role="status" className="visually-hidden">
        {nearLimit ? NEAR_LIMIT_NOTICE : ""}
      </span>
    </form>
  );
}

export function Ask() {
  const { scan, router, settings } = useApp();
  const connect = useConnect();
  // The conversation lives with the scan so it survives leaving this screen; the draft is saved on the way out.
  const messages = scan.conversation;
  const [question, setQuestion] = useState(scan.draft);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const textarea = useRef<HTMLInputElement>(null);
  const latest = useRef({ question, setDraft: scan.setDraft });
  latest.current = { question, setDraft: scan.setDraft };
  const report = lastReport(scan.scan);
  const max = EXPLAINER_LIMITS.maxQuestionChars;
  const flow = useAiCardFlow("ask");
  const badge = aiBadge(flow.provider);
  const streaming = flow.explain.kind === "running" && flow.explain.target === "ask";
  const partial = streaming ? (flow.explain.answerPartial ?? "") : null;
  const busy = flow.explain.kind === "running" || waiting;
  const usable = flow.state.kind === "available_idle" || flow.state.kind === "streaming" || flow.state.kind === "ready";

  useEffect(() => {
    return () => latest.current.setDraft(latest.current.question);
  }, []);

  if (!settings.explainer.aiEnabled) {
    return (
      <div className="screen ask">
        <p className="muted">{AI_OFF_COPY}</p>
      </div>
    );
  }

  if (flow.state.kind === "not_connected") {
    return (
      <div className="screen ask">
        <div className="ask-connect-row">
          <p>{ASK_CONNECT.line}</p>
          <button type="button" className="button" onClick={() => connect.open({ name: "ask" })}>
            {ASK_CONNECT.button}
          </button>
        </div>
        <AskForm question={question} max={max} busy={false} disabled inputRef={textarea} onChange={setQuestion} onSubmit={(event) => event.preventDefault()} />
      </div>
    );
  }

  if (!usable) {
    return (
      <div className="screen ask">
        <AiCard kind="ask" title="Ask" state={flow.state} provider={flow.provider} {...flow.handlers} />
      </div>
    );
  }

  if (report === null) {
    return (
      <div className="screen ask">
        <p className="muted">Run a check-up first. Questions are answered from your report.</p>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length === 0 || busy) return;
    setError(null);
    setWaiting(true);
    const history = messages.map((m) => m.turn);
    const result = await scan.ask(text, history);
    setWaiting(false);
    if (result.ok) {
      const answer: Answer = result.value;
      scan.setConversation([
        ...messages,
        { turn: { role: "user", text } },
        { turn: { role: "assistant", text: answer.answer }, related: answer.relatedRuleIds, outsideScope: answer.outsideScope },
      ]);
      setQuestion("");
    } else if (result.reason !== "cancelled") {
      setError(EXPLAINER_FAILURE_LABELS[result.reason]);
    }
    // The submit button was disabled under the user's focus; bring it back to the question box.
    textarea.current?.focus();
  }

  const headlineOf = (id: RuleId) => report?.findings.find((f) => f.ruleId === id)?.headline ?? id;

  const related = (message: AskMessage) =>
    message.related !== undefined &&
    message.related.length > 0 && (
      <ul className="related">
        {message.related.map((id) => (
          <li key={id}>
            <button type="button" className="finding-row related-row" data-rule-id={id} onClick={() => router.navigate({ name: "finding", ruleId: id })}>
              <span className="finding-row-content">
                <span className="finding-row-title">{headlineOf(id)}</span>
              </span>
              <Icon icon={ICONS.chevronRight} className="finding-card-chevron" />
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="screen ask">
      <div className="chat" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && partial === null && <p className="muted">Try: "Which of these should I do first?"</p>}
        {exchanges(messages).map((exchange, index) => (
          <div key={index} className="chat-turn chat-exchange">
            {exchange.question !== null && (
              <div className="chat-user">
                <p className="label visually-hidden">You</p>
                <ModelText text={exchange.question.turn.text} />
              </div>
            )}
            {exchange.answer !== null && (
              <div className="chat-assistant">
                <p className="label visually-hidden">AI, not verified</p>
                <ModelText text={exchange.answer.turn.text} />
                <p className="muted small chat-badge">{badge}</p>
                {exchange.answer.outsideScope === true && <p className="muted small">This question is outside what the check-up covers.</p>}
                {related(exchange.answer)}
              </div>
            )}
          </div>
        ))}
        {partial === null && waiting && <p className="muted">Thinking about your question.</p>}
        {partial !== null && (
          <div className="chat-turn chat-assistant chat-streaming">
            <p className="label visually-hidden">AI, not verified</p>
            <ModelText text={partial} caret />
            <p className="muted small" role="status">
              Writing
            </p>
            <button type="button" className="button button-small" onClick={flow.handlers.onStop}>
              <Icon icon={ICONS.stop} /> Stop
            </button>
          </div>
        )}
      </div>

      {error !== null && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      <AskForm question={question} max={max} busy={busy} disabled={false} inputRef={textarea} onChange={setQuestion} onSubmit={(event) => void submit(event)} />
    </div>
  );
}
