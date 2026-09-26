import type { SortPreference } from "./types";

type Param = string | string[] | undefined;

const SORTS: readonly SortPreference[] = ["best_value", "cheapest", "most_popular"];

export function firstParam(value: Param): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseSort(value: Param): SortPreference {
  const v = firstParam(value);
  return (SORTS as readonly string[]).includes(v) ? (v as SortPreference) : "best_value";
}

export function parseWithout(value: Param): string[] {
  return firstParam(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SearchHrefInput {
  q: string;
  sort?: SortPreference;
  without?: string[];
  demo?: string;
}

/** Builds a /search URL. Defaults are omitted to keep URLs short and shareable. */
export function searchHref({ q, sort, without = [], demo }: SearchHrefInput): string {
  const params = new URLSearchParams({ q });
  if (sort && sort !== "best_value") params.set("sort", sort);
  const unique = [...new Set(without)];
  if (unique.length) params.set("without", unique.join(","));
  if (demo) params.set("demo", demo);
  return `/search?${params.toString()}`;
}
