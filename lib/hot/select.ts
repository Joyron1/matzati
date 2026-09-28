// Which of AliExpress's hot products we show, and how /hot filters and sorts them. Pure.
// Rules from the probe of 2026-09-28 (docs/aliexpress-api.md, Hot products):
// - every product passes FILTERS (lib/ranking/config.ts) with ILS prices; missing values fail
// - the API order is only banded by sales, so we sort by lastest_volume ourselves
// - HE titles are AliExpress's machine translation. They are shown unchanged, so the ranking's
//   near-duplicate check (dedupeListings) cannot run: it tokenizes [a-z0-9] only. Duplicates are
//   dropped by product id, and one shop may fill at most PER_SHOP places instead
// - a mix of several categories' lists (home carousel) keeps at most PER_SUBCATEGORY products
//   per second-level category, so one kind of product cannot fill it
import type { AliPromoCode } from "@/lib/aliexpress/promo-code";
import { isPromoCodeCurrent } from "@/lib/aliexpress/promo-code";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { FILTERS } from "@/lib/ranking/config";
import { trustTierOf } from "@/lib/ranking/rank";

export interface HotProduct {
  productId: string;
  /** AliExpress's Hebrew title (machine-translated), unchanged. */
  title: string;
  imageUrl: string;
  /** target_sale_price in ₪, as AliExpress sent it. */
  price: number;
  originalPrice: number | null;
  discountPct: number | null;
  positiveFeedbackPct: number;
  /** lastest_volume: sales in the last 30 days. */
  unitsSold: number;
  hasVideo: boolean;
  /** Its AliExpress promo code; shown or filtered on only while valid (isPromoCodeCurrent). */
  promoCode: AliPromoCode | null;
  categoryId: string | null;
  subcategoryId: string | null;
  shopId: string | null;
}

/** One shop may fill at most this many places in a list. */
export const PER_SHOP = 2;
/** The carousel keeps at most this many products per second-level category. */
export const PER_SUBCATEGORY = 2;
/** /hot without a category shows this many of each mixed category's best sellers. */
export const MIX_PER_CATEGORY = 12;

/**
 * Never shown, at either category level: adult and vaping products, AliExpress test and
 * non-product categories, and second-hand goods. Ids from fixtures/aliexpress (category.get).
 */
const EXCLUDED_CATEGORIES = new Set([
  "200001508", // Sex Products (under Beauty & Health)
  "200003561", // Electronic Cigarettes (under Consumer Electronics)
  "201169612", // Virtual Products
  "200001075", // Special Category
  "127698009", // Test category 06
  "202192001", // newlv1categorytest
  "201520802", // Second-Hand
]);

/** Passes FILTERS with an ILS price, has an affiliate link, and is in no excluded category. */
function isShowable(p: AliProduct): boolean {
  const { firstId, secondId } = p.category;
  return (
    p.currency === "ILS" &&
    trustTierOf(p) === "standard" &&
    Boolean(p.promotionLink) &&
    !(firstId && EXCLUDED_CATEGORIES.has(firstId)) &&
    !(secondId && EXCLUDED_CATEGORIES.has(secondId))
  );
}

/** More 30-day sales first, then higher feedback; the id keeps the order stable. */
function bySales(
  a: Pick<AliProduct, "unitsSold" | "positiveFeedbackPct" | "productId">,
  b: typeof a,
): number {
  return (
    (b.unitsSold ?? 0) - (a.unitsSold ?? 0) ||
    (b.positiveFeedbackPct ?? 0) - (a.positiveFeedbackPct ?? 0) ||
    a.productId.localeCompare(b.productId)
  );
}

/** True while `key` (null: no key, never capped) has fewer than `max` places. */
const under = (counts: Map<string, number>, key: string | null, max: number) =>
  key === null || (counts.get(key) ?? 0) < max;

const bump = (counts: Map<string, number>, key: string | null) => {
  if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
};

/**
 * FILTERS again, on a cached list: it was selected when it was fetched, possibly under other
 * thresholds, and every product shown must pass the ones the page states (lib/hot/copy.ts).
 */
export function passingFilters(
  products: HotProduct[],
  filters: Pick<typeof FILTERS, "minPositiveFeedbackPct" | "minUnitsSold"> = FILTERS,
): HotProduct[] {
  return products.filter(
    (p) =>
      p.positiveFeedbackPct >= filters.minPositiveFeedbackPct &&
      p.unitsSold >= filters.minUnitsSold,
  );
}

/** The products of one hotproduct.query response we show, by 30-day sales. */
export function selectHotProducts(products: AliProduct[]): AliProduct[] {
  const seen = new Set<string>();
  const shops = new Map<string, number>();
  const kept: AliProduct[] = [];
  for (const p of products.filter(isShowable).sort(bySales)) {
    if (seen.has(p.productId) || !under(shops, p.shop.id, PER_SHOP)) continue;
    seen.add(p.productId);
    bump(shops, p.shop.id);
    kept.push(p);
  }
  return kept;
}

/**
 * The home carousel: the categories' lists (each by 30-day sales) taken in turn, one product at a
 * time, skipping a product whose second-level category already has PER_SUBCATEGORY places, until
 * `limit`. A product in two lists is shown once.
 */
export function interleaveHotProducts(lists: HotProduct[][], limit: number): HotProduct[] {
  const seen = new Set<string>();
  const groups = new Map<string, number>();
  const next = lists.map(() => 0);
  const out: HotProduct[] = [];
  let added = true;
  while (out.length < limit && added) {
    added = false;
    for (let i = 0; i < lists.length && out.length < limit; i++) {
      while (next[i] < lists[i].length) {
        const p = lists[i][next[i]++];
        const group = p.subcategoryId ?? p.categoryId;
        if (seen.has(p.productId) || !under(groups, group, PER_SUBCATEGORY)) continue;
        seen.add(p.productId);
        bump(groups, group);
        out.push(p);
        added = true;
        break;
      }
    }
  }
  return out;
}

/** /hot without a category: the first MIX_PER_CATEGORY of each list, once each. */
export function mixHotProducts(lists: HotProduct[][]): HotProduct[] {
  const byId = new Map<string, HotProduct>();
  for (const list of lists) {
    for (const p of list.slice(0, MIX_PER_CATEGORY))
      if (!byId.has(p.productId)) byId.set(p.productId, p);
  }
  return [...byId.values()];
}

/** What the cards, filters and cache need; the full product is saved to the products table. */
export function toHotProduct(p: AliProduct): HotProduct {
  return {
    productId: p.productId,
    title: p.title,
    imageUrl: p.mainImageUrl,
    price: p.price,
    originalPrice: p.originalPrice,
    discountPct: p.discountPct,
    // isShowable guarantees both; the fallbacks only satisfy the types.
    positiveFeedbackPct: p.positiveFeedbackPct ?? 0,
    unitsSold: p.unitsSold ?? 0,
    hasVideo: Boolean(p.videoUrl),
    promoCode: p.promoCode ?? null,
    categoryId: p.category.firstId,
    subcategoryId: p.category.secondId,
    shopId: p.shop.id,
  };
}

// ---------------------------------------------------------------- /hot filters

export const HOT_SORTS = ["sales", "discount", "price_asc", "price_desc"] as const;
export type HotSort = (typeof HOT_SORTS)[number];

// Not "הכי נמכרים": the list is AliExpress's affiliate hot list, not its best sellers; we only order
// what passed our filters by 30-day sales.
export const HOT_SORT_LABELS: Record<HotSort, string> = {
  sales: "מספר מכירות",
  discount: "הנחה גבוהה",
  price_asc: "מחיר נמוך",
  price_desc: "מחיר גבוה",
};

/** Price presets in ₪: above `min` (exclusive) up to `max` (inclusive). */
export const PRICE_BANDS = {
  "under-50": { min: null, max: 50, label: "עד ₪50" },
  "50-100": { min: 50, max: 100, label: "₪50 עד ₪100" },
  "100-200": { min: 100, max: 200, label: "₪100 עד ₪200" },
  "over-200": { min: 200, max: null, label: "מעל ₪200" },
} as const satisfies Record<string, { min: number | null; max: number | null; label: string }>;
export type PriceBand = keyof typeof PRICE_BANDS;
export const PRICE_BAND_IDS = Object.keys(PRICE_BANDS) as PriceBand[];

export interface HotView {
  price?: PriceBand;
  sort: HotSort;
  /** Only products with an AliExpress promo code valid now. */
  withCode: boolean;
  /** Only products with an AliExpress video. */
  withVideo: boolean;
}

export function hasCurrentCode(p: HotProduct, now: Date): boolean {
  return p.promoCode !== null && isPromoCodeCurrent(p.promoCode, now);
}

function inBand(price: number, band: PriceBand): boolean {
  const { min, max } = PRICE_BANDS[band];
  return (min === null || price > min) && (max === null || price <= max);
}

const COMPARE: Record<HotSort, (a: HotProduct, b: HotProduct) => number> = {
  sales: bySales,
  discount: (a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0) || bySales(a, b),
  price_asc: (a, b) => a.price - b.price || bySales(a, b),
  price_desc: (a, b) => b.price - a.price || bySales(a, b),
};

/** The cached list, filtered and sorted for /hot. No API call: everything happens on the list. */
export function viewHotProducts(products: HotProduct[], view: HotView, now: Date): HotProduct[] {
  return products
    .filter(
      (p) =>
        (view.price === undefined || inBand(p.price, view.price)) &&
        (!view.withCode || hasCurrentCode(p, now)) &&
        (!view.withVideo || p.hasVideo),
    )
    .sort(COMPARE[view.sort]);
}
