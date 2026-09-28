"use client";

import type { ComponentProps, FocusEvent } from "react";

/**
 * In a row with mandatory scroll snapping, the item to align at the row's start so that `item`
 * shows whole with the least scrolling, or null when it already shows whole. A plain
 * scrollIntoView({ inline: "nearest" }) stops between snap points, and the row then snaps back
 * to where it was when less than half of the missing part was scrolled. Exported for tests.
 */
export function snapItemFor(list: HTMLElement, item: HTMLElement): HTMLElement | null {
  const style = getComputedStyle(list);
  const rtl = style.direction === "rtl";
  const box = list.getBoundingClientRect();
  // Logical offsets from the row's visible start edge (the right one in RTL).
  const start = (r: DOMRect) => (rtl ? box.right - r.right : r.left - box.left);
  const end = (r: DOMRect) => (rtl ? box.right - r.left : r.right - box.left);
  const from = Number.parseFloat(style.scrollPaddingInlineStart) || 0;
  const to = list.clientWidth - (Number.parseFloat(style.scrollPaddingInlineEnd) || 0);
  const rect = item.getBoundingClientRect();
  if (start(rect) >= from - 1 && end(rect) <= to + 1) return null;
  // Cut at the start: align the item itself there.
  if (start(rect) < from) return item;
  // Cut at the end: the first item that, aligned at the start, leaves this one whole.
  for (const candidate of list.children) {
    if (end(rect) - start(candidate.getBoundingClientRect()) <= to - from) {
      return candidate as HTMLElement;
    }
  }
  return item;
}

/**
 * onFocus for a list that scrolls sideways: brings the whole item (<li>) that just got keyboard
 * focus into view. The browser scrolls a focused element only when it is fully out of view, so a
 * focused card or pill could stay mostly off-screen with its focus ring cut. It moves as little as
 * possible and keeps both the list's scroll-padding (room for the ring at its edges) and the
 * page's scroll-padding-bottom (the cookie banner). Mouse focus is left alone.
 */
export function scrollFocusedItemIntoView(event: FocusEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(":focus-visible")) return;
  const list = event.currentTarget;
  const item = target.closest("li");
  if (!item || item.parentElement !== list) return;
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  if (getComputedStyle(list).scrollSnapType.startsWith("none")) {
    item.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
    return;
  }
  const align = snapItemFor(list, item);
  if (align) align.scrollIntoView({ block: "nearest", inline: "start", behavior });
  else item.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
}

/** A <ul> that scrolls sideways, for server components: see scrollFocusedItemIntoView. */
export function FocusScrollList(props: Omit<ComponentProps<"ul">, "onFocus">) {
  return <ul {...props} onFocus={scrollFocusedItemIntoView} />;
}
