// The product finder's choices (owner requests 2026-10-19 and 10-23), pure: which hot lists a run
// scans and which of their products become candidates. Code decides; the model only writes posts.
//
// A candidate's STANDARD rate (commission_rate, the one Portals shows) is MIN_STANDARD_PCT or more,
// AND it passes FILTERS (the site's trust bar), has an ILS price, a link and a photo, is in no
// excluded category, and was never proposed before. The hot rate (hot_product_commission_rate of
// hotproduct.query, paid only through a type 2 hot link and UNCONFIRMED: on 2026-10-23 a USB hub
// listed 20% hot showed 3% in Portals) is only a bonus: shown to the owner, and it breaks ties.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { CATALOG } from "@/lib/catalog/categories";
import { inExcludedCategory } from "@/lib/hot/select";
import { trustTierOf } from "@/lib/ranking/rank";

/** The standard rate a candidate must pay (owner decision 2026-10-23; the average seen is 7%). */
export const MIN_STANDARD_PCT = 7;
/** A hot rate from this up is flagged to the owner as a possible bonus (unconfirmed). */
export const HOT_BONUS_PCT = 20;
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

/** A product that may be proposed: the standard rate and everything a hot list asks of one. */
export function isCandidate(p: AliProduct, minStandard = MIN_STANDARD_PCT): boolean {
  return (
    p.commissionRatePct !== null &&
    p.commissionRatePct >= minStandard &&
    p.currency === "ILS" &&
    Boolean(p.promotionLink) &&
    trustTierOf(p) === "standard" &&
    !inExcludedCategory(p) &&
    p.imageUrls.length > 0
  );
}

/**
 * The run's candidates: once per product, never one already proposed (`known`), at most PER_SHOP
 * per shop, the highest standard rate first, then the best-selling, then the higher hot rate, up
 * to `max`.
 */
export function selectCandidates(
  products: readonly AliProduct[],
  known: ReadonlySet<string>,
  { max = MAX_CANDIDATES_PER_RUN, minStandard = MIN_STANDARD_PCT } = {},
): AliProduct[] {
  const unique = [...new Map(products.map((p) => [p.productId, p])).values()];
  const ranked = unique
    .filter((p) => !known.has(p.productId) && isCandidate(p, minStandard))
    .sort(
      (a, b) =>
        (b.commissionRatePct ?? 0) - (a.commissionRatePct ?? 0) ||
        (b.unitsSold ?? 0) - (a.unitsSold ?? 0) ||
        (b.hotCommissionRatePct ?? 0) - (a.hotCommissionRatePct ?? 0) ||
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
