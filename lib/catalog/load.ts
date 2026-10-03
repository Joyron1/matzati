// Reads of the hot lists behind /products and its category pages. Every list goes through
// lib/hot/queries.ts (12-hour cache, the loader's spacing, back-off and allow-list), so nothing here
// can fetch an id or a page outside HOT_CATEGORY_IDS and HOT_MAX_LIST_PAGES.
import "server-only";
import { hotListKey, HOT_MAX_LIST_PAGES } from "@/lib/hot/categories";
import type { HotPoolFailure } from "@/lib/hot/loader";
import { cachedHotPool, loadHotPool, servedHotPool } from "@/lib/hot/queries";
import { catalogFetchId, type CatalogCategory } from "./categories";
import { mergeCategoryPages, type CategoryProducts, type ListPage } from "./list";

export type CategoryListResult =
  | {
      ok: true;
      list: CategoryProducts;
      /** Pages of the hot list that came back (page 1 always). */
      loaded: number;
      /** Every page asked for came back (or was empty): the next one may be offered. */
      complete: boolean;
    }
  | { ok: false; reason: HotPoolFailure };

/**
 * The first `lists` pages of `category`'s hot list, merged (mergeCategoryPages). Page 1 is loaded
 * like the hub's lists (fetched when cold). Pages 2 and up are loaded one after another, only as
 * far as `lists` (at most HOT_MAX_LIST_PAGES) and only after the page before them came back; with
 * `readOnlyMore` (a crawler) they are served only when already cached (cachedHotPool: never a
 * call). A page where nothing passed counts as loaded and empty; a failed page ends the loading.
 * Fails only when page 1 fails.
 */
export async function loadCategoryList(
  category: CatalogCategory,
  lists: number,
  { readOnlyMore = false }: { readOnlyMore?: boolean } = {},
): Promise<CategoryListResult> {
  const id = catalogFetchId(category);
  const first = await loadHotPool(hotListKey(id, 1));
  if (!first.ok) return first;
  const pages: ListPage[] = [first.pool];
  let complete = true;
  for (let page = 2; page <= Math.min(lists, HOT_MAX_LIST_PAGES); page++) {
    const key = hotListKey(id, page);
    if (readOnlyMore) {
      const pool = await cachedHotPool(key);
      if (!pool) {
        complete = false;
        break;
      }
      pages.push(pool);
      continue;
    }
    const res = await loadHotPool(key);
    if (res.ok) pages.push(res.pool);
    else if (res.reason !== "empty") {
      complete = false;
      break;
    }
  }
  const list = mergeCategoryPages(category, pages);
  return list
    ? { ok: true, list, loaded: pages.length, complete }
    : { ok: false, reason: "failed" };
}

/**
 * A photo for the hub's tile of `category`: the first product of its list's page 1 that this
 * instance already holds, or null. Never a cache read or an AliExpress call.
 */
export function cachedCategoryPhoto(category: CatalogCategory): string | null {
  const pool = servedHotPool(hotListKey(catalogFetchId(category), 1));
  if (!pool) return null;
  const list = mergeCategoryPages(category, [pool]);
  return list?.products.find((p) => p.imageUrl)?.imageUrl ?? null;
}
