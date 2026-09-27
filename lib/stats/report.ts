// Pure shapes and arithmetic behind /admin/stats. Loading is in ./queries.ts, display text in
// ./format.ts. Every number here comes from our own tables; nothing is estimated.
import type { LlmCallKind } from "./usage";

/** One Asia/Jerusalem calendar day (stats_daily in supabase/migrations/phase2_stats.sql). */
export interface DailyStats {
  /** "YYYY-MM-DD", an Israel date. */
  day: string;
  /** Visitor searches (source "search"), including chip removals and sort changes. */
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
