// Used by client components too (ShowMore renders result cards): no zod here. The /go parameters
// are validated on the server (clickRefFrom in lib/search/server.ts).
import type { ResultProduct, SortPreference } from "./types";

type Param = string | string[] | undefined;

const SORTS: readonly SortPreference[] = ["best_value", "cheapest", "most_popular"];
const MAX_REMOVED = 10;

/**
 * Where a /search link came from when the visitor did not type the query: a recent-search card
 * (everyone's on /searches and the home strip, or the visitor's own "החיפושים שלי" chips) or one
 * of our example queries. Logged as search_log.origin; listed on /searches like any search with
 * results (owner decision 2026-10-03).
 */
export type SearchFrom = "recent" | "example";
const FROMS: readonly SearchFrom[] = ["recent", "example"];

export function firstParam(value: Param): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** A sort the user chose with the refine buttons, or undefined to keep the parsed preference. */
export function parseSort(value: Param): SortPreference | undefined {
  const v = firstParam(value);
  return (SORTS as readonly string[]).includes(v) ? (v as SortPreference) : undefined;
}

export function parseWithout(value: Param): string[] {
  const ids = firstParam(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(ids)].slice(0, MAX_REMOVED);
}

/** The `from` of one of our own links, or undefined for a query the visitor typed. */
export function parseFrom(value: Param): SearchFrom | undefined {
  const v = firstParam(value);
  return (FROMS as readonly string[]).includes(v) ? (v as SearchFrom) : undefined;
}

/**
 * How a visitor reached a /search URL whose query they did not type: one of our links (SearchFrom)
 * or an ad or campaign link. Logged as search_log.origin (a crawler's "bot" origin is set by the
 * server from the user agent, never from the URL).
 */
export type SearchArrival = SearchFrom | "ad";

/** Parameters an ad or campaign link adds (Google Ads auto-tagging, or UTM tags). */
const AD_PARAMS = ["gclid", "gbraid", "wbraid", "utm_source"] as const;

/**
 * The arrival of a /search request from its search params: "ad" when an ad or campaign parameter
 * is present (a landing never counts as typed, even when it also says `from`), else `from`.
 */
export function parseArrival(params: Record<string, Param>): SearchArrival | undefined {
  if (AD_PARAMS.some((key) => firstParam(params[key]).trim() !== "")) return "ad";
  return parseFrom(params.from);
}

export interface SearchHrefInput {
  q: string;
  /** Explicit sort override; omitted, the search uses the sort parsed from the query. */
  sort?: SortPreference;
  without?: string[];
  /** Set on our own links to a query the visitor did not type (see SearchFrom). */
  from?: SearchFrom;
}

/** Builds a /search URL. Empty values are omitted to keep URLs short and shareable. */
export function searchHref({ q, sort, without = [], from }: SearchHrefInput): string {
  const params = new URLSearchParams({ q });
  if (sort) params.set("sort", sort);
  const unique = [...new Set(without)];
  if (unique.length) params.set("without", unique.join(","));
  if (from) params.set("from", from);
  return `/search?${params.toString()}`;
}

// --- Click-out links (/go) -----------------------------------------------------------------------

/** Positions a click can report: the cards of one search (RESULTS_KEPT, 15), with room to spare. */
export const MAX_CLICK_POSITION = 100;

/**
 * A result as the server sends it to /search and "עוד N אפשרויות": tagged with the search_log row
 * it was logged under (search_log.search_uid), so its buy button can tell /go which search the
 * click came from. Absent on results that were not logged for this visitor (SEO landing pages).
 */
export type LoggedResult = ResultProduct & { search_uid?: string };

/** Which search and card a click came from (clicks.search_uid, clicks.position). Logging only. */
export interface ClickRef {
  searchUid: string | null;
  /** 1-based rank of the card: 1 is the featured card; past RESULTS_PER_PAGE, "עוד N אפשרויות". */
  position: number | null;
}

/**
 * /go/<id>?src=<button>, plus s=<search uid> and pos=<position> when the button sits on a result
 * card (pos) of a logged search (s).
 */
export function goHref(productId: string, src: string, ref: Partial<ClickRef> = {}): string {
  const params = new URLSearchParams({ src });
  if (ref.searchUid) params.set("s", ref.searchUid);
  if (ref.position) params.set("pos", String(ref.position));
  return `/go/${encodeURIComponent(productId)}?${params.toString()}`;
}
