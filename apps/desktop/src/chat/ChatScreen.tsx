import { useCallback, useEffect, useMemo, useRef } from "react";
import { useApp } from "../app/context";
import { useGuidedHero, useGuidedStrip } from "../guided/GuidedShell";
import { CHAT } from "../guided/copy";
import type { ChatBridge } from "../guided/state";
import { ChatFoot } from "./ChatFoot";
import { ChatStatus } from "./ChatStatus";
import { ChatStreamContext } from "./ChatStreamContext";
import { ChatTranscript } from "./ChatTranscript";
import type { ChatHandlers } from "./handlers";
import { useStickToBottom } from "./scroll";
import type { ChatMessage, ChipId } from "./state";
import { useChat } from "./useChat";

/** The newest headline the person can be sent to: the live card first, else the newest card or app headline. */
export function newestHeadlineId(messages: readonly ChatMessage[], live: string | null): string | null {
  if (live !== null) return live;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.kind === "card" || (m?.kind === "app" && m.headline !== null)) return m.id;
  }
  return null;
}

/** The chat route in the guided shell: the strip's "Step by step", the breathing spiral while a turn runs, the transcript, the foot, the one status element. */
export function ChatScreen({ bridge }: { bridge: ChatBridge }) {
  const { settings } = useApp();
  const chat = useChat(bridge);
  const { state, controller } = chat;
  const { stepByStep } = bridge;
  const strip = useMemo(() => ({ links: [{ label: CHAT.stepByStep, onClick: stepByStep }] }), [stepByStep]);
  useGuidedStrip(strip);
  useGuidedHero(true, false, chat.busy);
  const logRef = useRef<HTMLDivElement | null>(null);
  const { pill, scrollToBottom } = useStickToBottom(logRef, state.messages.length, chat.forced, { reducedMotion: chat.reducedMotion });
  const headlines = useRef(new Map<string, HTMLHeadingElement>());
  const field = useRef<HTMLTextAreaElement | null>(null);
  const focusWanted = useRef<"field" | "headline" | null>(null);
  const headlineRef = useCallback((id: string, el: HTMLHeadingElement | null) => {
    if (el === null) headlines.current.delete(id);
    else headlines.current.set(id, el);
  }, []);
  const focusNewest = useCallback(() => {
    const id = newestHeadlineId(state.messages, state.live);
    if (id !== null) headlines.current.get(id)?.focus();
  }, [state.messages, state.live]);
  // After a chip or a settled card the newest headline takes focus; after the person's own send or Stop, the field.
  useEffect(() => {
    const wanted = focusWanted.current;
    focusWanted.current = null;
    if (wanted === "headline") focusNewest();
    else if (wanted === "field") field.current?.focus();
  }, [state.announce.seq, focusNewest]);
  // The watch's act-now always moves focus to its headline.
  useEffect(() => {
    if (chat.forced > 0) focusNewest();
    // The forced counter is the trigger; the messages are read when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.forced]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey && event.key.toLowerCase() === "l")) return;
      const target = event.target;
      if (target instanceof HTMLElement && target !== field.current && target.closest("input, textarea, [contenteditable]") !== null) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const handlers = useMemo<ChatHandlers>(
    () => ({
      ...controller,
      send: (text) => {
        focusWanted.current = "field";
        controller.send(text);
      },
      chip: (id: ChipId) => {
        focusWanted.current = id === "why" ? "field" : "headline";
        controller.chip(id);
      },
      primary: (cardId, passphrase) => {
        focusWanted.current = "headline";
        controller.primary(cardId, passphrase);
      },
      link: (cardId) => {
        focusWanted.current = "headline";
        controller.link(cardId);
      },
      promote: (rowId) => {
        focusWanted.current = "headline";
        controller.promote(rowId);
      },
      stop: () => {
        focusWanted.current = "field";
        controller.stop();
      },
    }),
    [controller],
  );
  return (
    <ChatStreamContext.Provider value={chat.busy}>
      <div className="guided-chat">
        <ChatTranscript messages={state.messages} handlers={handlers} extras={chat.extras} logRef={logRef} headlineRef={headlineRef} />
        <ChatFoot
          chips={chat.chips}
          onChip={handlers.chip}
          pill={pill}
          onPill={scrollToBottom}
          calls={settings.developer.enabled ? state.calls : null}
          state={state.composer}
          streaming={state.stream.kind !== "idle"}
          draft={state.draft}
          onDraftConsumed={handlers.draftConsumed}
          onSend={handlers.send}
          onStop={handlers.stop}
          onNavigate={handlers.navigate}
          onNearLimit={chat.nearLimit}
          onEscape={focusNewest}
          fieldRef={(el) => {
            field.current = el;
          }}
        />
      </div>
      <ChatStatus text={state.announce.text} seq={state.announce.seq} />
    </ChatStreamContext.Provider>
  );
}
