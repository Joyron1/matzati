// Filter thresholds and ranking weights (CLAUDE.md §6.5-6). Defaults are to be tuned against
// real data. The UI reads FILTERS too, so the numbers we show always match the numbers we use.
export const FILTERS = {
  minPositiveFeedbackPct: 90,
  minUnitsSold: 100,
} as const;

export const WEIGHTS = {
  feedback: 2,
  volume: 1.5,
  priceFit: 0.5,
  /** Volume weight when the user asked for popular products. */
  volumeMostPopular: 3,
  discount: 0.2,
} as const;

/**
 * Ratings above `pct` count as if the listing also had `sales` extra sales at `pct`, so 100% on
 * 300 sales does not outrank 98% on 4,000. Ratings at or below `pct` are never lifted.
 */
export const FEEDBACK_PRIOR = { pct: 98, sales: 500 } as const;

/** Prices at or below this percentile of the passers all get full price fit, so one cheap outlier does not set the scale. */
export const PRICE_FIT = { floorPercentile: 0.1 } as const;

/**
 * Product-type check: a product term must appear within the first `windowTokens` title tokens,
 * and an accessory noun up to `headGap` tokens after it ("Cable Organizer") marks an accessory.
 */
export const TYPE_GATE = { windowTokens: 12, headGap: 2 } as const;

/** Near-duplicate listings: same shop and this token overlap, or a model token this close to the start. */
export const DEDUP = { sameShopJaccard: 0.7, modelTokenWindow: 4 } as const;

/** Bump when any filter or ranking rule changes, so cached results ranked the old way are not reused. */
export const RANKING_VERSION = 2;
