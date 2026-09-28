// /hot URL params <-> HotFilter. Pure, so the page, its links, its form and the tests agree on one
// shape: invalid values are dropped rather than reported, like /searches (lib/recent/params.ts).
import { firstParam } from "@/lib/search-url";
import { isHotCategoryId, type HotCategoryId } from "./categories";
import { HOT_SORTS, PRICE_BAND_IDS, type HotSort, type HotView, type PriceBand } from "./select";

type Param = string | string[] | undefined;

export const HOT_PATH = "/hot";
/** Products per "הצגת עוד" step. Divides into 2, 3 and 4 grid columns. */
export const HOT_PAGE_SIZE = 12;
/** One fetched list holds at most 50 products (page_size), so 5 steps show all of it. */
export const HOT_MAX_PAGES = 5;
export const DEFAULT_HOT_SORT: HotSort = "sales";

export interface HotFilter extends HotView {
  /** A category from HOT_CATEGORY_IDS; undefined for the whole list. */
  category?: HotCategoryId;
  /** 1..HOT_MAX_PAGES; page n shows the first n * HOT_PAGE_SIZE products. */
  page: number;
}

const PAGE = /^\d+$/;

function parsePage(value: string): number {
  if (!PAGE.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), HOT_MAX_PAGES);
}

const parseSort = (value: string): HotSort =>
  (HOT_SORTS as readonly string[]).includes(value) ? (value as HotSort) : DEFAULT_HOT_SORT;

const parsePrice = (value: string): PriceBand | undefined =>
  (PRICE_BAND_IDS as string[]).includes(value) ? (value as PriceBand) : undefined;

/** Validated filter from /hot search params: cat, price, sort, code, video, page. */
export function parseHotParams(params: Record<string, Param>): HotFilter {
  // Own keys only: a "__proto__" param must not read Object.prototype.
  const get = (key: string) => (Object.hasOwn(params, key) ? firstParam(params[key]) : "");
  const cat = get("cat");
  const price = parsePrice(get("price"));
  return {
    ...(isHotCategoryId(cat) ? { category: cat } : {}),
    ...(price !== undefined ? { price } : {}),
    sort: parseSort(get("sort")),
    // The form's checkboxes send "1".
    withCode: get("code") === "1",
    withVideo: get("video") === "1",
    page: parsePage(get("page")),
  };
}

/**
 * Link to /hot for a filter, params in a fixed order; defaults (the whole list, sales order,
 * page 1, unset toggles) are left out of the URL.
 */
export function hotHref(filter: Partial<HotFilter>): string {
  const params = new URLSearchParams();
  if (filter.category && isHotCategoryId(filter.category)) params.set("cat", filter.category);
  if (filter.price && parsePrice(filter.price)) params.set("price", filter.price);
  if (filter.sort && filter.sort !== DEFAULT_HOT_SORT && parseSort(filter.sort) === filter.sort) {
    params.set("sort", filter.sort);
  }
  if (filter.withCode) params.set("code", "1");
  if (filter.withVideo) params.set("video", "1");
  const page = filter.page;
  if (page !== undefined && Number.isInteger(page) && page > 1) {
    params.set("page", String(Math.min(page, HOT_MAX_PAGES)));
  }
  const query = params.toString();
  return query ? `${HOT_PATH}?${query}` : HOT_PATH;
}

/** The canonical URL of a /hot view: the category only. Filters, sort and page are views of it. */
export function hotCanonicalPath(category?: HotCategoryId): string {
  return hotHref({ category });
}

/**
 * /p link of a product card on /hot. from=hot (with the category) gives /p a way back to the list
 * (hotBackHref); the filters, sort and page are left to the browser's back button.
 */
export function hotProductHref(productId: string, category?: HotCategoryId): string {
  const params = new URLSearchParams({ from: "hot" });
  if (category && isHotCategoryId(category)) params.set("cat", category);
  return `/p/${encodeURIComponent(productId)}?${params}`;
}

/** Where /p's back link goes for a product opened from /hot (from=hot), or null. */
export function hotBackHref(params: Record<string, Param>): string | null {
  const from = Object.hasOwn(params, "from") ? firstParam(params.from) : "";
  if (from !== "hot") return null;
  return hotCanonicalPath(parseHotParams(params).category);
}

/** True when a filter narrows the list (price, code, video); the sort does not. */
export function isNarrowed(filter: HotView): boolean {
  return filter.price !== undefined || filter.withCode || filter.withVideo;
}
