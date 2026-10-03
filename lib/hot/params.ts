// The hot list's URL params <-> HotFilter, for /products (the hub's "מבחר" list) and the old /hot
// address it replaced. Pure, so the page, its links, its form and the tests agree on one shape:
// invalid values are dropped rather than reported, like /searches (lib/recent/params.ts).
// Category pages (/products/<slug>) have their own params (lib/catalog/params.ts).
import {
  catalogByFirstLevel,
  catalogByKey,
  categoryPath,
  type CatalogCategory,
} from "@/lib/catalog/categories";
import { firstParam } from "@/lib/search-url";
import { isHotCategoryId, type HotCategoryId } from "./categories";
import { HOT_SORTS, PRICE_BAND_IDS, type HotSort, type HotView, type PriceBand } from "./select";

type Param = string | string[] | undefined;

/**
 * The old address of the hot list (2026-09-28 to 2026-10-03), now a permanent redirect to
 * /products (app/hot/route.ts, hotRedirectHref): old links, bookmarks and indexed pages keep
 * working.
 */
export const HOT_PATH = "/hot";
/** "כל המוצרים": the categories and the mixed hot list ("מבחר"). */
export const PRODUCTS_PATH = "/products";
/** Products per "הצגת עוד" step. Divides into 2, 3 and 4 grid columns. */
export const HOT_PAGE_SIZE = 12;
/** One fetched list holds at most 50 products (page_size), so 5 steps show all of it. */
export const HOT_MAX_PAGES = 5;
export const DEFAULT_HOT_SORT: HotSort = "sales";

export interface HotFilter extends HotView {
  /**
   * A category from HOT_CATEGORY_IDS (an old /hot?cat= link, redirected to its category page);
   * undefined for the mix.
   */
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
 * The view params of a hot list link (price, sort, toggles, page), in a fixed order; defaults
 * (sales order, page 1, unset toggles) are left out. `maxPage` caps the page (the hub's
 * HOT_MAX_PAGES, a category page's own cap).
 */
export function hotViewParams(
  filter: Partial<HotView & { page: number }>,
  maxPage: number = HOT_MAX_PAGES,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.price && parsePrice(filter.price)) params.set("price", filter.price);
  if (filter.sort && filter.sort !== DEFAULT_HOT_SORT && parseSort(filter.sort) === filter.sort) {
    params.set("sort", filter.sort);
  }
  if (filter.withCode) params.set("code", "1");
  if (filter.withVideo) params.set("video", "1");
  const page = filter.page;
  if (page !== undefined && Number.isInteger(page) && page > 1) {
    params.set("page", String(Math.min(page, maxPage)));
  }
  return params;
}

/**
 * Link to the hub's mixed list ("מבחר" on /products) for a filter; defaults are left out of the
 * URL. A category has its own page (categoryHref in lib/catalog/params.ts), so `category` is not
 * read here.
 */
export function hotHref(filter: Partial<HotFilter>): string {
  const query = hotViewParams(filter).toString();
  return query ? `${PRODUCTS_PATH}?${query}` : PRODUCTS_PATH;
}

/** The canonical URL of a hot list: its category page, or /products for the mix. */
export function hotCanonicalPath(category?: HotCategoryId): string {
  const entry = category ? catalogByFirstLevel(category) : null;
  return entry ? categoryPath(entry) : PRODUCTS_PATH;
}

/**
 * Where an old /hot address goes (permanent redirect, app/hot/route.ts): /hot?cat=<id> to that
 * category's page, anything else to /products, with the price, sort, toggles and page, which mean
 * the same there. An unknown cat is dropped, as /hot dropped it.
 */
export function hotRedirectHref(params: Record<string, Param>): string {
  const filter = parseHotParams(params);
  const entry = filter.category ? catalogByFirstLevel(filter.category) : null;
  if (!entry) return hotHref(filter);
  // A category page shows more products per list than /hot did, so the page always fits.
  const query = hotViewParams(filter).toString();
  return query ? `${categoryPath(entry)}?${query}` : categoryPath(entry);
}

/**
 * /p link of a hot product card. from=hot with the catalog category's key (`cat`, the first-level
 * id for a whole list, the second-level id for a slice: the format /hot's links had) gives /p a
 * way back to the list (hotBack); the filters, sort and page are left to the browser's back button.
 */
export function hotProductHref(productId: string, categoryKey?: string): string {
  const params = new URLSearchParams({ from: "hot" });
  if (categoryKey && catalogByKey(categoryKey)) params.set("cat", categoryKey);
  return `/p/${encodeURIComponent(productId)}?${params}`;
}

/** /p's way back to the hot list a product was opened from. */
export interface HotBack {
  href: string;
  label: string;
  /** The catalog category of the list, or null for the mix ("מבחר"). */
  category: CatalogCategory | null;
}

/**
 * Where /p's back link goes for a product opened from a hot list (from=hot), or null: the category
 * page named by `cat` (a catalog key; old /hot links name a first-level id, which is the key of
 * its whole-list category), else /products.
 */
export function hotBack(params: Record<string, Param>): HotBack | null {
  const from = Object.hasOwn(params, "from") ? firstParam(params.from) : "";
  if (from !== "hot") return null;
  const category = catalogByKey(Object.hasOwn(params, "cat") ? firstParam(params.cat) : "");
  return category
    ? { href: categoryPath(category), label: `חזרה ל${category.nameHe}`, category }
    : { href: PRODUCTS_PATH, label: "חזרה לכל המוצרים", category: null };
}

/** Where /p's back link goes for a product opened from a hot list (from=hot), or null. */
export function hotBackHref(params: Record<string, Param>): string | null {
  return hotBack(params)?.href ?? null;
}

/** True when a filter narrows the list (price, code, video); the sort does not. */
export function isNarrowed(filter: HotView): boolean {
  return filter.price !== undefined || filter.withCode || filter.withVideo;
}
