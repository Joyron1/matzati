// Hot lists for the home carousel and /hot. Each category's list is cached as one unit for 12 hours
// with the time it was fetched (tag HOT_TAG). A stale list keeps being served while the next one is
// fetched in the background, and stays when that fetch fails. Filtering and sorting happen on the
// cached lists, so no visitor action costs an API call.
import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_cache } from "next/cache";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { STALE_RESULTS_HOURS } from "@/lib/config/site";
import { aliexpressConfig } from "@/lib/env";
import { SupabaseStore } from "@/lib/search/supabase-store";
import { serviceClient } from "@/lib/supabase/server";
import { MIX_CATEGORY_IDS, type HotCategoryId } from "./categories";
import { parseStoredLinkRows, type StoredLinkRow } from "./links";
import {
  HOT_LIST_TTL_MS,
  HotPoolError,
  HotPoolLoader,
  type HotFetchDeps,
  type HotPool,
  type HotPoolFailure,
} from "./loader";
import { interleaveHotProducts, passingFilters, type HotProduct } from "./select";

/** Cache tag of every hot list; revalidateTag(HOT_TAG) makes the next view fetch them again. */
export const HOT_TAG = "hot-products";
const REVALIDATE_SECONDS = HOT_LIST_TTL_MS / 1_000;
/**
 * Bump when the selection rules or the cached shape change, so old lists are not reused. FILTERS
 * need no bump: they are applied again to every list read (passingFilters), so a raised threshold
 * holds at once and a lowered one adds products with the next fetch.
 */
const HOT_VERSION = 1;
/** Products in the home carousel. */
export const CAROUSEL_SIZE = 16;
/**
 * The carousel shows no date, so it leaves out a list checked longer ago than /search waits before
 * it shows one (a list older than 12 hours is refreshed on the same view; this covers a refresh
 * that keeps failing).
 */
export const CAROUSEL_MAX_AGE_MS = STALE_RESULTS_HOURS * 3_600_000;

/**
 * Set while cachedHotPool reads: the loader then starts no fetch, whether the cache has no entry
 * or unstable_cache revalidates a stale one in the background (that run starts inside this
 * context). The cached function's source stays as it was, so its cache key does too.
 */
const readOnly = new AsyncLocalStorage<true>();

// One loader per server instance: concurrent cold views share one call (lib/hot/loader.ts).
const loader = new HotPoolLoader({ mayFetch: () => readOnly.getStore() !== true });

/**
 * The link fields of the stored rows among `productIds` (at most one list, 50 ids), read only when
 * a refetch's hot links call leaves products without a hot link (HotFetchDeps.storedLinks). Throws
 * on a read error; the loader then keeps the list's links.
 */
async function storedLinks(productIds: string[]): Promise<StoredLinkRow[]> {
  const { data, error } = await serviceClient()
    .from("products")
    .select(
      "product_id, link:data->>promotionLink, type:data->promotionLinkType, at:data->>promotionLinkAt",
    )
    .in("product_id", productIds);
  if (error) throw new Error(`products read failed: ${error.message}`);
  return parseStoredLinkRows(data);
}

function fetchDeps(): HotFetchDeps {
  return {
    ali: new AliExpressClient(aliexpressConfig()),
    // A row a search saved (with our Hebrew title and English data) is left as it is.
    saveProducts: (products, fetchedAt) =>
      new SupabaseStore(serviceClient()).saveProducts(products, {}, fetchedAt, {
        keepTitledRows: true,
      }),
    storedLinks,
  };
}

// Failures are thrown inside, so they are never cached.
const cachedPool = unstable_cache(
  async (key: HotCategoryId): Promise<HotPool> => loader.load(key, fetchDeps),
  ["hot-products", String(HOT_VERSION)],
  { revalidate: REVALIDATE_SECONDS, tags: [HOT_TAG] },
);

/**
 * The last list this instance served per category. While the loader waits after a failure it is
 * served from here without reading the cache (a stale entry would start a refresh that the loader
 * refuses and Next logs, on every view), and it stands in when the cache has no entry to serve.
 */
const served = new Map<HotCategoryId, HotPool>();

export type HotPoolResult = { ok: true; pool: HotPool } | { ok: false; reason: HotPoolFailure };

/** The pool with only the products that pass the current FILTERS; "empty" when none do. */
function shown(pool: HotPool): HotPoolResult {
  const products = passingFilters(pool.products);
  return products.length
    ? { ok: true, pool: { ...pool, products } }
    : { ok: false, reason: "empty" };
}

/** One category's list. Never throws: a failure is logged (once per attempt) and returned. */
export async function loadHotPool(category: HotCategoryId): Promise<HotPoolResult> {
  const last = served.get(category);
  if (last && loader.isWaiting(category)) return shown(last);
  try {
    const pool = await cachedPool(category);
    served.set(category, pool);
    return shown(pool);
  } catch (err) {
    if (!(err instanceof HotPoolError && err.waiting)) {
      const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`[hot] ${category}: ${text.slice(0, 500)}`);
    }
    if (last) return shown(last);
    return { ok: false, reason: err instanceof HotPoolError ? err.reason : "failed" };
  }
}

/**
 * One category's list as /hot would show it, only when it is already there: never an AliExpress
 * call (/p's similar products, lib/similar/load.ts). The list this instance last served while it
 * is younger than HOT_LIST_TTL_MS (or while the loader waits after a failure), otherwise the cached
 * list read with every fetch refused: a missing entry gives null, and a stale one is returned as
 * it is while its background refresh is refused (Next logs that refusal). Never throws.
 */
export async function cachedHotPool(
  category: HotCategoryId,
  now = Date.now(),
): Promise<HotPool | null> {
  const last = served.get(category);
  const lastIsFresh = last !== undefined && now - Date.parse(last.fetchedAt) < HOT_LIST_TTL_MS;
  const res =
    last && (lastIsFresh || loader.isWaiting(category))
      ? shown(last)
      : await readOnly.run(true, () => loadHotPool(category));
  return res.ok ? res.pool : null;
}

export type HotMixResult = { ok: true; pools: HotPool[] } | { ok: false; reason: HotPoolFailure };

/**
 * The lists of MIX_CATEGORY_IDS, in that order: whichever loaded. Fails only when none did
 * ("empty" when every one was empty). Cold lists are fetched one after another (loader spacing).
 */
export async function loadHotMix(): Promise<HotMixResult> {
  const results = await Promise.all(MIX_CATEGORY_IDS.map((id) => loadHotPool(id)));
  const pools = results.flatMap((r) => (r.ok ? [r.pool] : []));
  if (pools.length) return { ok: true, pools };
  const empty = results.every((r) => !r.ok && r.reason === "empty");
  return { ok: false, reason: empty ? "empty" : "failed" };
}

/**
 * The home carousel: the mixed categories' best sellers in turn, from lists checked in the last
 * CAROUSEL_MAX_AGE_MS; [] when there is nothing.
 */
export async function hotCarouselProducts(now = new Date()): Promise<HotProduct[]> {
  const mix = await loadHotMix();
  if (!mix.ok) return [];
  const recent = mix.pools.filter(
    (pool) => now.getTime() - Date.parse(pool.fetchedAt) <= CAROUSEL_MAX_AGE_MS,
  );
  return interleaveHotProducts(
    recent.map((pool) => pool.products),
    CAROUSEL_SIZE,
  );
}
