// Numbers one shop shows on many listings (owner decision 2026-09-28): a store whose listings share
// identical numbers is trusted less by a general rule, never blocked. One shop's 30-day sales came
// back as exactly 11,268 for two different listings (productdetail.get), and it shows exactly 98.0%
// positive feedback on nearly all of them: such a number describes the shop or a group of
// listings, not the product on the card. The score gives every listing of such a shop no weight
// its numbers have not earned. Each card keeps AliExpress's numbers (they are what AliExpress
// says) and says which of them other listings of its shop show too; no line states such a number
// as the product's own, and no line of a batch that holds one of the shop's listings calls a
// product the best-selling or best-rated one. Pure: no I/O.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { SharedNumbersMark } from "@/lib/types";
import { FEEDBACK_PRIOR, SHARED_NUMBERS } from "./config";

/**
 * On every product of a shop that shares numbers in the pool: which of the product's own numbers
 * other listings of its shop in the pool show too (`feedback`: the value the shop shows on most of
 * its listings; `sales`: exactly the sales of another listing). Both false for a listing whose
 * numbers are its own although its shop repeats others.
 */
export type SharedMark = SharedNumbersMark;

/** A product as the ranking returns it: marked when its shop's numbers are shared in the pool. */
export type RankedProduct = AliProduct & { sharedNumbers?: SharedMark };

/**
 * The product's mark (also on products read back from the results cache, whose jsonb is not
 * trusted), or null when its shop shares no numbers in the pool it was ranked in.
 */
export function sharedMarkOf(p: AliProduct): SharedMark | null {
  const mark: unknown = (p as RankedProduct).sharedNumbers;
  if (typeof mark !== "object" || mark === null) return null;
  const { feedback, sales } = mark as Partial<SharedMark>;
  return { feedback: feedback === true, sales: sales === true };
}

/** True when the ranking marked the product: its shop shares numbers in the pool. */
export function hasSharedNumbers(p: AliProduct): boolean {
  return sharedMarkOf(p) !== null;
}

/** What one pool says about shared numbers (findSharedNumbers). */
export interface SharedNumbers {
  /** Shops with shared numbers in the pool. */
  shops: ReadonlySet<string>;
  /**
   * Product id → how many listings of its shop in the pool show its exact 30-day sales, for the
   * products whose sales (SHARED_NUMBERS.salesMin or more) two or more listings share.
   */
  salesSharedBy: ReadonlyMap<string, number>;
  /** Shop id → the feedback value it shows on most of its listings (the feedback rule). */
  feedbackOf: ReadonlyMap<string, number>;
}

export const NO_SHARED_NUMBERS: SharedNumbers = {
  shops: new Set(),
  salesSharedBy: new Map(),
  feedbackOf: new Map(),
};

/** The feedback value below 100% that the most listings show, and how many show it. */
function mostCommonFeedback(listings: readonly AliProduct[]): { pct: number; count: number } {
  const counts = new Map<number, number>();
  for (const p of listings) {
    const pct = p.positiveFeedbackPct;
    if (pct !== null && pct < 100) counts.set(pct, (counts.get(pct) ?? 0) + 1);
  }
  let best = { pct: 0, count: 0 };
  for (const [pct, count] of counts) {
    if (count > best.count || (count === best.count && pct < best.pct)) best = { pct, count };
  }
  return best;
}

/**
 * The shops whose listings in `pool` share numbers (SHARED_NUMBERS): two listings with the same
 * 30-day sales of at least salesMin, or at least feedbackMinListings listings with a feedback value
 * of which at least feedbackShare show the same one below 100%. Every product of such a shop is
 * scored as such, not only the ones that repeat a number: the number another listing repeats may
 * be any of them. A product without a shop id is never matched with another.
 */
export function findSharedNumbers(pool: readonly AliProduct[]): SharedNumbers {
  const byShop = new Map<string, AliProduct[]>();
  const seen = new Set<string>();
  for (const p of pool) {
    if (p.shop.id === null || seen.has(p.productId)) continue;
    seen.add(p.productId);
    const listings = byShop.get(p.shop.id);
    if (listings) listings.push(p);
    else byShop.set(p.shop.id, [p]);
  }
  const shops = new Set<string>();
  const salesSharedBy = new Map<string, number>();
  const feedbackOf = new Map<string, number>();
  const { salesMin, feedbackMinListings, feedbackShare } = SHARED_NUMBERS;
  for (const [shop, listings] of byShop) {
    const bySales = new Map<number, string[]>();
    for (const p of listings) {
      if (p.unitsSold === null || p.unitsSold < salesMin) continue;
      const ids = bySales.get(p.unitsSold);
      if (ids) ids.push(p.productId);
      else bySales.set(p.unitsSold, [p.productId]);
    }
    for (const ids of bySales.values()) {
      if (ids.length < 2) continue;
      shops.add(shop);
      for (const id of ids) salesSharedBy.set(id, ids.length);
    }
    const rated = listings.filter((p) => p.positiveFeedbackPct !== null).length;
    const common = mostCommonFeedback(listings);
    if (rated >= feedbackMinListings && common.count >= rated * feedbackShare) {
      shops.add(shop);
      feedbackOf.set(shop, common.pct);
    }
  }
  return { shops, salesSharedBy, feedbackOf };
}

/** The product's shop shares numbers in the pool. */
export function sharesNumbers(p: AliProduct, shared: SharedNumbers): boolean {
  return p.shop.id !== null && shared.shops.has(p.shop.id);
}

/** The mark this pool gives the product, or null when its shop shares no numbers in it. */
export function markIn(p: AliProduct, shared: SharedNumbers): SharedMark | null {
  if (!sharesNumbers(p, shared)) return null;
  const repeated = shared.feedbackOf.get(p.shop.id!);
  return {
    feedback: repeated !== undefined && p.positiveFeedbackPct === repeated,
    sales: shared.salesSharedBy.has(p.productId),
  };
}

const sameMark = (a: SharedMark, b: SharedMark | null) =>
  b !== null && a.feedback === b.feedback && a.sales === b.sales;

/**
 * The product marked as this pool says: a copy with `sharedNumbers` when its shop shares numbers,
 * without it otherwise (also when it carries a mark from another pool, e.g. read back from a
 * cache); the product itself when nothing changes. Never mutates the input.
 */
export function withSharedMark(p: AliProduct, shared: SharedNumbers): RankedProduct {
  const mark = markIn(p, shared);
  const current = (p as RankedProduct).sharedNumbers;
  if (mark === null ? current === undefined : sameMark(mark, sharedMarkOf(p))) return p;
  return mark ? { ...p, sharedNumbers: mark } : { ...p, sharedNumbers: undefined };
}

/** The product without any mark: what is stored as the product itself (products.data). */
export function withoutSharedMark<P extends AliProduct>(p: P): P {
  if (!("sharedNumbers" in p)) return p;
  const copy: P & { sharedNumbers?: unknown } = { ...p };
  delete copy.sharedNumbers;
  return copy;
}

/**
 * Positive feedback for scoring: `pct` (already shrunk for small samples), but never above
 * FEEDBACK_PRIOR.pct for a shop that shares numbers, whose rating is not the product's own. A
 * rating below the prior is never lifted.
 */
export function feedbackForScore(p: AliProduct, pct: number, shared: SharedNumbers): number {
  return sharesNumbers(p, shared) ? Math.min(pct, FEEDBACK_PRIOR.pct) : pct;
}

/**
 * 30-day sales for scoring and for the "most popular" order: a number k listings of one shop share
 * counts once, split between them (11,268 on two listings counts 5,634 for each). Filters still
 * read AliExpress's number: a shared number never blocks a product.
 */
export function salesForScore(p: AliProduct, shared: SharedNumbers): number {
  const sold = p.unitsSold ?? 0;
  return sold / (shared.salesSharedBy.get(p.productId) ?? 1);
}
