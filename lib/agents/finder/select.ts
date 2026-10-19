// The product finder's choices (owner request 2026-10-19), pure: which hot lists a run scans and
// which of their products become candidates. Code decides; the model only writes the posts.
//
// A candidate pays 20% or more (MIN_COMMISSION_PCT: the hot rate when AliExpress offers one, else
// the standard rate) AND passes FILTERS (the site's trust bar), has an ILS price and a link, is in
// no excluded category, and was never proposed before. Measured 2026-10-19: of 5,565 products seen
// in 30 days, 21 met both, all from hot lists (hot_product_commission_rate), none from searches; so
// the finder scans hot lists, rotating through the catalog's categories and pages.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { CATALOG } from "@/lib/catalog/categories";
import { inExcludedCategory } from "@/lib/hot/select";
import { trustTierOf } from "@/lib/ranking/rank";

export const MIN_COMMISSION_PCT = 20;
/** Candidates added per run at most (owner decision 2026-10-19). */
export const MAX_CANDIDATES_PER_RUN = 10;
/** hotproduct.query calls per run: about 10 s with AliExpress's spacing. */
export const SCAN_CALLS_PER_RUN = 8;
/** Pages of each hot list the rotation covers. */
export const SCAN_PAGES = 3;
/** At most this many candidates of one shop per run. */
export const PER_SHOP = 1;

export interface ScanTarget {
  /** The category id hotproduct.query is asked for (first-level, or a slice fetched directly). */
  categoryId: string;
  pageNo: number;
}

/** Every list the finder scans: each catalog category's own list, pages 1 to SCAN_PAGES. */
export function scanTargets(catalog = CATALOG): ScanTarget[] {
  const ids = [
    ...new Set(catalog.map((c) => (c.slice?.directFetch ? c.slice.subcategoryId : c.firstLevelId))),
  ];
  return Array.from({ length: SCAN_PAGES }, (_, i) => i + 1).flatMap((pageNo) =>
    ids.map((categoryId) => ({ categoryId, pageNo })),
  );
}

/**
 * The lists of run number `runIndex` (0-based): the next SCAN_CALLS_PER_RUN targets in turn, so
 * successive runs walk every category's page 1, then every page 2, and so on, and start again.
 */
export function targetsForRun(
  targets: readonly ScanTarget[],
  runIndex: number,
  perRun = SCAN_CALLS_PER_RUN,
): ScanTarget[] {
  if (!targets.length) return [];
  const start = (Math.max(0, Math.floor(runIndex)) * perRun) % targets.length;
  return Array.from({ length: Math.min(perRun, targets.length) }, (_, i) => {
    return targets[(start + i) % targets.length];
  });
}

/** The rate AliExpress pays us for this product: the hot rate when it offers one, else standard. */
export function commissionOf(
  p: Pick<AliProduct, "commissionRatePct" | "hotCommissionRatePct">,
): number | null {
  const rates = [p.commissionRatePct, p.hotCommissionRatePct ?? null].filter(
    (r): r is number => r !== null && Number.isFinite(r),
  );
  return rates.length ? Math.max(...rates) : null;
}

/** A product that may be proposed: high commission and everything a hot list asks of a product. */
export function isCandidate(p: AliProduct, minCommission = MIN_COMMISSION_PCT): boolean {
  const commission = commissionOf(p);
  return (
    commission !== null &&
    commission >= minCommission &&
    p.currency === "ILS" &&
    Boolean(p.promotionLink) &&
    trustTierOf(p) === "standard" &&
    !inExcludedCategory(p) &&
    p.imageUrls.length > 0
  );
}

/**
 * The run's candidates: once per product, never one already proposed (`known`), at most PER_SHOP
 * per shop, the best-selling first (sales prove the product; the rate only qualifies it), up to
 * `max`.
 */
export function selectCandidates(
  products: readonly AliProduct[],
  known: ReadonlySet<string>,
  { max = MAX_CANDIDATES_PER_RUN, minCommission = MIN_COMMISSION_PCT } = {},
): AliProduct[] {
  const unique = [...new Map(products.map((p) => [p.productId, p])).values()];
  const ranked = unique
    .filter((p) => !known.has(p.productId) && isCandidate(p, minCommission))
    .sort(
      (a, b) =>
        (b.unitsSold ?? 0) - (a.unitsSold ?? 0) ||
        (b.positiveFeedbackPct ?? 0) - (a.positiveFeedbackPct ?? 0) ||
        a.productId.localeCompare(b.productId),
    );
  const perShop = new Map<string, number>();
  const out: AliProduct[] = [];
  for (const p of ranked) {
    const shop = p.shop.id ?? `product:${p.productId}`;
    if ((perShop.get(shop) ?? 0) >= PER_SHOP) continue;
    perShop.set(shop, (perShop.get(shop) ?? 0) + 1);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
