// /products/<slug> URL params <-> CategoryFilter. Pure, so the page, its links, its form and the
// tests agree on one shape: invalid values are dropped rather than reported, like /hot's
// (lib/hot/params.ts), whose view params (price, sort, toggles, page) mean the same here.
import { HOT_MAX_LIST_PAGES } from "@/lib/hot/categories";
import { hotViewParams, parseHotParams } from "@/lib/hot/params";
import type { HotView } from "@/lib/hot/select";
import { firstParam } from "@/lib/search-url";
import { categoryPath, type CatalogCategory } from "./categories";
import { OTHER_SUBCATEGORY, SUBCATEGORY_NAMES_HE } from "./subcategories";

type Param = string | string[] | undefined;

/** Products per "הצגת עוד מוצרים" step, as on the hub: divides into 2, 3 and 4 grid columns. */
export const CATEGORY_PAGE_SIZE = 12;
/** Steps that can show every product of HOT_MAX_LIST_PAGES lists of at most 50 each. */
export const CATEGORY_MAX_STEPS = Math.ceil((HOT_MAX_LIST_PAGES * 50) / CATEGORY_PAGE_SIZE);

export interface CategoryFilter extends HotView {
  /** A second-level id named for this category, or OTHER_SUBCATEGORY; undefined for all. */
  sub?: string;
  /** 1..CATEGORY_MAX_STEPS; step n shows the first n * CATEGORY_PAGE_SIZE products. */
  page: number;
  /**
   * Pages of the AliExpress hot list loaded (1..HOT_MAX_LIST_PAGES). Page 1 is loaded on every
   * view; pages 2 and 3 only once a visitor asked for more ("הצגת עוד מוצרים"), and a filter or a
   * sub-category keeps what was loaded, so neither ever costs a call.
   */
  lists: number;
}

const WHOLE = /^\d+$/;

function parseLists(value: string): number {
  if (!WHOLE.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), HOT_MAX_LIST_PAGES);
}

function parseStep(value: string): number {
  if (!WHOLE.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), CATEGORY_MAX_STEPS);
}

/** True for a sub-category pill `category` can show (never for a slice, which is one already). */
export function isCategorySub(category: CatalogCategory, sub: string): boolean {
  if (category.slice) return false;
  if (sub === OTHER_SUBCATEGORY) return true;
  const names = SUBCATEGORY_NAMES_HE[category.firstLevelId];
  return names !== undefined && Object.hasOwn(names, sub);
}

/** Validated filter from a category page's search params: sub, price, sort, code, video, page, lists. */
export function parseCategoryParams(
  category: CatalogCategory,
  params: Record<string, Param>,
): CategoryFilter {
  // Own keys only: a "__proto__" param must not read Object.prototype.
  const get = (key: string) => (Object.hasOwn(params, key) ? firstParam(params[key]) : "");
  const { price, sort, withCode, withVideo } = parseHotParams(params);
  const sub = get("sub");
  return {
    ...(isCategorySub(category, sub) ? { sub } : {}),
    ...(price !== undefined ? { price } : {}),
    sort,
    withCode,
    withVideo,
    page: parseStep(get("page")),
    lists: parseLists(get("lists")),
  };
}

/**
 * Link to a category page for a filter, params in a fixed order; defaults (all sub-categories,
 * sales order, step 1, one list, unset toggles) are left out of the URL.
 */
export function categoryHref(category: CatalogCategory, filter: Partial<CategoryFilter>): string {
  const params = new URLSearchParams();
  if (filter.sub && isCategorySub(category, filter.sub)) params.set("sub", filter.sub);
  for (const [key, value] of hotViewParams(filter, CATEGORY_MAX_STEPS)) params.set(key, value);
  const lists = filter.lists;
  if (lists !== undefined && Number.isInteger(lists) && lists > 1) {
    params.set("lists", String(Math.min(lists, HOT_MAX_LIST_PAGES)));
  }
  const query = params.toString();
  return query ? `${categoryPath(category)}?${query}` : categoryPath(category);
}

/**
 * What "הצגת עוד מוצרים" asks for: the next step of the products already loaded, or, once they are
 * all shown, the next page of the hot list too (only while fewer than HOT_MAX_LIST_PAGES are
 * loaded and every loaded page came back). Null when there is nothing more to ask for.
 */
export function nextCategoryStep(
  filter: CategoryFilter,
  shown: number,
  matching: number,
  allListsLoaded: boolean,
): CategoryFilter | null {
  if (filter.page >= CATEGORY_MAX_STEPS) return null;
  if (shown < matching) return { ...filter, page: filter.page + 1 };
  if (allListsLoaded && filter.lists < HOT_MAX_LIST_PAGES) {
    return { ...filter, page: filter.page + 1, lists: filter.lists + 1 };
  }
  return null;
}
