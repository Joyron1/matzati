// /searches URL params <-> RecentSearchFilter. Pure, so the page, its links and the tests agree on
// one shape: invalid values are dropped rather than reported, like the other public pages.
import { firstParam } from "@/lib/search-url";
import {
  OTHER_CATEGORY,
  RECENT_MAX_PAGES,
  RECENT_TEXT_MAX,
  type RecentSearchFilter,
} from "./types";

type Param = string | string[] | undefined;

export const RECENT_PATH = "/searches";

// AliExpress category ids are numeric; the length cap keeps junk out of the cache key.
const CATEGORY_ID = /^\d{1,12}$/;
const PAGE = /^\d+$/;

/** A category id or OTHER_CATEGORY, else undefined. */
function parseCategory(value: string): string | undefined {
  return CATEGORY_ID.test(value) || value === OTHER_CATEGORY ? value : undefined;
}

/** Trimmed, whitespace collapsed, at most RECENT_TEXT_MAX characters; undefined when empty. */
export function cleanRecentText(value: string): string | undefined {
  const collapsed = value.replace(/\s+/g, " ").trim();
  // By code point, so a cut never splits a surrogate pair.
  const text = Array.from(collapsed).slice(0, RECENT_TEXT_MAX).join("").trim();
  return text || undefined;
}

/** 1..RECENT_MAX_PAGES; anything that is not a whole number is page 1. */
function parsePage(value: string): number {
  if (!PAGE.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), RECENT_MAX_PAGES);
}

/** Validated filter from /searches search params: cat, q, page. Invalid values are dropped. */
export function parseRecentParams(params: Record<string, Param>): RecentSearchFilter {
  // Own keys only: a "__proto__" param must not read Object.prototype.
  const get = (key: string) => (Object.hasOwn(params, key) ? firstParam(params[key]) : "");
  const category = parseCategory(get("cat"));
  const text = cleanRecentText(get("q"));
  return {
    ...(category !== undefined ? { category } : {}),
    ...(text !== undefined ? { text } : {}),
    page: parsePage(get("page")),
  };
}

/** Link to /searches for a filter; page 1 and empty values are left out of the URL. */
export function recentHref(filter: Partial<RecentSearchFilter>): string {
  const params = new URLSearchParams();
  const category = filter.category ? parseCategory(filter.category) : undefined;
  if (category) params.set("cat", category);
  const text = filter.text ? cleanRecentText(filter.text) : undefined;
  if (text) params.set("q", text);
  const page = filter.page;
  if (page !== undefined && Number.isInteger(page) && page > 1) {
    params.set("page", String(Math.min(page, RECENT_MAX_PAGES)));
  }
  const query = params.toString();
  return query ? `${RECENT_PATH}?${query}` : RECENT_PATH;
}
