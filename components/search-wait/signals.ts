// What app/search/page.tsx tells the waiting screen while a search runs, as promises it passes to
// the client (each resolves once, never rejects): the stages lib/search/pipeline.ts streams, cut
// down to what the wait shows. A plain module, so the server page can import the types.
import type { FilterChip } from "@/lib/types";

/** The query is understood: the chips the results page will show ("הבנתי ככה"). */
export interface UnderstoodSignal {
  chips: FilterChip[];
}

/** The products are ranked, linked and saved; their lines may still be written. */
export interface RankedSignal {
  /** Lines are being written for some of the products shown (the explain call). */
  writing: boolean;
  /** SearchResponse.checked_count and passed_count: the results page says the same. */
  checked: number;
  passed: number;
}

export interface SearchSignals {
  /** null: the search failed before the query was understood. */
  understood: Promise<UnderstoodSignal | null>;
  /** null: the search failed before its products were ranked. */
  ranked: Promise<RankedSignal | null>;
}

/**
 * Calls `then` once `promise` settles (null when it rejects). A promise from the server page is a
 * React Flight thenable whose `then` returns nothing, so this never chains.
 */
export function onSettled<T>(promise: PromiseLike<T>, then: (value: T | null) => void): void {
  promise.then(then, () => then(null));
}
