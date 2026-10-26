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
/**
 * Variety (owner request 2026-10-27: every run brought kids' clothing and charging cables): at most
 * this many candidates of one first-level category, and of one second-level category, per run. A
 * run the admin limited to one category keeps only the second-level cap.
 */
export const PER_CATEGORY = 2;
export const PER_SUBCATEGORY = 1;
/**
 * Quality (owner request 2026-10-27: "products many people buy and review"): above the site's trust
 * bar (FILTERS: 90% and 100 sales), a recommendation asks this much.
 */
export const QUALITY = { minPositiveFeedbackPct: 95, minUnitsSold: 300 };
/** Pages of one category's hot list an admin's category run scans. */
export const CATEGORY_RUN_PAGES = 6;

/**
 * Accessories and parts are not recommendations (owner request 2026-10-27). Read in the title
 * (hot lists come in Hebrew; English words are kept for titles that stay English).
 */
const ACCESSORY =
  /(כבל|כבלים|מטען|מטענים|מתאם|מפצל|כיסוי|כיסויים|נרתיק|מגן מסך|מגני מסך|זכוכית מגן|רצועה|רצועות|מחזיק|תושבת|מדבקה|מדבקות|חלק חילוף|חלקי חילוף|להחלפה|ראש החלפה|סוללה|סוללות|\bcable|\bcharger|\badapter|\bcase\b|\bcover\b|protector|tempered glass|\bstrap|\bholder|\bmount\b|sticker|replacement|spare part|\bbattery)/i;

/** True when the title names an accessory or a part (never recommended). */
export function isAccessory(title: string): boolean {
  return ACCESSORY.test(title);
}

export interface ScanTarget {
  /** The category id hotproduct.query is asked for (first-level, or a slice fetched directly). */
  categoryId: string;
  pageNo: number;
}

/**
 * The lists of an admin's run limited to one catalog category (owner request 2026-10-27): its
 * list, pages 1 to CATEGORY_RUN_PAGES. Empty for an unknown key.
 */
export function categoryTargets(key: string, catalog = CATALOG): ScanTarget[] {
  const c = catalog.find((x) => x.key === key);
  if (!c) return [];
  const categoryId = c.slice?.directFetch ? c.slice.subcategoryId : c.firstLevelId;
  return Array.from({ length: CATEGORY_RUN_PAGES }, (_, i) => ({ categoryId, pageNo: i + 1 }));
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
    (p.positiveFeedbackPct ?? 0) >= QUALITY.minPositiveFeedbackPct &&
    (p.unitsSold ?? 0) >= QUALITY.minUnitsSold &&
    !isAccessory(p.title) &&
    !inExcludedCategory(p) &&
    p.imageUrls.length > 0
  );
}

/**
 * The run's candidates (owner request 2026-10-27: varied, and the best products, not the best
 * paying): once per product, never one already proposed (`known`), the best-selling first, then
 * the higher feedback, the standard rate and the hot rate only breaking ties; at most PER_SHOP per
 * shop, PER_CATEGORY per first-level category (unless `oneCategory`) and PER_SUBCATEGORY per
 * second-level one; up to `max`.
 */
export function selectCandidates(
  products: readonly AliProduct[],
  known: ReadonlySet<string>,
  {
    max = MAX_CANDIDATES_PER_RUN,
    minStandard = MIN_STANDARD_PCT,
    oneCategory = false,
  }: { max?: number; minStandard?: number; oneCategory?: boolean } = {},
): AliProduct[] {
  const unique = [...new Map(products.map((p) => [p.productId, p])).values()];
  const ranked = unique
    .filter((p) => !known.has(p.productId) && isCandidate(p, minStandard))
    .sort(
      (a, b) =>
        (b.unitsSold ?? 0) - (a.unitsSold ?? 0) ||
        (b.positiveFeedbackPct ?? 0) - (a.positiveFeedbackPct ?? 0) ||
        (b.commissionRatePct ?? 0) - (a.commissionRatePct ?? 0) ||
        (b.hotCommissionRatePct ?? 0) - (a.hotCommissionRatePct ?? 0) ||
        a.productId.localeCompare(b.productId),
    );
  const counts = new Map<string, number>();
  const take = (key: string, cap: number) => (counts.get(key) ?? 0) < cap;
  const out: AliProduct[] = [];
  for (const p of ranked) {
    const shop = `shop:${p.shop.id ?? p.productId}`;
    const first = `cat:${p.category.firstId ?? "?"}`;
    const second = `sub:${p.category.secondId ?? p.productId}`;
    if (!take(shop, PER_SHOP) || !take(second, oneCategory ? 2 : PER_SUBCATEGORY)) continue;
    if (!oneCategory && !take(first, PER_CATEGORY)) continue;
    for (const k of [shop, first, second]) counts.set(k, (counts.get(k) ?? 0) + 1);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
