"use client";

import { useEffect } from "react";

/** How many frames to wait for the router to put a clicked link's hash in the URL. */
const MAX_FRAMES = 30;

/** The element the URL hash names, if it sits inside `scope` and is focusable from script. */
function hashTarget(scope: string): HTMLElement | null {
  let id: string;
  try {
    id = decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return null; // a malformed hash
  }
  if (!id) return null;
  const target = document.getElementById(id);
  return target && target.tabIndex === -1 && target.closest(scope) ? target : null;
}

/**
 * Puts keyboard focus on the section a deep link names (/terms#affiliate), inside the element
 * matching `scope`. Next 16 scrolls a hash target into view after a navigation but leaves focus
 * where it was: on the link, which stays in the footer, or on <body> when the link went away with
 * the page it was on. The next Tab would then start from there instead of from the section.
 *
 * Covers the ways to arrive: a page load or a navigation from another page (on mount), a plain
 * in-page anchor or back and forward (hashchange), and a Next <Link> to a hash on this same page,
 * which changes the URL with pushState and so fires no hashchange (a click on such a link). Only
 * targets with tabIndex -1 are focused, so nothing else takes focus. The scroll is left to Next
 * and the browser, unless the target ended up out of view.
 */
export function HashTargetFocus({ scope }: { scope: string }) {
  useEffect(() => {
    let frame = 0;
    const focusTarget = () => {
      const target = hashTarget(scope);
      if (!target) return;
      target.focus({ preventScroll: true });
      // Back and Forward do not scroll to the hash (Next restores no position there).
      const { top } = target.getBoundingClientRect();
      if (top < 0 || top > window.innerHeight * 0.8) target.scrollIntoView({ block: "start" });
    };

    // After this commit, once Next has scrolled the target into view.
    frame = requestAnimationFrame(focusTarget);

    /** Waits (a few frames at most) for the URL to carry `hash`, then focuses its target. */
    function focusWhenAt(hash: string, framesLeft: number) {
      frame = requestAnimationFrame(() => {
        if (location.hash === hash) focusTarget();
        else if (framesLeft > 0) focusWhenAt(hash, framesLeft - 1);
      });
    }

    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || !link.hash || link.target) return;
      if (link.origin !== location.origin || link.pathname !== location.pathname) return;
      cancelAnimationFrame(frame);
      focusWhenAt(link.hash, MAX_FRAMES);
    }

    window.addEventListener("hashchange", focusTarget);
    document.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", focusTarget);
      document.removeEventListener("click", onClick);
    };
  }, [scope]);
  return null;
}
