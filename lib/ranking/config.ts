// Filter thresholds and ranking weights (CLAUDE.md §6.5-6). Defaults are to be tuned against
// real data. The UI reads FILTERS too, so the numbers we show always match the numbers we use.
export interface TrustThresholds {
  minPositiveFeedbackPct: number;
  minUnitsSold: number;
}

export const FILTERS: TrustThresholds = {
  minPositiveFeedbackPct: 90,
  minUnitsSold: 100,
};

/**
 * Second tier (owner decision 2026-09-27), used only to fill up to 3 results when too few meet
 * FILTERS. Niche products (licensed toys, for example) are fragmented across many small sellers
 * with fewer than 100 sales a month; a higher feedback bar keeps them trustworthy. The UI states
 * the thresholds a product actually met; it does not label these products.
 */
export const FILL_TIER: TrustThresholds = {
  minPositiveFeedbackPct: 95,
  minUnitsSold: 30,
};

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
 * One shop's share of a result list (item 4): at most `firstPage` products per shop in the first
 * page and `kept` in the first `keptSize` (RESULTS_KEPT in lib/search/pipeline.ts, which a test
 * checks), unless no other shop has a product left.
 */
export const SHOP_CAP = { firstPage: 1, kept: 2, keptSize: 12 } as const;

/** "small", "mini": a capacity spec ("10000mah") then allows at most this multiple of it. */
export const SMALL_CAPACITY_FACTOR = 1.5;

/**
 * Ratings above `pct` count as if the listing also had `sales` extra sales at `pct`, so 100% on
 * 300 sales does not outrank 98% on 4,000. Ratings at or below `pct` are never lifted.
 */
export const FEEDBACK_PRIOR = { pct: 98, sales: 500 } as const;

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

/** Bump when any filter or ranking rule changes, so cached results ranked the old way are not reused. */
export const RANKING_VERSION = 6;
