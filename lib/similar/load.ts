// Reads for /p's similar products (./select.ts). Reads only: never an LLM call, an AliExpress call
// or a database write. When anything it needs is not already cached, the section is left out.
import "server-only";
import {
  catalogByFirstLevel,
  catalogFetchId,
  type CatalogCategory,
} from "@/lib/catalog/categories";
import { mergeCategoryPages } from "@/lib/catalog/list";
import { hotListKey } from "@/lib/hot/categories";
import { cachedHotPool } from "@/lib/hot/queries";
import { SHOP_CAP_MODES } from "@/lib/ranking/config";
import { applyOverrides } from "@/lib/search/chips";
import { filtersKey, queryKey } from "@/lib/search/cache-key";
import type { SortPreference } from "@/lib/search/filters";
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import type { CachedResults } from "@/lib/search/store";
import { SupabaseStore } from "@/lib/search/supabase-store";
import { shopCapMode } from "@/lib/settings/queries";
import { serviceClient } from "@/lib/supabase/server";
import { similarFromHot, similarFromSearch, type SimilarProducts } from "./select";

export interface SimilarRequest {
  /** The product the page is for: never one of its own similar products. */
  productId: string;
  /** Its first-level category, for a product opened from /hot without one. */
  categoryId: string | null;
  /** The search the visitor came from (/p?q=), or "". */
  q: string;
  /** A sort or removed chips of that search, when the link says so (not sent today). */
  sort?: SortPreference;
  without?: string[];
  /**
   * Opened from a hot list (from=hot): the catalog category the link names (null for the mix, or a
   * link without one).
   */
  hot: { category: CatalogCategory | null } | null;
}

/**
 * The other products of the list the visitor came from, or null. A search: the parse cache for the
 * query (never a parse call), then the results cache for the filters it gives, as the results page
 * builds them. The hot list: only a list that is already cached (cachedHotPool). Then one read of
 * `products` keeps the ones /p can show. Never throws.
 */
export async function similarForPage(req: SimilarRequest): Promise<SimilarProducts | null> {
  try {
    if (req.q) return await fromSearch(req);
    if (req.hot) return await fromHot(req);
    return null;
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[similar] ${text.slice(0, 300)}`);
    return null;
  }
}

async function fromSearch(req: SimilarRequest): Promise<SimilarProducts | null> {
  const q = req.q.trim();
  if (!q || q.length > MAX_QUERY_LENGTH) return null;
  const store = new SupabaseStore(serviceClient());
  const now = new Date();
  const parsed = await store.peekParse(queryKey(q), now);
  if (!parsed) return null;
  const filters = {
    ...applyOverrides(parsed, req.without ?? []),
    ...(req.sort ? { sort_preference: req.sort } : {}),
  };
  // The result set of the shop cap mode searches rank under now, else of the other mode: the
  // visitor may have searched before the admin switched it (the list they saw is the one to show).
  const current = await shopCapMode();
  let cached: CachedResults | null = null;
  for (const mode of [current, ...SHOP_CAP_MODES.filter((m) => m !== current)]) {
    cached = await store.peekResults(filtersKey(filters, mode), now);
    if (cached?.products.length) break;
  }
  if (!cached?.products.length) return null;
  const others = cached.products.map((p) => p.productId).filter((id) => id !== req.productId);
  const stored = await store.storedTitles(others);
  if (!stored) return null;
  return similarFromSearch(cached, { currentId: req.productId, q, stored });
}

async function fromHot(req: SimilarRequest): Promise<SimilarProducts | null> {
  // Without a category (the mix, "מבחר") the list of the product's own category, when it has one.
  const own = req.categoryId !== null ? catalogByFirstLevel(req.categoryId) : null;
  const category = req.hot?.category ?? own;
  if (!category) return null;
  // Page 1 of its list, a slice filtered to its second-level category (as its page shows it).
  const pool = await cachedHotPool(hotListKey(catalogFetchId(category), 1));
  const list = pool ? mergeCategoryPages(category, [pool]) : null;
  if (!pool || !list) return null;
  const others = list.products.map((p) => p.productId).filter((id) => id !== req.productId);
  const stored = await new SupabaseStore(serviceClient()).storedTitles(others);
  if (!stored) return null;
  return similarFromHot(list.products, {
    currentId: req.productId,
    categoryKey: category.key,
    categoryHe: category.nameHe,
    fetchedAt: pool.fetchedAt,
    stored,
  });
}
