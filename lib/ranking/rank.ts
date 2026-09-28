// Deterministic filter and rank (CLAUDE.md §6.5-6). Pure: no I/O, no LLM.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { SearchFilters, SortPreference } from "@/lib/search/filters";
import {
  CATEGORY_CONSISTENCY,
  FEEDBACK_PRIOR,
  FILL_TIER,
  FILTERS,
  PRICE_FIT,
  SMALL_CAPACITY_FACTOR,
  WEIGHTS,
  type ShopCapMode,
  type TrustThresholds,
} from "./config";
import { dedupeBy, diversifyShops } from "./diversity";
import {
  isCapacitySpec,
  parseSpec,
  requirementMatches,
  specValue,
  statedSpecValues,
  tokenize,
  type Spec,
} from "./match";
import { asksForSmall, coverageWords, relevance } from "./relevance";
import {
  feedbackForScore,
  findSharedNumbers,
  salesForScore,
  withSharedMark,
  type RankedProduct,
  type SharedNumbers,
} from "./shared-numbers";
import { isRequestedProduct } from "./type-gate";

export { dedupeListings, diversifyShops } from "./diversity";
export { isRequestedProduct, productMatch } from "./type-gate";
export { relevance } from "./relevance";
export {
  findSharedNumbers,
  hasSharedNumbers,
  sharedMarkOf,
  withoutSharedMark,
  type RankedProduct,
  type SharedMark,
} from "./shared-numbers";

export type RejectReason = "feedback" | "volume" | "currency" | "price" | "type" | "requirement";

/** The capacity each requirement asks for ("10000mah"), from its own phrase or an alternative. */
export function capacitySpecs(f: Pick<SearchFilters, "requirements">): Spec[] {
  return f.requirements.flatMap((r) => {
    const spec = [r.en, ...r.alt].map(parseSpec).find((s) => s !== null && isCapacitySpec(s));
    return spec ? [spec] : [];
  });
}

/**
 * A search for something "small" ("mini", "compact") with a capacity spec: the title must state
 * a capacity from the spec up to SMALL_CAPACITY_FACTOR times it. "At least" alone would let a
 * 20000mAh brick answer "a small 10000mAh power bank".
 */
function fitsSmallCapacity(title: string, f: SearchFilters): boolean {
  if (!asksForSmall(f)) return true;
  return capacitySpecs(f).every((spec) => {
    const need = specValue(spec);
    return statedSpecValues(title, spec).some(
      (v) => v >= need && v <= need * SMALL_CAPACITY_FACTOR,
    );
  });
}

/** The title states exactly the capacity asked for (a 10000mAh power bank for "10000mah"). */
function statesExactCapacity(title: string, specs: readonly Spec[]): boolean {
  return specs.every((spec) => statedSpecValues(title, spec).includes(specValue(spec)));
}

/** Missing trust data fails (never treated as good); prices are never compared across currencies. */
export function passesFilters(
  p: AliProduct,
  f: SearchFilters,
  trust: TrustThresholds = FILTERS,
): boolean {
  return rejectReason(p, f, trust) === null;
}

/** First filter each product fails, or null when it passes. */
export function rejectReason(
  p: AliProduct,
  f: SearchFilters,
  trust: TrustThresholds = FILTERS,
): RejectReason | null {
  if (p.positiveFeedbackPct === null || p.positiveFeedbackPct < trust.minPositiveFeedbackPct) {
    return "feedback";
  }
  if (p.unitsSold === null || p.unitsSold < trust.minUnitsSold) return "volume";
  if (p.currency !== "ILS") return "currency";
  if (f.min_price_ils !== undefined && p.price < f.min_price_ils) return "price";
  if (f.max_price_ils !== undefined && p.price > f.max_price_ils) return "price";
  if (!isRequestedProduct(p.title, f)) return "type";
  if (!f.requirements.every((r) => requirementMatches(p.title, r))) return "requirement";
  if (!fitsSmallCapacity(p.title, f)) return "requirement";
  return null;
}

/** How many products each filter removed. Drives the "no results" hint in the UI. */
export function rejectionCounts(
  products: AliProduct[],
  f: SearchFilters,
): Record<RejectReason, number> {
  const counts: Record<RejectReason, number> = {
    feedback: 0,
    volume: 0,
    currency: 0,
    price: 0,
    type: 0,
    requirement: 0,
  };
  for (const p of products) {
    const r = rejectReason(p, f);
    if (r) counts[r]++;
  }
  return counts;
}

/** Positive feedback with small-sample ratings above FEEDBACK_PRIOR.pct pulled down toward it. */
export function effectiveFeedbackPct(p: AliProduct): number {
  const pct = p.positiveFeedbackPct ?? 0;
  if (pct <= FEEDBACK_PRIOR.pct) return pct;
  const n = p.unitsSold ?? 0;
  return (pct * n + FEEDBACK_PRIOR.pct * FEEDBACK_PRIOR.sales) / (n + FEEDBACK_PRIOR.sales);
}

/** Linear-interpolated percentile of ascending values. */
function percentile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Price scale for scoring: from the PRICE_FIT.floorPercentile price to the most expensive. */
export function priceRange(prices: number[]): { min: number; max: number } {
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    min: percentile(sorted, PRICE_FIT.floorPercentile),
    max: sorted[sorted.length - 1],
  };
}

export interface ScoreContext {
  filters: SearchFilters;
  priceRange: { min: number; max: number };
  /** Search words for relevance (coverageWords of the filters). */
  words: readonly string[];
  /** Shops of the candidate pool that share numbers (lib/ranking/shared-numbers.ts). */
  shared: SharedNumbers;
}

/**
 * `shared` comes from the whole candidate pool when the caller has it (rankWithFill does): more
 * listings of a shop show more of what it repeats. By default, from the passers.
 */
export function scoreContext(
  filters: SearchFilters,
  passed: AliProduct[],
  shared: SharedNumbers = findSharedNumbers(passed),
): ScoreContext {
  return {
    filters,
    priceRange: priceRange(passed.map((p) => p.price)),
    words: coverageWords(filters),
    shared,
  };
}

/**
 * Trust (feedback, volume), price fit and relevance. Within a maximum price the shopper stated,
 * every price fits fully: being cheaper than the budget is no merit (owner decision, item 6). The
 * discount is shown, never scored. A shop that shares numbers gets no feedback above the prior,
 * and a sales number several of its listings share counts once (shared-numbers.ts).
 */
export function score(p: AliProduct, ctx: ScoreContext): number {
  const { filters } = ctx;
  // 90% → 0, 100% → 1
  const pct = feedbackForScore(p, effectiveFeedbackPct(p), ctx.shared);
  const feedback = Math.max(0, (pct - FILTERS.minPositiveFeedbackPct) / 10);
  // 100 sales → 0.5, 10,000 → 1, capped so huge sellers don't drown everything else
  const volume = Math.min(1.25, Math.log10(Math.max(1, salesForScore(p, ctx.shared))) / 4);
  const { min, max } = ctx.priceRange;
  const withinBudget = filters.max_price_ils !== undefined;
  // At or below the floor price → 1, most expensive → 0
  const priceFit =
    withinBudget || max <= min ? 1 : Math.min(1, Math.max(0, (max - p.price) / (max - min)));

  const w = WEIGHTS;
  return (
    feedback * w.feedback +
    volume * (filters.sort_preference === "most_popular" ? w.volumeMostPopular : w.volume) +
    priceFit * w.priceFit +
    relevance(p.title, filters, ctx.words) * w.relevance
  );
}

type CategoryRef = Pick<AliProduct, "productId" | "category">;

/**
 * Passers from another first-level category than most (item 2): when at least
 * CATEGORY_CONSISTENCY.minMembers passers, and at least minShare of those with a category, share
 * a first-level category, the ids of passers from any other one. ("Car Under Seat Storage Box
 * ... Drawer Organizer" among home storage organizers.) Empty when no category is that common.
 */
export function categoryOutliers(passers: readonly CategoryRef[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of passers) {
    const id = p.category.firstId;
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const known = [...counts.values()].reduce((s, n) => s + n, 0);
  const [mode, members] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0] ?? ["", 0];
  const { minMembers, minShare } = CATEGORY_CONSISTENCY;
  if (members < minMembers || members < known * minShare) return new Set();
  return new Set(
    passers
      .filter((p) => p.category.firstId !== null && p.category.firstId !== mode)
      .map((p) => p.productId),
  );
}

/** A passer with what orders it. */
interface Ranked {
  p: RankedProduct;
  score: number;
  /** 30-day sales as the score counts them (salesForScore): a shared number counts once. */
  sales: number;
  /** From another category than most passers (categoryOutliers): after all the others. */
  outlier: boolean;
  /** States the exact capacity asked for (or none was): before a bigger one. */
  exactCapacity: boolean;
}

/**
 * Category outliers last (the default sort only: "cheapest" and "most_popular" order every passer
 * by what their button says), then an exact capacity before a bigger one; then "cheapest" by
 * price, "most_popular" by 30-day sales (a number several listings of one shop share counts once),
 * and the score. Commission only breaks exact ties, and product id keeps the order deterministic
 * after that: a worse product never ranks higher because it pays more.
 */
function byRank(sort: SortPreference) {
  const byCategory = sort === "best_value";
  return (a: Ranked, b: Ranked) =>
    (byCategory ? Number(a.outlier) - Number(b.outlier) : 0) ||
    Number(b.exactCapacity) - Number(a.exactCapacity) ||
    (sort === "cheapest" ? a.p.price - b.p.price : 0) ||
    (sort === "most_popular" ? b.sales - a.sales : 0) ||
    b.score - a.score ||
    (b.p.commissionRatePct ?? 0) - (a.p.commissionRatePct ?? 0) ||
    a.p.productId.localeCompare(b.p.productId);
}

/** The shopper's own words, which never make a model token (see dedupeListings). */
function searchedTokens(filters: SearchFilters): Set<string> {
  const searched = [
    filters.keywords_en,
    ...filters.product_terms,
    ...filters.requirements.flatMap((r) => [r.en, ...r.alt]),
  ];
  return new Set(tokenize(searched.join(" ")));
}

/**
 * `shared` is what the whole candidate pool says about shared numbers (findSharedNumbers): the
 * passers of a shop that shares numbers are scored by it and marked `sharedNumbers`.
 */
function rankEntries(
  products: AliProduct[],
  filters: SearchFilters,
  trust: TrustThresholds,
  shared: SharedNumbers,
): Ranked[] {
  const passed = products.filter((p) => passesFilters(p, filters, trust));
  if (!passed.length) return [];
  const ctx = scoreContext(filters, passed, shared);
  const outliers = categoryOutliers(passed);
  const specs = capacitySpecs(filters);
  const entries = passed.map((p): Ranked => ({
    p: withSharedMark(p, shared),
    score: score(p, ctx),
    sales: salesForScore(p, shared),
    outlier: outliers.has(p.productId),
    exactCapacity: statesExactCapacity(p.title, specs),
  }));
  entries.sort(byRank(filters.sort_preference));
  return dedupeBy(entries, (e) => e.p, searchedTokens(filters));
}

/**
 * Filters, ranks and removes duplicate listings (see byRank for the order). The shop cap is
 * applied by rankWithFill, which makes the list that is shown. Products of a shop that shares
 * numbers in `products` come back marked (RankedProduct.sharedNumbers).
 */
export function rankProducts(
  products: AliProduct[],
  filters: SearchFilters,
  trust: TrustThresholds = FILTERS,
): RankedProduct[] {
  return rankEntries(products, filters, trust, findSharedNumbers(products)).map((e) => e.p);
}

export type TrustTier = "standard" | "fill";

/** Which trust thresholds a product meets, standard first. Null when it meets neither. */
export function trustTierOf(
  p: Pick<AliProduct, "positiveFeedbackPct" | "unitsSold">,
): TrustTier | null {
  const meets = (t: TrustThresholds) =>
    p.positiveFeedbackPct !== null &&
    p.positiveFeedbackPct >= t.minPositiveFeedbackPct &&
    p.unitsSold !== null &&
    p.unitsSold >= t.minUnitsSold;
  if (meets(FILTERS)) return "standard";
  if (meets(FILL_TIER)) return "fill";
  return null;
}

/**
 * The list a search shows: standard ranking, topped up to `target` results from FILL_TIER only
 * when too few products meet FILTERS, then the shop cap of `shopCap` over pages of `target`
 * (diversifyShops; the admin's setting, lib/settings). Standard products come first, except that
 * "cheapest" orders the whole list by price, fill products included; every other gate (price,
 * type, requirements) applies to both tiers unchanged. Shared numbers are judged over every
 * product checked (`products`), and the products of a shop that shares them come back marked
 * (RankedProduct.sharedNumbers): the card notes it, and the explain step leaves their sales out
 * (lib/llm/explain.ts). The shop cap only reorders, so the list's length is the same in every mode.
 */
export function rankWithFill(
  products: AliProduct[],
  filters: SearchFilters,
  target: number,
  shopCap: ShopCapMode,
): { ranked: RankedProduct[]; fillIds: string[] } {
  const shared = findSharedNumbers(products);
  const standard = rankEntries(products, filters, FILTERS, shared);
  let merged = standard;
  let fillIds: string[] = [];
  if (standard.length < target) {
    const taken = new Set(standard.map((e) => e.p.productId));
    const extra = rankEntries(products, filters, FILL_TIER, shared).filter(
      (e) => !taken.has(e.p.productId),
    );
    // Dedupe across tiers too, keeping the standard listing when two are the same product.
    const all = dedupeBy([...standard, ...extra], (e) => e.p, searchedTokens(filters));
    const fill = all.filter((e) => !taken.has(e.p.productId)).slice(0, target - standard.length);
    merged = [...standard, ...fill];
    fillIds = fill.map((e) => e.p.productId);
  }
  if (filters.sort_preference === "cheapest") merged = [...merged].sort(byRank("cheapest"));
  return {
    ranked: diversifyShops(
      merged.map((e) => e.p),
      target,
      shopCap,
    ),
    fillIds,
  };
}
