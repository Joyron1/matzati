"use client";

import type { ComponentProps, MouseEvent } from "react";

type InPageLinkProps = Omit<ComponentProps<"a">, "href"> & {
  /** The id of the element on this page to go to. */
  targetId: string;
  /** Record the hash in the URL (deep-linkable sections). The skip link leaves the URL alone. */
  updateUrl?: boolean;
};

/**
 * A link to a place on this page (#id) that keeps Back and Forward working and puts keyboard
 * focus there.
 *
 * A plain <a href="#id"> makes the browser add a history entry that Next's router cannot read (it
 * has no router state): after a later navigation to another page, Back changes the URL but leaves
 * that other page on screen. So with JavaScript this link handles the click itself: it scrolls the
 * target into view, focuses it (with a temporary tabindex="-1" when it is not focusable, so the
 * next Tab continues from there), and puts the hash in the URL with history.replaceState, which
 * Next supports and copies its state into. No history entry is added, so Back leaves the page.
 * Without JavaScript it is a plain anchor.
 */
export function InPageLink({ targetId, updateUrl = true, onClick, ...props }: InPageLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    if (updateUrl) window.history.replaceState(null, "", `#${targetId}`);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    if (!target.hasAttribute("tabindex")) {
      target.setAttribute("tabindex", "-1");
      // Only for this visit: otherwise a later click on its text would focus the whole region.
      target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
    }
    target.focus({ preventScroll: true });
  }

  return <a {...props} href={`#${targetId}`} onClick={handleClick} />;
}
