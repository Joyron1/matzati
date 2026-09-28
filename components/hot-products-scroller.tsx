"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { scrollFocusedItemIntoView } from "./focus-scroll-list";
import { HOT_HEADER_ROW, HOT_NAV_BUTTONS, HOT_ROW } from "./hot-carousel-layout";

// aria-disabled rather than disabled when the row does not scroll: a disabled button loses
// keyboard focus, which then falls back to the page.
const NAV_BUTTON =
  "grid size-11 place-items-center rounded-full border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-line aria-disabled:hover:text-ink";

/** While nobody uses it, the row moves on by one visible page this often. */
export const AUTO_ADVANCE_MS = 5_000;

/** How long a smooth scroll may take before the row counts as settled (no scrollend event). */
const SETTLE_MS = 1_200;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** False on the server and under reduced motion: the row never moves on its own then. */
function useMotionAllowed(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => !window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** How far the row is scrolled from its start, whatever the direction. */
const offsetOf = (list: HTMLElement) => Math.abs(list.scrollLeft);

/** The furthest the row scrolls. */
const maxOffsetOf = (list: HTMLElement) => Math.max(0, list.scrollWidth - list.clientWidth);

/** scrollLeft grows toward the end in LTR and shrinks (negative) in RTL. */
const directionOf = (list: HTMLElement) => (getComputedStyle(list).direction === "rtl" ? -1 : 1);

/**
 * One visible page towards the end (1) or the start (-1), in the page's direction, the step of the
 * previous and next buttons: the row snaps to the first card that was not fully in view. Past the
 * last page it goes back to the first, and before the first to the last.
 */
function scrollOnePage(list: HTMLElement, step: 1 | -1): void {
  const behavior = window.matchMedia(REDUCED_MOTION).matches ? "auto" : "smooth";
  const sign = directionOf(list);
  const offset = offsetOf(list);
  const max = maxOffsetOf(list);
  if (step === 1 && offset >= max - 2) list.scrollTo({ left: 0, behavior });
  else if (step === -1 && offset <= 2) list.scrollTo({ left: sign * max, behavior });
  else list.scrollBy({ left: step * sign * list.clientWidth, behavior });
}

/** The first item (in page order) that is fully inside the row's visible part, if any. */
function firstVisibleItem(list: HTMLElement): HTMLElement | null {
  const box = list.getBoundingClientRect();
  for (const item of list.children) {
    const r = item.getBoundingClientRect();
    if (r.left >= box.left - 1 && r.right <= box.right + 1) return item as HTMLElement;
  }
  return null;
}

/**
 * The carousel's row: native horizontal scrolling with snap points (a swipe on touch screens) and,
 * from sm up, previous/next buttons beside the heading that scroll by one visible page, from the
 * last page back to the first (and from the first to the last). The cards are ordinary links in a
 * labelled list, so Tab reaches each one, and a card that gets focus is scrolled fully into view
 * (scrollFocusedItemIntoView). Tab from the buttons continues at the first card in view, not at the
 * first card of the row (which would scroll the row back to its start). `children` are the <li>
 * items.
 *
 * Auto-advance (owner request 2026-09-28): while nobody uses it, the row does what the next button
 * does every AUTO_ADVANCE_MS: one visible page on, and after the last page back to the first. It
 * stops while the pointer is over it, a finger is on it, a keyboard focus is inside it, and when it
 * is scrolled, swiped or its buttons are used, and goes on AUTO_ADVANCE_MS after the last of these
 * ends. The pause button stops it until it is pressed again (WCAG 2.2.2). It never moves under
 * reduced motion (no pause button then), while off screen or in a hidden tab; it never moves focus,
 * never scrolls the page and announces nothing.
 */
export function HotProductsScroller({
  heading,
  label,
  children,
}: {
  heading: ReactNode;
  /** The list's accessible name. */
  label: string;
  children: ReactNode;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Until the list is measured (and without JavaScript) the start is showing.
  const [edges, setEdges] = useState({ atStart: true, atEnd: false });
  const [paused, setPaused] = useState(false);
  const motion = useMotionAllowed();
  // The row scrolls at all (more cards than fit).
  const scrolls = !(edges.atStart && edges.atEnd);
  // What holds the row still, and the smooth scroll the row itself started (not an interaction).
  const holds = useRef({ hover: false, focus: false, finger: false });
  const selfScroll = useRef(false);
  const restartRef = useRef<() => void>(() => {});

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const offset = offsetOf(el);
    const atStart = offset < 2;
    const atEnd = offset >= maxOffsetOf(el) - 2;
    setEdges((prev) =>
      prev.atStart === atStart && prev.atEnd === atEnd ? prev : { atStart, atEnd },
    );
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure]);

  // Auto-advance: one timer, started again after every interaction and cleared while held.
  useEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list || !motion || !scrolls) return;
    const row: HTMLElement = list;
    let timer: number | undefined;
    let settle: number | undefined;
    let visible = false;
    const h = holds.current;
    // State that outlived an earlier run of this effect (the pause button toggled under a pointer).
    h.hover = root.matches(":hover");
    const active = document.activeElement;
    h.focus = !!active && root.contains(active) && active.matches(":focus-visible");

    const canRun = () =>
      !paused && visible && !document.hidden && !h.hover && !h.focus && !h.finger;

    function restart() {
      window.clearTimeout(timer);
      if (canRun()) timer = window.setTimeout(advance, AUTO_ADVANCE_MS);
    }
    restartRef.current = restart;

    function settled() {
      window.clearTimeout(settle);
      selfScroll.current = false;
    }

    /** What the next button does: one page on, or back to the first after the last. */
    function advance() {
      selfScroll.current = true;
      scrollOnePage(row, 1);
      window.clearTimeout(settle);
      settle = window.setTimeout(settled, SETTLE_MS);
      restart();
    }

    const hold = (key: keyof typeof h, on: boolean) => {
      h[key] = on;
      if (on) window.clearTimeout(timer);
      else restart();
    };
    const onEnter = () => hold("hover", true);
    const onLeave = () => hold("hover", false);
    const onFocusIn = (e: FocusEvent) => {
      if ((e.target as Element).matches(":focus-visible")) hold("focus", true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!root.contains(e.relatedTarget as Node | null)) hold("focus", false);
    };
    const onFingerDown = () => hold("finger", true);
    const onFingerUp = () => {
      if (h.finger) hold("finger", false);
    };
    // A wheel, a scroll bar or keys scrolling it: an interaction; its own smooth scroll is not.
    const onScroll = () => {
      if (!selfScroll.current) restart();
    };
    const onVisibility = () => restart();

    root.addEventListener("pointerenter", onEnter);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    root.addEventListener("touchstart", onFingerDown, { passive: true });
    root.addEventListener("touchend", onFingerUp);
    root.addEventListener("touchcancel", onFingerUp);
    row.addEventListener("pointerdown", onFingerDown);
    window.addEventListener("pointerup", onFingerUp);
    row.addEventListener("wheel", onScroll, { passive: true });
    row.addEventListener("scroll", onScroll, { passive: true });
    row.addEventListener("scrollend", settled);
    document.addEventListener("visibilitychange", onVisibility);
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        restart();
      },
      { threshold: 0.5 },
    );
    observer.observe(row);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(settle);
      restartRef.current = () => {};
      observer.disconnect();
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      root.removeEventListener("touchstart", onFingerDown);
      root.removeEventListener("touchend", onFingerUp);
      root.removeEventListener("touchcancel", onFingerUp);
      row.removeEventListener("pointerdown", onFingerDown);
      window.removeEventListener("pointerup", onFingerUp);
      row.removeEventListener("wheel", onScroll);
      row.removeEventListener("scroll", onScroll);
      row.removeEventListener("scrollend", settled);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [motion, scrolls, paused]);

  /** The previous and next buttons: a page, as the auto-advance moves; its timer starts again. */
  function scrollByPage(step: 1 | -1) {
    const el = listRef.current;
    if (!el || !scrolls) return;
    scrollOnePage(el, step);
    restartRef.current();
  }

  /** Tab from the last button: into the row at the first card the buttons scrolled into view. */
  function tabIntoView(event: KeyboardEvent<HTMLButtonElement>) {
    const el = listRef.current;
    if (event.key !== "Tab" || event.shiftKey || !el || edges.atStart) return;
    const card = firstVisibleItem(el)?.querySelector<HTMLElement>("a[href], button");
    if (!card) return;
    event.preventDefault();
    card.focus({ preventScroll: true });
  }

  return (
    <div ref={rootRef} className="space-y-3">
      <div className={HOT_HEADER_ROW}>
        <div className="min-w-0">{heading}</div>
        {/* The pause button on every screen, never under reduced motion (nothing moves then);
            previous and next only from sm (phones swipe). In RTL the start is on the right. */}
        <div className={HOT_NAV_BUTTONS}>
          <button
            type="button"
            aria-pressed={paused}
            aria-label="השהיית המעבר האוטומטי בין המוצרים"
            onClick={() => setPaused((p) => !p)}
            className={`${NAV_BUTTON} motion-reduce:hidden`}
          >
            {paused ? (
              <Play aria-hidden className="size-[18px]" />
            ) : (
              <Pause aria-hidden className="size-[18px]" />
            )}
          </button>
          <button
            type="button"
            aria-controls={listId}
            aria-label="המוצרים הקודמים"
            aria-disabled={!scrolls}
            onClick={() => scrollByPage(-1)}
            className={`${NAV_BUTTON} max-sm:hidden`}
          >
            <ChevronRight aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            aria-controls={listId}
            aria-label="המוצרים הבאים"
            aria-disabled={!scrolls}
            onClick={() => scrollByPage(1)}
            onKeyDown={tabIntoView}
            className={`${NAV_BUTTON} max-sm:hidden`}
          >
            <ChevronLeft aria-hidden className="size-5" />
          </button>
        </div>
      </div>
      <ul
        ref={listRef}
        id={listId}
        aria-label={label}
        onFocus={scrollFocusedItemIntoView}
        className={HOT_ROW}
      >
        {children}
      </ul>
    </div>
  );
}
