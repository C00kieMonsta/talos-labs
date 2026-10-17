import type { ActivityEvent } from "@talos/core";
import { ICONS, SEVERITY_ICONS } from "../app/icons";
import { useApp } from "../app/context";
import { formatTime } from "../app/labels";
import { watchActive } from "../app/gate";
import { Icon } from "../components/Icon";
import { LicenceField } from "../components/LicenceField";
import { PassphraseForm } from "../components/PassphraseSheet";
import { ExplainPanel } from "../guided/ExplainPanel";
import { GuidedList } from "../guided/GuidedList";
import { FIX, SHOW, failureCopy } from "../guided/copy";
import { findingFor, guidedFor, paneFor } from "../guided/plan";
import { ChatActivity } from "./ChatActivity";
import { cardContent } from "./cards";
import type { ChatHandlers } from "./handlers";
import type { ChatMessage } from "./state";

type Card = Extract<ChatMessage, { kind: "card" }>;

const PRIMARY_LABELS = { try_again: FIX.tryAgain, show_where: FIX.showWhere, next: FIX.next, check_again: FIX.checkAgain } as const;

export interface ChatCardProps {
  readonly message: Card;
  readonly handlers: ChatHandlers;
  /** The chat's own rows for this card (the watcher, the watch check). */
  readonly extraRows: readonly ActivityEvent[];
  readonly headlineRef?: (el: HTMLHeadingElement | null) => void;
}

/** A paper card from the catalogue: one primary at most, one link at most, the Explain disclosure where the step has one. */
export function ChatCard({ message, handlers, extraRows, headlineRef }: ChatCardProps) {
  const { settings, scan, gate } = useApp();
  const { card, step, state } = message;
  const report = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.report : null;
  const finding = report !== null && card.ruleId !== null ? findingFor(report, card.ruleId) : null;
  const needsPassword = finding?.fix.apply.kind === "in_app" ? finding.fix.apply.needsPassword : true;
  const noticedTime = message.noticedAt === null ? null : formatTime(message.noticedAt);
  const content = cardContent({ card, step, item: message.item, noticedAt: message.noticedAt }, { needsPassword, noticedTime });
  const fixing = scan.scan.kind === "ready" ? scan.scan.fixing : null;
  const runs = card.kind === "fix" || card.kind === "batch";
  const working = state === "working";
  const preparing = working && runs && fixing === null;
  const cue = card.severity === "critical" || card.severity === "high" ? ` chat-card-${card.severity}` : "";
  const wantsExplain = content.explainRuleId !== null && settings.explainer.aiEnabled && (card.kind === "fix" || card.kind === "batch" || card.kind === "show" || card.kind === "explain");
  const failure = state === "failed" && message.failure !== null ? failureCopy(message.failure.error, message.failure.batch, card.ruleId !== null && paneFor(card.ruleId) !== null, watchActive(settings, gate)) : null;
  const doneRows = message.rows.map((r) => ({ key: r.ruleId, text: r.text, icon: r.ok ? ("ok" as const) : ("failed" as const), tag: r.tag }));
  return (
    <div className={`chat-card${cue}`} data-kind={card.kind} data-state={state} data-live={message.live ? "true" : undefined}>
      <h2 ref={headlineRef} className="chat-headline chat-card-headline" tabIndex={-1}>
        {content.urgent && <Icon icon={SEVERITY_ICONS.critical} size={16} className="chat-card-urgent-icon" />}
        {failure !== null ? failure.title : content.headline}
      </h2>
      {state === "idle" || state === "working" ? (
        <>
          {content.body !== null && <p className="chat-card-body">{content.body}</p>}
          {content.meta !== null && <p className="guided-meta-line chat-card-meta">{content.meta}</p>}
          {content.folder !== null && <p className="chat-card-folder">{content.folder}</p>}
          {content.list.length > 0 && <GuidedList rows={content.list.map((text) => ({ key: text, text, icon: "bullet" as const }))} />}
        </>
      ) : null}
      {failure !== null && failure.body !== null && <p className="chat-card-body">{failure.body}</p>}
      {(working || state === "resolved" || state === "failed") && <ChatActivity cardId={message.id} fixing={working || state === "failed" ? fixing : null} preparing={preparing} extra={extraRows} />}
      {working && message.result !== null && (
        <p className="chat-result">
          {message.result} {card.ruleId !== null ? guidedFor(card.ruleId).where : ""} {SHOW.notice}
        </p>
      )}
      {working && card.kind === "show" && message.result !== null && (
        <button type="button" className="guided-link" onClick={() => handlers.checkAgain(message.id)}>
          {FIX.checkAgain}
        </button>
      )}
      {(state === "resolved" || state === "stale") && message.result !== null && (
        <p className="chat-result" data-outcome={state}>
          {state === "resolved" && <Icon icon={message.rows.some((r) => !r.ok) ? ICONS.close : ICONS.check} size={20} className={message.rows.some((r) => !r.ok) ? "chat-result-icon" : "chat-result-icon guided-tick"} />}
          <span>{message.result}</span>
        </p>
      )}
      {state === "resolved" && doneRows.length > 0 && <GuidedList rows={doneRows} />}
      {state === "idle" && content.passphrase && <PassphraseForm keyPath={content.keyPath} submitLabel={FIX.passphrase} onSubmit={(passphrase) => handlers.primary(message.id, passphrase)} />}
      {state === "idle" && content.primary !== null && !content.passphrase && (
        <button type="button" className="button button-primary chat-card-primary" onClick={() => handlers.primary(message.id)}>
          {content.primary}
        </button>
      )}
      {state === "failed" && failure !== null && (
        <button type="button" className="button button-primary chat-card-primary" onClick={() => handlers.primary(message.id)}>
          {PRIMARY_LABELS[failure.primary]}
        </button>
      )}
      {state === "idle" && content.licence && <LicenceFieldSlot cardId={message.id} handlers={handlers} />}
      {state === "idle" && content.link !== null && (
        <button type="button" className="guided-link" onClick={() => handlers.link(message.id)}>
          {content.link}
        </button>
      )}
      {state === "failed" && failure !== null && failure.later && (
        <button type="button" className="guided-link" onClick={() => handlers.link(message.id)}>
          {FIX.later}
        </button>
      )}
      {wantsExplain && (state === "idle" || state === "working") && content.explainRuleId !== null && <ExplainPanel ruleId={content.explainRuleId} />}
    </div>
  );
}

function LicenceFieldSlot({ cardId, handlers }: { cardId: string; handlers: ChatHandlers }) {
  const { adapters } = useApp();
  return (
    <div className="guided-licence">
      <LicenceField onBuy={() => void adapters.fixes.openBuyPage()} onUnlocked={() => handlers.licenceAccepted(cardId)} />
    </div>
  );
}
