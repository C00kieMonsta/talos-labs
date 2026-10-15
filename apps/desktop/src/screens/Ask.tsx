import { useState } from "react";
import type { FormEvent } from "react";
import type { Answer, RuleId, Turn } from "@talos/core";
import { EXPLAINER_LIMITS } from "@talos/core";
import { Lock } from "../components/Lock";
import { ModelText } from "../components/ModelText";
import { useApp } from "../app/context";
import { EXPLAINER_FAILURE_LABELS } from "../app/labels";
import { lastReport } from "../scan/machine";

interface Message {
  readonly turn: Turn;
  readonly related?: readonly RuleId[];
  readonly outsideScope?: boolean;
}

export function Ask() {
  const { scan, router, gate, settings } = useApp();
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = lastReport(scan.scan);
  const max = EXPLAINER_LIMITS.maxQuestionChars;

  if (settings.explainer.provider === "none") {
    return (
      <main className="screen ask">
        <h1>Ask</h1>
        <p className="muted">Choose an AI provider in Settings to ask questions about your report.</p>
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
      setMessages([
        ...messages,
        { turn: { role: "user", text } },
        { turn: { role: "assistant", text: answer.answer }, related: answer.relatedRuleIds, outsideScope: answer.outsideScope },
      ]);
      setQuestion("");
    } else {
      setError(EXPLAINER_FAILURE_LABELS[result.reason]);
    }
    setBusy(false);
  }

  const titleOf = (id: RuleId) => report?.findings.find((f) => f.ruleId === id)?.title ?? id;

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
                    <button type="button" className="link-button" onClick={() => router.navigate({ name: "finding", ruleId: id })}>
                      {titleOf(id)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <p className="muted">Thinking about your question.</p>}
      </div>

      {error !== null && <p className="notice">{error}</p>}

      <form className="ask-form" onSubmit={submit}>
        <label htmlFor="question" className="visually-hidden">
          Your question
        </label>
        <textarea
          id="question"
          value={question}
          maxLength={max}
          rows={3}
          placeholder="Ask about anything in your report"
          onChange={(event) => setQuestion(event.target.value.slice(0, max))}
          disabled={busy}
        />
        <div className="ask-form-foot">
          <span className="muted small" aria-live="polite">
            {question.length} / {max}
          </span>
          <button type="submit" className="button button-primary" disabled={busy || question.trim().length === 0}>
            Ask
          </button>
        </div>
      </form>
    </main>
  );
}
