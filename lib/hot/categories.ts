// The first-level categories whose hot lists the site shows (the categories of /products,
// lib/catalog/categories.ts). A fixed list, so a link never costs an AliExpress call by itself: a
// category's hot list is fetched only when someone opens it (lib/hot/queries.ts), and only ids
// from this list (plus a catalog slice once its direct fetch is verified, DIRECT_FETCH_IDS) are
// ever fetched, so a crawler cannot spend quota on made-up categories. First-level ids from
// aliexpress.affiliate.category.get (fixtures/aliexpress); the Hebrew names are ours (the
// catalog's), never AliExpress's machine-translated ones.
import { CATALOG, DIRECT_FETCH_IDS, catalogByFirstLevel } from "@/lib/catalog/categories";

/** First-level categories with a hot list, in the order /hot had them, then the 2026-10-03 ones. */
export const HOT_CATEGORY_IDS = [
  "44", // Consumer Electronics (probed 2026-09-28: 41 of 46 passed FILTERS)
  "202192403", // Phones & Telecommunications Accessories
  "15", // Home & Garden (40 of 50 on 2026-09-28)
  "6", // Home Appliances
  "7", // Computer & Office
  "34", // Automobiles, Parts & Accessories (36 of 45 on 2026-09-28)
  "18", // Sports & Entertainment
  "66", // Beauty & Health
  "26", // Toys & Hobbies
  "1501", // Mother & Kids
  "1420", // Tools
  "39", // Lights & Lighting
  // Added with /products (owner request 2026-10-03); not probed yet, so their first lists show
  // how many pass FILTERS.
  "36", // Jewelry & Accessories
  "1511", // Watches
  "1524", // Luggage & Bags
] as const;

export type HotCategoryId = (typeof HOT_CATEGORY_IDS)[number];

/**
 * The categories of the home carousel's extra lists (CAROUSEL_EXTRA_CATEGORY_IDS): the hot
 * categories /hot had, so adding the /products categories does not add warm-up calls (each list
 * warmed costs 2 calls every 12 hours) nor wedding dresses to the home page.
 */
export const CAROUSEL_CATEGORY_IDS = [
  "44",
  "202192403",
  "15",
  "6",
  "7",
  "34",
  "18",
  "66",
  "26",
  "1501",
  "1420",
  "39",
] as const satisfies readonly HotCategoryId[];

/**
 * An id a hot list may be fetched with: a first-level hot category, or a catalog slice's own
 * second-level id once its direct fetch is verified (DIRECT_FETCH_IDS, empty by default).
 */
export type HotFetchId = string;

export function isHotFetchId(value: string): value is HotFetchId {
  return isHotCategoryId(value) || DIRECT_FETCH_IDS.includes(value);
}

/**
 * Pages of one category's hot list the site may fetch (owner request 2026-10-03: about 150
 * products on a category page). Page 1 when the list is first shown, pages 2 and 3 only when a
 * visitor asks for more; never more, whatever a link says.
 */
export const HOT_MAX_LIST_PAGES = 3;

/**
 * The cache and loader key of one page of one list: the fetch id alone for page 1 (the key the
 * lists were cached under before pages 2-3 existed, so those entries stay valid), "<id>:<page>"
 * for pages 2..HOT_MAX_LIST_PAGES.
 */
export type HotListKey = HotFetchId | `${HotFetchId}:${2 | 3}`;

export function hotListKey(id: HotFetchId, page = 1): HotListKey {
  const p = Math.trunc(page);
  return p >= 2 && p <= HOT_MAX_LIST_PAGES ? (`${id}:${p}` as HotListKey) : id;
}

/** The fetch id and page of a key, or null for anything that is not an allowed key. */
export function parseHotListKey(key: string): { id: HotFetchId; page: number } | null {
  const match = /^(\d+)(?::([23]))?$/.exec(key);
  if (!match || !isHotFetchId(match[1])) return null;
  const page = match[2] ? Number(match[2]) : 1;
  return page <= HOT_MAX_LIST_PAGES ? { id: match[1], page } : null;
}

/**
 * The home carousel and /hot without a category ("מבחר") mix these categories' lists. AliExpress's
 * list without a category is no mix: 25 of 47 were phone cases in the probe, and on 2026-09-28
 * only 6 of 49 were left once each second-level category was capped at 2. The lists are shared
 * with the pills, and a cold mix costs one call per category.
 */
export const MIX_CATEGORY_IDS = ["44", "15", "34", "26"] as const satisfies HotCategoryId[];

export interface HotCategory {
  id: HotCategoryId;
  labelHe: string;
}

export function isHotCategoryId(value: string): value is HotCategoryId {
  return (HOT_CATEGORY_IDS as readonly string[]).includes(value);
}

/**
 * The hot categories with the Hebrew name of their whole-list catalog category, in catalog order.
 * An id without one is left out (a test guards this).
 */
export function hotCategories(): HotCategory[] {
  return CATALOG.flatMap((c) =>
    !c.slice && isHotCategoryId(c.firstLevelId) ? [{ id: c.firstLevelId, labelHe: c.nameHe }] : [],
  );
}

/** Our Hebrew name of a hot category (its catalog name), or null for any other id. */
export function hotCategoryLabel(id: string): string | null {
  return isHotCategoryId(id) ? (catalogByFirstLevel(id)?.nameHe ?? null) : null;
}
