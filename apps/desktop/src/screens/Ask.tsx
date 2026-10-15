import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Answer, RuleId } from "@talos/core";
import { EXPLAINER_LIMITS } from "@talos/core";
import { Lock } from "../components/Lock";
import { ModelText } from "../components/ModelText";
import { useApp } from "../app/context";
import { EXPLAINER_FAILURE_LABELS } from "../app/labels";
import { lastReport } from "../scan/machine";
import { isInAppProvider } from "../settings";

/** The counter is read with the box, not on every keystroke; one fixed notice fires near the limit. */
const NEAR_LIMIT = 100;
export const NEAR_LIMIT_NOTICE = `Fewer than ${NEAR_LIMIT} characters left`;

export function Ask() {
  const { scan, router, gate, settings } = useApp();
  // The conversation lives with the scan so it survives leaving this screen; the draft is saved on the way out.
  const messages = scan.conversation;
  const [question, setQuestion] = useState(scan.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ question, setDraft: scan.setDraft });
  latest.current = { question, setDraft: scan.setDraft };
  const report = lastReport(scan.scan);
  const max = EXPLAINER_LIMITS.maxQuestionChars;

  useEffect(() => {
    return () => latest.current.setDraft(latest.current.question);
  }, []);

  if (!isInAppProvider(settings.explainer.provider)) {
    return (
      <main className="screen ask">
        <h1>Ask</h1>
        <p className="muted">
          Asking questions inside the app needs a Claude API key or a local Ollama model. Turn on Developer mode and
          choose an AI provider in Settings. Without one, the Explain buttons open your results in your own Claude or
          ChatGPT account.
        </p>
      </main>
    );
  }

  if (!gate.has("explainer")) {
    return (
      <main className="screen ask">
        <h1>Ask</h1>
        <Lock
          title="Asking questions is part of the full version"
          body="Enter a licence key in Settings to turn it on."
          action={
            <button type="button" className="button" onClick={() => router.navigate({ name: "settings" })}>
              Open Settings
            </button>
          }
        />
      </main>
    );
  }

  if (report === null) {
    return (
      <main className="screen ask">
        <h1>Ask</h1>
        <p className="muted">Run a check-up first. Questions are answered from your report.</p>
      </main>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (text.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const history = messages.map((m) => m.turn);
    const result = await scan.ask(text, history);
    if (result.ok) {
      const answer: Answer = result.value;
      scan.setConversation([
        ...messages,
        { turn: { role: "user", text } },
        { turn: { role: "assistant", text: answer.answer }, related: answer.relatedRuleIds, outsideScope: answer.outsideScope },
      ]);
      setQuestion("");
    } else {
      setError(EXPLAINER_FAILURE_LABELS[result.reason]);
    }
    setBusy(false);
    // The submit button was disabled under the user's focus; bring it back to the question box.
    textarea.current?.focus();
  }

  const headlineOf = (id: RuleId) => report?.findings.find((f) => f.ruleId === id)?.headline ?? id;

  return (
    <main className="screen ask">
      <header>
        <h1>Ask</h1>
        <p className="muted">
          Questions are answered from this report only. Answers are written by an AI model and are not verified.
        </p>
      </header>

      <div className="chat" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && <p className="muted">Try: "Which of these should I do first?"</p>}
        {messages.map((message, index) => (
          <div key={index} className={`chat-turn chat-${message.turn.role}`}>
            <p className="label">{message.turn.role === "user" ? "You" : "AI, not verified"}</p>
            <ModelText text={message.turn.text} />
            {message.outsideScope === true && (
              <p className="muted small">This question is outside what the check-up covers.</p>
            )}
            {message.related !== undefined && message.related.length > 0 && (
              <ul className="related">
                {message.related.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      className="link-button"
                      data-rule-id={id}
                      onClick={() => router.navigate({ name: "finding", ruleId: id })}
                    >
                      {headlineOf(id)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <p className="muted">Thinking about your question.</p>}
      </div>

      {error !== null && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}

      <form className="ask-form" onSubmit={submit} aria-busy={busy}>
        <label htmlFor="question" className="visually-hidden">
          Your question
        </label>
        <textarea
          id="question"
          ref={textarea}
          value={question}
          maxLength={max}
          rows={3}
          placeholder="Ask about anything in your report"
          aria-describedby="question-count"
          onChange={(event) => setQuestion(event.target.value.slice(0, max))}
          readOnly={busy}
        />
        <div className="ask-form-foot">
          <span id="question-count" className="muted small">
            {question.length} / {max}
          </span>
          <span role="status" className="visually-hidden">
            {max - question.length < NEAR_LIMIT ? NEAR_LIMIT_NOTICE : ""}
          </span>
          <button type="submit" className="button button-primary" disabled={busy || question.trim().length === 0}>
            Ask
          </button>
        </div>
      </form>
    </main>
  );
}
