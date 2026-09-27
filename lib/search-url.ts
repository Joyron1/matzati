import type { SortPreference } from "./types";

type Param = string | string[] | undefined;

const SORTS: readonly SortPreference[] = ["best_value", "cheapest", "most_popular"];
const MAX_REMOVED = 10;

/**
 * Where a /search link came from when the visitor did not type the query: a recent-search card
 * or one of our example queries. Such a search is logged as usual but never listed on /searches.
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
