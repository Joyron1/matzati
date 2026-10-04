// The checked pool kept with a result set (docs/search-quality-plan.md item 13). A fetch ranks,
// once, every view a visitor can reach from its results page without new products: the other two
// sorts, and every set of requirement chips removed. A sort change or a removed requirement is
// then served from what was already checked, with no product.query call and no new parse, and
// its order and counts are exactly what a fetch of the same pool would give, since every view is
// ranked (rankWithFill) over every product the fetch checked. A removed price bound is never a
// view: the bounds were sent to AliExpress, so the pool holds almost nothing outside them, and
// that search fetches again. A view that removes a requirement and shows fewer than a page is not
// kept either: that search fetches again with the requirement's words out of the keywords, as it
// did before the pool existed. Pure: no I/O.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import type { ShopCapMode } from "@/lib/ranking/config";
import { rankForSearch } from "@/lib/ranking/rank";
import type { FilterBlocker } from "@/lib/types";
import { applyOverrides, MAX_CHIP, MIN_CHIP, requirementChipId } from "./chips";
import type { ParsedQuery, SortPreference } from "./filters";
import type { CachedPool, CachedResults, CachedView } from "./store";

export const SORTS: readonly SortPreference[] = ["best_value", "cheapest", "most_popular"];

const unique = (xs: readonly string[]) => [...new Set(xs)];

/** A view of a pool: its sort and the requirement chips removed from the parse, in any order. */
export function viewKeyOf(sort: SortPreference, removedRequirements: readonly string[]): string {
  return JSON.stringify([sort, unique(removedRequirements).sort()]);
}

/** The chip ids of `without` that remove one of the parse's requirements (others change nothing). */
export function removedRequirements(parsed: ParsedQuery, without: readonly string[]): string[] {
  const ids = new Set(parsed.requirements.map((r) => requirementChipId(r.en)));
  return unique(without.filter((id) => ids.has(id)));
}

/** The chip ids of `without` that remove one of the parse's price bounds. */
export function removedPrices(parsed: ParsedQuery, without: readonly string[]): string[] {
  return unique(
    without.filter(
      (id) =>
        (id === MIN_CHIP && parsed.min_price_ils !== undefined) ||
        (id === MAX_CHIP && parsed.max_price_ils !== undefined),
    ),
  );
}

/** Every subset of `ids`, the empty one first. */
function subsets(ids: readonly string[]): string[][] {
  return ids.reduce<string[][]>((all, id) => [...all, ...all.map((s) => [...s, id])], [[]]);
}

/** One view to rank from a fetch's pool. */
export interface ViewSpec {
  key: string;
  /** The filters a request for this view searches with (applyOverrides plus the sort). */
  filters: ParsedQuery;
  /** Removes a requirement the fetch kept: shown only with at least a page of results. */
  removesMore: boolean;
}

/**
 * Every view a fetch made with `without` can serve: the three sorts, for the fetch's own
 * requirements and for every set of them removed on top. The filters are built from the parse the
 * way a request builds them (applyOverrides with every removed chip at once), so a view and the
 * request for it always agree, keywords included.
 */
export function viewSpecs(parsed: ParsedQuery, without: readonly string[]): ViewSpec[] {
  const prices = removedPrices(parsed, without);
  const removed = removedRequirements(parsed, without);
  const kept = unique(
    parsed.requirements.map((r) => requirementChipId(r.en)).filter((id) => !removed.includes(id)),
  );
  return subsets(kept).flatMap((extra) => {
    const chips = [...removed, ...extra];
    const base = applyOverrides(parsed, [...prices, ...chips]);
    return SORTS.map((sort) => ({
      key: viewKeyOf(sort, chips),
      filters: { ...base, sort_preference: sort },
      removesMore: extra.length > 0,
    }));
  });
}

/** A ranked view and the products it shows. */
export interface RankedView {
  view: CachedView;
  products: AliProduct[];
}

/**
 * One view ranked over the whole pool, or null when it removes a requirement the fetch kept and
 * leaves fewer than a page (that request fetches again). `blockers` gives what kept the checked
 * products out of a view with fewer than a page. `shopCap` is the mode the fetch ranked under:
 * the pool is kept with a result set whose key holds that mode, so its views share it.
 */
export function rankView(
  pool: AliProduct[],
  spec: ViewSpec,
  kept: number,
  blockers: (pool: AliProduct[], filters: ParsedQuery, passed: number) => FilterBlocker[],
  shopCap: ShopCapMode,
): RankedView | null {
  const { ranked, looseIds } = rankForSearch(pool, spec.filters, shopCap);
  // "Y עברו" and the blockers count the vetted tiers: a less proven product is shown, not passed.
  const passed = ranked.length - looseIds.length;
  if (spec.removesMore && passed < RESULTS_PER_PAGE) return null;
  const shown = ranked.slice(0, kept);
  return {
    view: {
      ids: shown.map((p) => p.productId),
      passed,
      ...(passed < RESULTS_PER_PAGE ? { blockers: blockers(pool, spec.filters, passed) } : {}),
    },
    products: shown,
  };
}

/**
 * The pool of a result set: its views, and the products they show that `own` (the result set's
 * own products) does not hold. A product linked since it was fetched is kept linked: `linked`
 * holds the versions the search linked.
 */
export function poolFrom(
  views: Iterable<[string, RankedView]>,
  own: readonly AliProduct[],
  linked: readonly AliProduct[],
  lines: CachedPool["lines"],
): CachedPool {
  const ownIds = new Set(own.map((p) => p.productId));
  const latest = new Map(linked.map((p) => [p.productId, p]));
  const products = new Map<string, AliProduct>();
  const out: Record<string, CachedView> = {};
  for (const [key, ranked] of views) {
    out[key] = ranked.view;
    for (const p of ranked.products) {
      if (!ownIds.has(p.productId) && !products.has(p.productId)) {
        products.set(p.productId, latest.get(p.productId) ?? p);
      }
    }
  }
  return { views: out, products: [...products.values()], lines };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The entry's pool when it is well formed (stored jsonb is not trusted), else null. */
export function poolOf(entry: CachedResults | null): CachedPool | null {
  const pool: unknown = entry?.pool;
  if (!isObject(pool) || !isObject(pool.views) || !isObject(pool.lines)) return null;
  if (!Array.isArray(pool.products)) return null;
  return pool as unknown as CachedPool;
}

/** A view of the entry's pool with its products, or null when the pool lacks it or is damaged. */
export function poolView(
  entry: CachedResults,
  key: string,
): { view: CachedView; products: AliProduct[] } | null {
  const pool = poolOf(entry);
  const view: unknown = pool?.views[key];
  if (!pool || !isObject(view) || !Array.isArray(view.ids) || typeof view.passed !== "number") {
    return null;
  }
  const byId = new Map([...pool.products, ...entry.products].map((p) => [p.productId, p] as const));
  const products = (view.ids as unknown[]).map((id) =>
    typeof id === "string" ? byId.get(id) : undefined,
  );
  if (products.some((p) => p === undefined)) return null;
  return { view: view as unknown as CachedView, products: products as AliProduct[] };
}
