"use client";

import { useEffect } from "react";

/**
 * Moves keyboard focus to the element the URL hash names whenever `page` changes. Next scrolls a
 * hash target into view after a navigation but leaves focus on the link that was clicked, so
 * "הצגת עוד חיפושים" on /searches links to the first new card (…?page=2#r24) and this puts
 * keyboard and screen-reader users there. Only ids starting with `prefix` are focused.
 */
export function FocusHashTarget({ page, prefix }: { page: number; prefix: string }) {
  useEffect(() => {
    let id: string;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return; // a malformed hash
    }
    if (!id.startsWith(prefix)) return;
    document.getElementById(id)?.focus({ preventScroll: true });
  }, [page, prefix]);
  return null;
}
