// Filter thresholds and ranking weights (CLAUDE.md §6.5-6). Defaults are to be tuned against
// real data. The UI reads FILTERS too, so the numbers we show always match the numbers we use.
import { RESULTS_FIRST_VIEW, RESULTS_KEPT, RESULTS_PER_PAGE } from "@/lib/config/site";

export interface TrustThresholds {
  minPositiveFeedbackPct: number;
  minUnitsSold: number;
}

export const FILTERS: TrustThresholds = {
  minPositiveFeedbackPct: 90,
  minUnitsSold: 100,
};

/**
 * Second tier (owner decision 2026-09-27), used only to fill up to FILL_UP_TO results when too few
 * meet FILTERS. Niche products (licensed toys, party items for one character) are fragmented
 * across many small sellers with fewer than 100 sales a month; a higher feedback bar keeps them
 * trustworthy. The UI states the thresholds a product actually met; it does not label these
 * products. Owner decision 2026-09-30: 93% and 20 sales (was 95% and 30; a Sonic birthday search
 * showed 5 products, all from this tier, and rejected 50 on feedback).
 */
export const FILL_TIER: TrustThresholds = {
  minPositiveFeedbackPct: 93,
  minUnitsSold: 20,
};

/**
 * How many results FILL_TIER tops a search up to: the first view (RESULTS_FIRST_VIEW, 10; owner
 * decision 2026-09-30, it was one page of 5). An SEO page's refresh keeps its own one page
 * (lib/search/seo-run.ts), so its stored results are ranked as before.
 */
export const FILL_UP_TO = RESULTS_FIRST_VIEW;

/**
 * Score weights. The discount is shown on the card but never scored: almost every listing claims
 * 50-53% off an inflated "original" price (docs/search-quality-plan.md, item 6).
 */
export const WEIGHTS = {
  feedback: 2,
  volume: 1.5,
  priceFit: 0.5,
  /** Volume weight when the user asked for popular products (they are ordered by sales first). */
  volumeMostPopular: 3,
  /**
   * How plainly the title names the searched product (lib/ranking/relevance.ts). Measured on the
   * snapshots (npm run eval:offline, 2026-09-28): at 2 a well-sold weak or wrong listing still led
   * or reached the first page in two queries; 3 fixed both, and 4 changed nothing more.
   */
  relevance: 3,
  /**
   * A stated preference the title says (SearchFilters.preferences: "Number 3" or "3rd Birthday"
   * for "יום הולדת 3"), times the share of the search's preferences it says (owner request
   * 2026-09-30). 1 is 5 points of positive feedback, or about 4.6 times the sales: enough to move a
   * "Number 3" balloon (97.8%, 43 sales) above a comparable one that names "birthday balloons" word
   * for word (100%, 90 sales; relevance's primary-term part alone is worth 0.6), and never enough
   * to lift a clearly less trusted one (91% on 150 sales against 99% on thousands) or a product of
   * the second trust tier above the first (rank.test.ts, "a preference the title states").
   */
  preference: 1,
} as const;

/**
 * Parts of relevance, summing to 1: where the product term starts in the title, whether it is the
 * title's subject (not made for an unsearched object: "Car ...", "... for Tesla"), the share of
 * the search words the title contains, and whether it names the product by the first product
 * term's own words.
 */
export const RELEVANCE = {
  termPosition: 0.3,
  subject: 0.2,
  coverage: 0.3,
  primaryTerm: 0.2,
  /** A product term starting at or before this word index counts as the title's head. */
  headWords: 2,
} as const;

/**
 * Category consistency (item 2): when at least `minMembers` passers, and at least `minShare` of
 * those with a category, share a first-level category, a passer from another one is moved after
 * all the others. Never removed: category names are noisy (a USB cable filed under Security &
 * Protection). Measured on the snapshots (2026-09-28): at a share of 1/2 the rule moved 91 good
 * products down against 72 weak or wrong ones; at 2/3 it moves 26 good against 24, and those 24
 * include wrong products in five queries (a car tray among drawer organizers, tool sets among
 * kitchen gifts). Over the pools the live fetch policy checks it marks mostly good passers (16 good,
 * 3 weak or wrong), but it is what keeps the caulking tool set out of the gift-cook top 3 (without
 * it: 3 wrong cards in the top 3 instead of 1, nothing else changes). The default sort only: the
 * "cheapest" and "most popular" buttons order by price and sales alone (rank.ts byRank).
 */
export const CATEGORY_CONSISTENCY = { minMembers: 3, minShare: 2 / 3 } as const;

/**
 * How many products of one shop a result list may show (owner decision 2026-09-28: an admin
 * setting, /admin/settings, read by lib/settings): "none" puts no limit on a shop (near-duplicate
 * listings are still removed, dedupeBy in ./diversity.ts); "max2" allows at most 2 of one shop on
 * the first page and the same share of the kept list (SHOP_CAPS). The ranking takes the mode as an
 * input, and the results cache key holds it (lib/search/cache-key.ts), so a list ranked under one
 * mode is never served under the other.
 */
export const SHOP_CAP_MODES = ["none", "max2"] as const;
export type ShopCapMode = (typeof SHOP_CAP_MODES)[number];

/** The mode until the admin chooses one, and whenever the setting cannot be read. */
export const DEFAULT_SHOP_CAP_MODE: ShopCapMode = "none";

export const isShopCapMode = (value: unknown): value is ShopCapMode =>
  (SHOP_CAP_MODES as readonly unknown[]).includes(value);

/**
 * One shop's share of a result list: at most `firstPage` products per shop in the first page and
 * `kept` in the first `keptSize` (RESULTS_KEPT), unless no other shop has a product left.
 */
export interface ShopCap {
  firstPage: number;
  kept: number;
  keptSize: number;
}

const MAX2_FIRST_PAGE = 2;

/** "max2": 2 of the first page (RESULTS_PER_PAGE), and the same share of RESULTS_KEPT (8 of 20). */
export const MAX2_SHOP_CAP: ShopCap = {
  firstPage: MAX2_FIRST_PAGE,
  kept: Math.round((MAX2_FIRST_PAGE * RESULTS_KEPT) / RESULTS_PER_PAGE),
  keptSize: RESULTS_KEPT,
};

/** The cap of each mode; null for no limit. */
export const SHOP_CAPS: Readonly<Record<ShopCapMode, ShopCap | null>> = {
  none: null,
  max2: MAX2_SHOP_CAP,
};

/** "small", "mini": a capacity spec ("10000mah") then allows at most this multiple of it. */
export const SMALL_CAPACITY_FACTOR = 1.5;

/**
 * Ratings above `pct` count as if the listing also had `sales` extra sales at `pct`, so 100% on
 * 300 sales does not outrank 98% on 4,000. Ratings at or below `pct` are never lifted.
 */
export const FEEDBACK_PRIOR = { pct: 98, sales: 500 } as const;

/**
 * Shared numbers (owner decision 2026-09-28: a store whose listings share identical numbers is
 * trusted less by a general rule, never blocked; lib/ranking/shared-numbers.ts). Within the pool a
 * search checked, a shop has shared numbers when two of its listings show the same 30-day sales of
 * at least `salesMin`, or when at least `feedbackMinListings` of its listings have a feedback value
 * and at least `feedbackShare` of them show the same one below 100% (identical 100% ratings are
 * what the ceiling produces, not a copied number).
 *
 * Measured on the 32 snapshot pools under the live fetch policy (2026-09-28): one shop shows
 * exactly 98.0% on 89% to 100% of its listings in every pool where it has 5 or more; no other shop
 * with 5 or more listings in a pool goes above 40% at one value. Across all 3,027 snapshot
 * products, no other shop has two listings with the same sales from 300 up (one pair at 202);
 * that shop has 59 such values from 500 up.
 */
export const SHARED_NUMBERS = {
  salesMin: 500,
  feedbackMinListings: 5,
  feedbackShare: 0.8,
} as const;

/** Prices at or below this percentile of the passers all get full price fit, so one cheap outlier does not set the scale. */
export const PRICE_FIT = { floorPercentile: 0.1 } as const;

/**
 * Product-type check: a product term must appear within the first `windowTokens` title words
 * (tokens with a letter: a list of model numbers such as "12 13 14 15" does not push the product
 * name out), and a head noun up to `headGap` tokens after it ("Cable Organizer", "Power Bank
 * Flashlight") makes it describe another product. A term up to `bundleGap` tokens after "with"
 * names a part that comes with another product ("Phone Holder with Bluetooth Speaker"). The words
 * of a product term may have at most `maxGap` other tokens between them.
 */
export const TYPE_GATE = { windowTokens: 12, headGap: 2, bundleGap: 2, maxGap: 2 } as const;

/**
 * AliExpress first-level category names that sellers paste into titles as tags ("... Tools Home
 * Garden Tools"). A product term may not borrow a word from one: "garden tools" does not match
 * "... Tools Home Garden Tools". A label that opens the title is the product's own name ("Home
 * Garden Hose ..."), not a tag. Only broad two-domain names: "Luggage & Bags" or "Computer &
 * Office" also name products ("Luggage Bag", "Computer Office Chair"). A test checks each against
 * the real category list (fixtures/aliexpress/aliexpress.affiliate.category.get.json).
 */
export const CATEGORY_LABELS = [
  "Home & Garden",
  "Home Improvement",
  "Sports & Entertainment",
  "Toys & Hobbies",
  "Mother & Kids",
  "Beauty & Health",
  "Consumer Electronics",
  "Weddings & Events",
] as const;

/**
 * Near-duplicate listings (item 4): same shop and `sameShopJaccard` token overlap; same shop, the
 * same 30-day sales of at least `sameSalesMin` and `sameSalesJaccard` overlap (one listing's
 * sales shown on its variants: two organizers of one shop both at exactly 11,268); any shops and
 * `crossShopJaccard` overlap; or the same brand with a model token this close to the start that
 * equals or extends the other's ("S32" and "S32PRO").
 */
export const DEDUP = {
  sameShopJaccard: 0.7,
  sameSalesJaccard: 0.25,
  sameSalesMin: 1000,
  crossShopJaccard: 0.85,
  modelTokenWindow: 4,
} as const;

/**
 * Bump when any filter or ranking rule changes, so cached results ranked the old way are not
 * reused. 7: shared numbers (SHARED_NUMBERS), which also marks listings in the cached results.
 * 8: pages of 5 (RESULTS_PER_PAGE, RESULTS_KEPT 15) and the shop cap setting (SHOP_CAP_MODES).
 * 9: device connector fit (./connectors.ts: no Lightning cable for an iPhone 15).
 * 10: 10 results on the first view and 20 kept (RESULTS_FIRST_VIEW, RESULTS_KEPT), FILL_TIER 93%
 * and 20 sales topping up to 10 (FILL_UP_TO), and a preference the title states moves a product up
 * (WEIGHTS.preference; whole phrases such as "3rd birthday", ./relevance.ts).
 */
export const RANKING_VERSION = 10;
