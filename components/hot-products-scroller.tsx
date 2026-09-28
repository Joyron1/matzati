"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { HOT_HEADER_ROW, HOT_NAV_BUTTONS, HOT_ROW } from "./hot-carousel-layout";

// aria-disabled rather than disabled at the edges: a disabled button loses keyboard focus, which
// then falls back to the page.
const NAV_BUTTON =
  "grid size-11 place-items-center rounded-full border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-line aria-disabled:hover:text-ink";

/**
 * The carousel's row: native horizontal scrolling with snap points (a swipe on touch screens) and,
 * from sm up, previous/next buttons beside the heading that scroll by one visible width. No
 * autoplay. The cards are ordinary links in a labelled list, so Tab reaches each one and the
 * browser scrolls it into view. `children` are the <li> items.
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
  const listRef = useRef<HTMLUListElement>(null);
  // Until the list is measured (and without JavaScript) the start is showing.
  const [edges, setEdges] = useState({ atStart: true, atEnd: false });

  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // In RTL, scrollLeft runs from 0 (start) to negative values, so compare magnitudes.
    const offset = Math.abs(el.scrollLeft);
    const atStart = offset < 2;
    const atEnd = offset + el.clientWidth >= el.scrollWidth - 2;
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

  /** One visible width towards the end (1) or the start (-1), in the page's direction. */
  function scrollByPage(step: 1 | -1) {
    const el = listRef.current;
    if (!el || (step === 1 ? edges.atEnd : edges.atStart)) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      left: step * (rtl ? -1 : 1) * el.clientWidth,
      behavior: reduce ? "auto" : "smooth",
    });
  }

  return (
    <div className="space-y-3">
      <div className={HOT_HEADER_ROW}>
        <div className="min-w-0">{heading}</div>
        {/* Only from sm: phones swipe. In RTL the start is on the right. */}
        <div className={HOT_NAV_BUTTONS}>
          <button
            type="button"
            aria-controls={listId}
            aria-label="המוצרים הקודמים"
            aria-disabled={edges.atStart}
            onClick={() => scrollByPage(-1)}
            className={NAV_BUTTON}
          >
            <ChevronRight aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            aria-controls={listId}
            aria-label="המוצרים הבאים"
            aria-disabled={edges.atEnd}
            onClick={() => scrollByPage(1)}
            className={NAV_BUTTON}
          >
            <ChevronLeft aria-hidden className="size-5" />
          </button>
        </div>
      </div>
      <ul ref={listRef} id={listId} aria-label={label} className={HOT_ROW}>
        {children}
      </ul>
    </div>
  );
}
