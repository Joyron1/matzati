// How the home page strip shows recent searches: by the product we understood (the Hebrew product
// chip, written by the parse), never the visitor's own words. Pure.
import type { RecentSearch } from "./types";

/** The Hebrew product label of a search ("בובת סוניק"), or null when it has none. */
export function productLabelOf(search: RecentSearch): string | null {
  const label = search.chips.find((c) => c.kind === "keywords")?.label_he.trim();
  return label || null;
}

/**
 * The first `limit` searches with a product label, one per label: "בובת סוניק" and "בובת סוניק
 * לילד" are both "בובת סוניק", and the strip shows it once (the newest). Keeps the input order.
 */
export function uniqueByProduct(searches: RecentSearch[], limit: number): RecentSearch[] {
  const seen = new Set<string>();
  const out: RecentSearch[] = [];
  for (const search of searches) {
    const label = productLabelOf(search);
    if (!label) continue;
    const key = label.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(search);
    if (out.length === limit) break;
  }
  return out;
}
