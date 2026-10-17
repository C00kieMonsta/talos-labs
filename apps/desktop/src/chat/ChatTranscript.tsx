import type { RefObject } from "react";
import { dividerBefore } from "@talos/core";
import { CHAT } from "../guided/copy";
import { cardHeadline } from "./cards";
import { ChatApp } from "./ChatApp";
import { ChatCard } from "./ChatCard";
import { ChatDivider } from "./ChatDivider";
import { ChatExchange } from "./ChatExchange";
import { ChatModel } from "./ChatModel";
import { ChatNotice } from "./ChatNotice";
import { ChatPerson } from "./ChatPerson";
import { ChatRow } from "./ChatRow";
import type { ActivityExtras, ChatHandlers } from "./handlers";
import type { ChatMessage } from "./state";

interface Exchange {
  readonly person: string | null;
  readonly messages: ChatMessage[];
}

/** A new exchange starts at a person turn, at the opening and end messages, and at the watch's act-now card. */
function startsExchange(m: ChatMessage): boolean {
  if (m.kind === "person") return true;
  if (m.kind === "app") return m.label === "opening" || m.label === "end";
  return m.kind === "card" && m.card.kind === "watch";
}

/** The headline an app-started exchange is named after: the app message's own, or the watch card's. */
function exchangeHeadline(exchange: Exchange): string | null {
  const first = exchange.messages[0];
  if (first === undefined) return null;
  if (first.kind === "app") return first.headline;
  if (first.kind === "card") return cardHeadline({ card: first.card, step: first.step, item: first.item });
  return null;
}

export function exchangesOf(messages: readonly ChatMessage[]): readonly Exchange[] {
  const out: Exchange[] = [];
  for (const m of messages) {
    const current = out[out.length - 1];
    if (current === undefined || startsExchange(m)) {
      out.push({ person: m.kind === "person" ? m.text : null, messages: [m] });
    } else {
      current.messages.push(m);
    }
  }
  return out;
}

export interface ChatTranscriptProps {
  readonly messages: readonly ChatMessage[];
  readonly handlers: ChatHandlers;
  readonly extras: ActivityExtras;
  readonly logRef: RefObject<HTMLDivElement | null>;
  /** Registers each headline so the screen can move focus to the newest one. */
  readonly headlineRef: (id: string, el: HTMLHeadingElement | null) => void;
}

/** div.chat: a region, not a log; nothing inside it is live. Exchanges in order with a time divider after a ten-minute gap. */
export function ChatTranscript({ messages, handlers, extras, logRef, headlineRef }: ChatTranscriptProps) {
  const exchanges = exchangesOf(messages);
  let lastAt: number | null = null;
  return (
    <div ref={logRef} className="chat" role="region" aria-label={CHAT.conversation}>
      <div className="chat-inner">
      {exchanges.map((exchange) => {
        const first = exchange.messages[0]!;
        const divider = lastAt !== null && dividerBefore(lastAt, first.at);
        lastAt = exchange.messages[exchange.messages.length - 1]!.at;
        return (
          <div key={first.id} className="chat-exchange-slot">
            {divider && <ChatDivider at={first.at} />}
            <ChatExchange person={exchange.person} headline={exchangeHeadline(exchange)}>
              {exchange.messages.map((m) => {
                switch (m.kind) {
                  case "app":
                    return <ChatApp key={m.id} message={m} headlineRef={(el) => headlineRef(m.id, el)} onPromoteStep={handlers.promoteStep} />;
                  case "person":
                    return <ChatPerson key={m.id} message={m} onResend={handlers.send} />;
                  case "model":
                    return <ChatModel key={m.id} message={m} />;
                  case "card":
                    return <ChatCard key={m.id} message={m} handlers={handlers} extraRows={extras[m.id] ?? []} headlineRef={(el) => headlineRef(m.id, el)} />;
                  case "row":
                    return <ChatRow key={m.id} message={m} onPromote={handlers.promote} />;
                  case "notice":
                    return <ChatNotice key={m.id} message={m} onChip={handlers.chip} onNavigate={handlers.navigate} />;
                }
              })}
            </ChatExchange>
          </div>
        );
      })}
      </div>
    </div>
  );
}
