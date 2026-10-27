"use client";

// The site header stays at the top of the screen (owner request 2026-10-27): it slides away while
// the visitor scrolls down and comes back the moment they scroll up, so nobody has to scroll back
// to the top for the menu. It never hides near the top of the page, while focus is inside it (a
// keyboard user's focused link must stay visible, WCAG 2.4.11) or while one of its panels is open.
// `--header-offset` on <html> is the height it covers now (0 while hidden): sticky columns sit
// under it and in-page jumps stop clear of it (globals.css).
import { useEffect, useRef, useState } from "react";

/** Scrolling less than this in one direction changes nothing (a trackpad's jitter). */
const MIN_DELTA_PX = 8;

export function StickyHeader({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const root = document.documentElement;
    let lastY = Math.max(0, window.scrollY);
    let frame = 0;
    let isHidden = false;

    const apply = (next: boolean) => {
      if (next !== isHidden) {
        isHidden = next;
        setHidden(next);
      }
      root.style.setProperty("--header-offset", next ? "0px" : `${header.offsetHeight}px`);
    };

    const mustShow = () =>
      header.contains(document.activeElement) ||
      header.querySelector('[aria-expanded="true"]') !== null;

    const update = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const delta = y - lastY;
      // Near the top, the header is in its own place in the page.
      if (y <= header.offsetHeight || mustShow()) {
        apply(false);
        lastY = y;
        return;
      }
      if (Math.abs(delta) < MIN_DELTA_PX) return;
      apply(delta > 0);
      lastY = y;
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onFocus = () => {
      if (isHidden) apply(false);
    };

    apply(false);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    header.addEventListener("focusin", onFocus);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      header.removeEventListener("focusin", onFocus);
      root.style.removeProperty("--header-offset");
    };
  }, []);

  return (
    <header
      ref={ref}
      data-site-chrome
      data-hidden={hidden || undefined}
      className="sticky top-0 z-40 border-b border-line bg-bg transition-transform duration-200 ease-out data-hidden:-translate-y-full motion-reduce:transition-none print:static"
    >
      {children}
    </header>
  );
}
