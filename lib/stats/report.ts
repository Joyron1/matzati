// Pure shapes and arithmetic behind /admin/stats. Loading is in ./queries.ts, display text in
// ./format.ts. Every number here comes from our own tables; nothing is estimated. Every report
// reads production rows only (search_log.env and friends, 20260928140000_search_telemetry.sql):
// dev and preview traffic writes to the same database but never shows up here.
import type { SearchOriginKind } from "@/lib/search/store";
import type { LlmCallKind } from "./usage";

/** One Asia/Jerusalem calendar day (stats_daily in supabase/migrations/phase2_stats.sql). */
export interface DailyStats {
  /** "YYYY-MM-DD", an Israel date. */
  day: string;
  /**
   * Visitor searches (source "search"), including chip removals and sort changes. Failed and
   * shared requests are not counted here (see OriginStats and FailureStats).
   */
  searches: number;
  /** Results fetched for this search (cache "none" or "parse"). */
  fresh: number;
  /** Served entirely from the results cache (14 days; 48h before 2026-09-27). */
  cached: number;
  zeroResults: number;
  /** examplePreview runs (SEO pages; older rows also the home page example); not searches. */
  previews: number;
  /** "עוד 3 אפשרויות" pages served. */
  moreLoads: number;
  clicks: number;
  llmCalls: number;
  llmCostUsd: number;
  /** Calls with a model we have no price for (not in llmCostUsd). */
  llmUnpricedCalls: number;
}

export type DailyTotals = Omit<DailyStats, "day">;

export interface TopQuery {
  queryNorm: string;
  /** The most recent spelling, for display and for creating an SEO page. */
  sampleQuery: string;
  searches: number;
  zeroResults: number;
  lastSeen: string;
}

export interface ZeroResultQuery {
  queryNorm: string;
  sampleQuery: string;
  searches: number;
  lastSeen: string;
}

export interface TopProduct {
  productId: string;
  clicks: number;
  lastClick: string;
  titleHe: string | null;
  titleEn: string | null;
}

export interface LlmKindStats {
  kind: LlmCallKind;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  unpricedCalls: number;
}

/**
 * Requests of one search_log.origin over the window (stats_by_origin); origin null is the total.
 * Shared requests (joined an identical search in flight) are left out.
 */
export interface OriginStats {
  origin: SearchOriginKind | null;
  /** Requests that returned a response. */
  searches: number;
  /** Of those, with no results. */
  zeroResults: number;
  /** Of those, with 1 or 2 results. */
  partialResults: number;
  /** Requests that ended in an error (not in `searches`). */
  failures: number;
  /** Responses with at least one chip removed. */
  chipsRemoved: number;
  /** Responses with at least one click on their result cards. */
  clicked: number;
  /** Median total_ms of responses that fetched results; null when there were none. */
  medianMsFresh: number | null;
  /** Median total_ms of full cache hits; null when there were none. */
  medianMsCached: number | null;
}

/** Failed requests with one search_log.failure code (stats_failures). */
export interface FailureStats {
  failure: string;
  failures: number;
  /** Of those, visitor searches (the rest are "עוד 3 אפשרויות" and SEO page runs). */
  searches: number;
  lastSeen: string;
}

/** Result-card positions: 1 (featured), 2-3, and 4 and up ("עוד 3 אפשרויות"). */
export const CLICK_POSITION_GROUPS = ["featured", "top3", "more"] as const;
export type ClickPositionGroup = (typeof CLICK_POSITION_GROUPS)[number];

export interface ClickPositionStats {
  group: ClickPositionGroup;
  clicks: number;
}

/** part / whole, or null when there is nothing to divide by (shown as a dash, never as 0%). */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function sumDaily(days: readonly DailyStats[]): DailyTotals {
  const totals: DailyTotals = {
    searches: 0,
    fresh: 0,
    cached: 0,
    zeroResults: 0,
    previews: 0,
    moreLoads: 0,
    clicks: 0,
    llmCalls: 0,
    llmCostUsd: 0,
    llmUnpricedCalls: 0,
  };
  for (const d of days) {
    for (const key of Object.keys(totals) as (keyof DailyTotals)[]) totals[key] += d[key];
  }
  return totals;
}

/** USD to ILS with the day's rate, to the agora. */
export function usdToIls(usd: number, usdIls: number): number {
  return Math.round(usd * usdIls * 100) / 100;
}

export interface BudgetUse {
  /** Units spent today, at most the cap. */
  used: number;
  cap: number;
  /** used / cap between 0 and 1; 1 when the cap is 0 (the kill switch is on). */
  share: number;
  /** Requests refused after the cap was reached (the counter keeps counting them). */
  refused: number;
}

/**
 * Today's LLM budget from the 'llm:day' counter (lib/guard/rate-limit.ts). The counter is bumped
 * before the cap is checked, so it can pass the cap: everything above it was refused.
 */
export function budgetUse(counter: number, cap: number): BudgetUse {
  const safeCap = Math.max(0, Math.floor(cap));
  const count = Math.max(0, Math.floor(counter));
  return {
    used: Math.min(count, safeCap),
    cap: safeCap,
    share: safeCap > 0 ? Math.min(count, safeCap) / safeCap : 1,
    refused: Math.max(0, count - safeCap),
  };
}
