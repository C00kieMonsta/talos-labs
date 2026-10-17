import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Within this many pixels of the bottom the log follows every new message. */
export const STICK_PX = 48;

export interface StickToBottom {
  /** "New messages": a message landed while the person was scrolled up. */
  readonly pill: boolean;
  scrollToBottom(): void;
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/**
 * docs/DESIGN-CHAT-UI.md "Scrolling and the pill": the log scrolls on every appended message (`appended` changes)
 * while the person is near the bottom; `forced` changes always scroll (the watch's act-now). Partials never scroll.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, appended: number, forced: number, options: { readonly reducedMotion: boolean }): StickToBottom {
  const [pill, setPill] = useState(false);
  const stuck = useRef(true);
  const { reducedMotion } = options;
  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (el === null) return;
    const top = el.scrollHeight;
    if (typeof el.scrollTo === "function") el.scrollTo({ top, behavior: reducedMotion ? "auto" : "smooth" });
    else el.scrollTop = top;
    stuck.current = true;
    setPill(false);
  }, [ref, reducedMotion]);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onScroll = () => {
      stuck.current = distanceFromBottom(el) <= STICK_PX;
      if (stuck.current) setPill(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref]);
  const lastAppended = useRef(appended);
  const lastForced = useRef(forced);
  useLayoutEffect(() => {
    const grew = appended !== lastAppended.current;
    const force = forced !== lastForced.current;
    lastAppended.current = appended;
    lastForced.current = forced;
    if (!grew && !force) return;
    if (force || stuck.current) scrollToBottom();
    else setPill(true);
  }, [appended, forced, scrollToBottom]);
  return { pill, scrollToBottom };
}
