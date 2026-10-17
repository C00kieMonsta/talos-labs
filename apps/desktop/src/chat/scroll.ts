import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Within this many pixels of the bottom the log follows every new message. */
export const STICK_PX = 48;
/** After this long with no scroll event, a scroll the hook started counts as landed. */
export const SCROLL_SETTLE_MS = 120;

export interface StickToBottom {
  /** "New messages": a message landed while the person was scrolled up. */
  readonly pill: boolean;
  scrollToBottom(): void;
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/** The opening fits from the top: its first primary ends inside the log, so the headline is read before anything scrolls. */
function openingFits(el: HTMLElement): boolean {
  const primary = el.querySelector(".button-primary");
  if (primary === null) return false;
  return primary.getBoundingClientRect().bottom - el.getBoundingClientRect().top <= el.clientHeight;
}

/** "instant" overrides the log's CSS scroll-behavior, which "auto" would follow. */
function jumpToBottom(el: HTMLElement): void {
  if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  else el.scrollTop = el.scrollHeight;
}

/**
 * docs/DESIGN-CHAT-UI.md "Scrolling and the pill": the log scrolls on every appended message (`appended` changes)
 * while the person is near the bottom; `forced` changes always scroll (the watch's act-now). Partials never scroll.
 * A scroll the hook started is not the person's: while it is in flight the position is not read as a scroll-up, and
 * content that grew under it (activity rows landing in a later render) is caught up with once it settles.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, appended: number, forced: number, options: { readonly reducedMotion: boolean; readonly streaming?: boolean }): StickToBottom {
  const [pill, setPill] = useState(false);
  const stuck = useRef(true);
  // The opening is parked at the top while it fits; the next append, a forced scroll or the person's own scroll ends that.
  const parked = useRef(false);
  const pending = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTop = useRef(0);
  const lastClientHeight = useRef(0);
  const { reducedMotion } = options;
  // Partials grow the content but never scroll; growth before the first partial and the stream's end are followed.
  const streaming = useRef(options.streaming === true);
  streaming.current = options.streaming === true;
  // A jump the hook makes is in flight like a smooth scroll: the event it causes must not read as the person's.
  const follow = useCallback((el: HTMLElement) => {
    jumpToBottom(el);
    pending.current = true;
    lastTop.current = el.scrollTop;
  }, []);
  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (el === null) return;
    const top = el.scrollHeight;
    if (typeof el.scrollTo === "function") el.scrollTo({ top, behavior: reducedMotion ? "instant" : "smooth" });
    else el.scrollTop = top;
    pending.current = true;
    lastTop.current = el.scrollTop;
    stuck.current = true;
    setPill(false);
  }, [ref, reducedMotion]);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    lastClientHeight.current = el.clientHeight;
    const landed = () => {
      settle.current = null;
      if (!pending.current) return;
      pending.current = false;
      if (stuck.current && !parked.current && distanceFromBottom(el) > 1) follow(el);
    };
    const onScroll = () => {
      // A scroll the browser made by resizing the log is not the person's; a stuck log stays at the bottom.
      const resized = lastClientHeight.current !== 0 && el.clientHeight !== lastClientHeight.current;
      lastClientHeight.current = el.clientHeight;
      const top = el.scrollTop;
      const movedUp = top < lastTop.current;
      const moved = top !== lastTop.current;
      lastTop.current = top;
      if (resized && stuck.current) {
        if (!parked.current) follow(el);
        return;
      }
      if (pending.current && !movedUp) {
        if (settle.current !== null) clearTimeout(settle.current);
        if (reducedMotion) {
          // An instant scroll lands in one event; a render that follows it is caught two frames later.
          landed();
          pending.current = true;
          requestAnimationFrame(() => requestAnimationFrame(landed));
        } else {
          settle.current = setTimeout(landed, SCROLL_SETTLE_MS);
        }
        return;
      }
      // An event that moved nothing is the browser's bookkeeping after content grew or shrank, never the person's.
      if (!moved) return;
      pending.current = false;
      parked.current = false;
      stuck.current = distanceFromBottom(el) <= STICK_PX;
      if (stuck.current) setPill(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (settle.current !== null) clearTimeout(settle.current);
    };
  }, [ref, reducedMotion, follow]);
  // Content growing with no new message (a card resolving, rows landing) keeps a stuck log at the bottom.
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      // A resize of the log itself is never a partial.
      const resized = el.clientHeight !== lastClientHeight.current;
      lastClientHeight.current = el.clientHeight;
      if (stuck.current && !parked.current && (resized || !streaming.current)) follow(el);
    });
    observer.observe(el);
    if (el.firstElementChild !== null) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [ref, follow]);
  const lastAppended = useRef(appended);
  const lastForced = useRef(forced);
  useLayoutEffect(() => {
    const grew = appended !== lastAppended.current;
    const force = forced !== lastForced.current;
    const opening = grew && lastAppended.current === 0;
    lastAppended.current = appended;
    lastForced.current = forced;
    if (!grew && !force) return;
    const el = ref.current;
    if (!force && opening && el !== null && openingFits(el)) {
      parked.current = true;
      return;
    }
    parked.current = false;
    if (force || stuck.current) scrollToBottom();
    else setPill(true);
  }, [appended, forced, scrollToBottom, ref]);
  return { pill, scrollToBottom };
}
