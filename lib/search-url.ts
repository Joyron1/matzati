import type { SortPreference } from "./types";

type Param = string | string[] | undefined;

const SORTS: readonly SortPreference[] = ["best_value", "cheapest", "most_popular"];
const MAX_REMOVED = 10;

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

export interface SearchHrefInput {
  q: string;
  /** Explicit sort override; omitted, the search uses the sort parsed from the query. */
  sort?: SortPreference;
  without?: string[];
}

/** Builds a /search URL. Empty values are omitted to keep URLs short and shareable. */
export function searchHref({ q, sort, without = [] }: SearchHrefInput): string {
  const params = new URLSearchParams({ q });
  if (sort) params.set("sort", sort);
  const unique = [...new Set(without)];
  if (unique.length) params.set("without", unique.join(","));
  return `/search?${params.toString()}`;
}
