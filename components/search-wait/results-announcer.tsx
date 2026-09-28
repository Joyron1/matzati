"use client";

import { useEffect, useState } from "react";

/** Long enough for screen readers to register the empty region before its text arrives. */
const ANNOUNCE_DELAY_MS = 250;

/**
 * Says once what the search found when the results replace the wait (app/search/page.tsx): the
 * wait's live region leaves with it, and a region added with its text already inside is often not
 * read. So this region is added empty and filled a moment later.
 */
export function ResultsAnnouncer({ text }: { text: string }) {
  const [said, setSaid] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSaid(text), ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <p role="status" className="sr-only">
      {said}
    </p>
  );
}
