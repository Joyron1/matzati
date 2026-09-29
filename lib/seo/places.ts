// The places a group of an SEO landing page holds ("מקומות 6–10"), for its divider and for the
// announcement when it appears (components/seo-group-reveal.tsx). Pure.

/** The last place of a group of `count` starting at `first`. */
export function lastPlace(first: number, count: number): number {
  return first + Math.max(1, count) - 1;
}

/** "מקומות 6–10" as read out; a group of one says its one place. */
export function placesLabel(first: number, count: number): string {
  const last = lastPlace(first, count);
  return last === first ? `מקום ${first}` : `מקומות ${first}–${last}`;
}
