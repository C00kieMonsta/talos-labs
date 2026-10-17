import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { CHAT_LIMITS } from "@talos/core";
import { ICONS } from "../app/icons";
import { formatTime } from "../app/labels";
import type { Route } from "../app/router";
import { Icon } from "../components/Icon";
import { CHAT, EXPLAIN } from "../guided/copy";
import { hasWords } from "./guard";
import { CHAT_ROUTE } from "./routes";
import type { ChatComposer as ComposerState } from "./state";

/** The counter appears at this many characters left. */
export const CHAT_NEAR_LIMIT = 60;
export const COMPOSER_MAX_ROWS = 4;

export interface ChatComposerProps {
  readonly state: ComposerState;
  readonly streaming: boolean;
  /** A draft handed in by draft_received; consumed once. */
  readonly draft: string | null;
  onDraftConsumed(): void;
  /** False keeps the draft in the field (the guard line answered). */
  onSend(text: string): boolean | void;
  onStop(): void;
  onNavigate(route: Route): void;
  /** Called once each time the counter crosses CHAT_NEAR_LIMIT, so the status element can say it. */
  onNearLimit(left: number): void;
  /** Escape with nothing running: focus moves to the newest headline. */
  onEscape(): void;
  readonly fieldRef?: (el: HTMLTextAreaElement | null) => void;
}

/** The disabled state's one sentence and its one link; null when the field is usable. */
export function composerStateLine(state: ComposerState): { text: string; link: { label: string; route: Route } | null } | null {
  switch (state.kind) {
    case "ready":
    case "busy":
    case "did_not_answer":
      return null;
    case "limit":
      return { text: `${EXPLAIN.limit[state.provider]} ${state.until === null ? EXPLAIN.limitBack : `${EXPLAIN.limitBackAtPrefix}${formatTime(state.until)}.`}`, link: null };
    case "signed_out":
      return { text: EXPLAIN.signedOut[state.provider], link: { label: EXPLAIN.signInAgain, route: { name: "connect", returnTo: CHAT_ROUTE } } };
  }
}

/** One field that grows to four lines, Send as an icon button that becomes Stop while a turn streams, the counter at 60 left. */
export function ChatComposer(props: ChatComposerProps) {
  const { state, streaming, draft, onDraftConsumed, onSend, onStop, onNavigate, onNearLimit, onEscape, fieldRef } = props;
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);
  const stateLine = useRef<HTMLParagraphElement | null>(null);
  // Whether the field held focus when the limit or sign-out line replaced it, so focus is handed on and back.
  const heldFocus = useRef(false);
  const countId = useId();
  const nearRef = useRef(false);
  useEffect(() => {
    if (draft === null) return;
    setText(draft);
    onDraftConsumed();
    field.current?.focus();
  }, [draft, onDraftConsumed]);
  const left = CHAT_LIMITS.maxQuestionChars - text.length;
  const near = left < CHAT_NEAR_LIMIT;
  useEffect(() => {
    if (near && !nearRef.current) onNearLimit(left);
    nearRef.current = near;
  }, [near, left, onNearLimit]);
  const line = composerStateLine(state);
  const disabled = line !== null;
  useEffect(() => {
    if (disabled) {
      if (heldFocus.current) stateLine.current?.focus({ preventScroll: true });
      return;
    }
    if (heldFocus.current && (document.activeElement === document.body || document.activeElement === null)) field.current?.focus({ preventScroll: true });
    heldFocus.current = false;
  }, [disabled]);
  const canSend = hasWords(text) && !streaming;
  const submit = () => {
    if (!canSend) return;
    if (onSend(text) !== false) setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME's commit Enter must not send.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (streaming) onStop();
      else onEscape();
    }
  };
  const rows = Math.min(COMPOSER_MAX_ROWS, Math.max(1, text.split("\n").length));
  return (
    <form
      className="chat-composer"
      data-state={state.kind}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {line !== null ? (
        <p className="chat-composer-state" tabIndex={-1} ref={stateLine}>
          {line.text}
          {line.link !== null && (
            <>
              {" "}
              <button type="button" className="guided-text-button" onClick={() => onNavigate(line.link!.route)}>
                {line.link.label}
              </button>
            </>
          )}
        </p>
      ) : (
        <>
          <textarea
            ref={(el) => {
              if (el === null && field.current !== null && document.activeElement === field.current) heldFocus.current = true;
              field.current = el;
              fieldRef?.(el);
            }}
            className="chat-field"
            rows={rows}
            maxLength={CHAT_LIMITS.maxQuestionChars}
            aria-label={CHAT.message}
            aria-describedby={near ? countId : undefined}
            placeholder={CHAT.placeholder}
            value={text}
            readOnly={streaming}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {streaming ? (
            <button type="button" className="button icon-button chat-send" aria-label={CHAT.stop} onClick={onStop}>
              <Icon icon={ICONS.stop} size={20} />
            </button>
          ) : (
            <button type="submit" className="button icon-button chat-send" aria-label={CHAT.send} disabled={!canSend}>
              <Icon icon={ICONS.send} size={20} />
            </button>
          )}
          {near && (
            <span id={countId} className="chat-count">
              {CHAT.left.replace("{n}", String(left))}
            </span>
          )}
        </>
      )}
    </form>
  );
}
