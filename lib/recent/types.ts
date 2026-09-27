// Public "חיפושים אחרונים" page (/searches): one card per normalized query, built from search_log
// rows of queries visitors typed (source "search", not from one of our links, no chips removed, no
// sort override) that found products and passed the privacy check in lib/recent/privacy.ts.
// Hidden by an admin = never shown.
import type { FilterChip } from "@/lib/types";

export interface RecentSearchImage {
  /** Product photo URL (only hosts that isAllowedImage in lib/images.ts accepts are shown). */
  src: string;
  /** The product's Hebrew title when we have one, else its English title. */
  alt: string;
}

export interface RecentSearch {
  /** normalizeQuery(query): the card's identity; the admin hides by it. */
  queryNorm: string;
  /** The query as typed in its latest listed search. */
  query: string;
  /** Understood filters of that search: buildChips(parsed), product chip first. */
  chips: FilterChip[];
  /** First-level AliExpress category of its top result; null when unknown. */
  categoryId: string | null;
  /** Hebrew name of categoryId (categoryLabelHe in lib/tips/category.ts); null when we have none. */
  categoryHe: string | null;
  /** Up to 3 result photos, in result order. */
  images: RecentSearchImage[];
  /** Results that search showed (1-3). */
  resultsCount: number;
  /**
   * ISO time of its latest listed search, rounded down to the hour: an exact time could tie the
   * query to whoever searched then.
   */
  searchedAt: string;
}

export interface RecentCategory {
  /** A first-level category id, or OTHER_CATEGORY. */
  id: string;
  labelHe: string;
  /** Listed queries (cards) in this category. */
  count: number;
}

export interface RecentSearchFilter {
  /** A first-level category id, or OTHER_CATEGORY (no Hebrew name, or unknown). */
  category?: string;
  /** Free text (already trimmed, 1-60 chars), matched against the query and the product label. */
  text?: string;
  /** 1-based; page n shows the first n * RECENT_PAGE_SIZE cards. */
  page: number;
}

export interface RecentSearchList {
  items: RecentSearch[];
  /** More cards match the filter. Always false on page RECENT_MAX_PAGES, the last page we link. */
  hasMore: boolean;
  /** Categories among all listed searches (ignoring the filter), most cards first. */
  categories: RecentCategory[];
}

export const RECENT_PAGE_SIZE = 24;
export const RECENT_MAX_PAGES = 10;
export const RECENT_TEXT_MAX = 60;
export const OTHER_CATEGORY = "other";
/** Cache tag of every recent-searches read; admin hide/unhide calls updateTag(RECENT_TAG). */
export const RECENT_TAG = "recent-searches";
