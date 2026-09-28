// Loads /admin/stats with the service-role client: the report functions from
// supabase/migrations/phase2_stats.sql and search_telemetry.sql (Asia/Jerusalem days, production
// rows only), today's LLM budget counter and the USD→ILS rate. Each part loads on its own; a part that fails is null (logged by name, never with
// values), so one broken query never hides the rest of the page.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { UsdIlsRate } from "@/lib/fx/boi";
import { israelDayWindow } from "@/lib/guard/rate-limit";
import { SEARCH_ORIGINS } from "@/lib/search/store";
import {
  CLICK_POSITION_GROUPS,
  type ClickPositionStats,
  type DailyStats,
  type FailureStats,
  type LlmKindStats,
  type OriginStats,
  type TopProduct,
  type TopQuery,
  type ZeroResultQuery,
} from "./report";
import { LLM_CALL_KINDS } from "./usage";

/** The dashboard window, in Israel days ending today. */
export const STATS_DAYS = 14;
export const TOP_QUERIES = 20;
export const ZERO_RESULT_QUERIES = 20;
export const TOP_PRODUCTS = 10;

/** The global counter consumeDailyLlmBudget() bumps (lib/guard/rate-limit.ts, rate_limits.ip_hash). */
export const LLM_BUDGET_KEY = "llm:day";

// PostgREST sends numeric and bigint as JSON numbers, but a string is accepted too.
const count = z.coerce.number().int().nonnegative();
const amount = z.coerce.number().nonnegative();
const text = z.string();
const nullableText = z.string().nullable();
const timestamp = z.string().min(1);

const dailySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  searches: count,
  searches_fresh: count,
  searches_cached: count,
  searches_zero: count,
  previews: count,
  more_loads: count,
  clicks: count,
  llm_calls: count,
  llm_cost_usd: amount,
  llm_unpriced_calls: count,
});

const topQuerySchema = z.object({
  query_norm: text,
  sample_query: text,
  searches: count,
  zero_results: count,
  last_seen: timestamp,
});

const zeroQuerySchema = z.object({
  query_norm: text,
  sample_query: text,
  searches: count,
  last_seen: timestamp,
});

const topProductSchema = z.object({
  product_id: text,
  clicks: count,
  last_click: timestamp,
  title_he: nullableText,
  title_en: nullableText,
});

const llmKindSchema = z.object({
  kind: z.enum(LLM_CALL_KINDS),
  calls: count,
  input_tokens: count,
  output_tokens: count,
  cache_read_tokens: count,
  cache_write_tokens: count,
  cost_usd: amount,
  unpriced_calls: count,
});

const originSchema = z.object({
  origin: z.enum(SEARCH_ORIGINS).nullable(),
  searches: count,
  zero_results: count,
  partial_results: count,
  failures: count,
  chips_removed: count,
  clicked: count,
  median_ms_fresh: count.nullable(),
  median_ms_cached: count.nullable(),
});

const failureSchema = z.object({
  failure: z.string().regex(/^[a-z_]{1,32}$/),
  failures: count,
  searches: count,
  last_seen: timestamp,
});

const clickPositionSchema = z.object({
  position_group: z.enum(CLICK_POSITION_GROUPS),
  clicks: count,
});

export interface AdminStats {
  /** Newest first, one row per day of the window (days without activity included). */
  daily: DailyStats[] | null;
  topQueries: TopQuery[] | null;
  zeroResultQueries: ZeroResultQuery[] | null;
  topProducts: TopProduct[] | null;
  llmByKind: LlmKindStats[] | null;
  /** Per origin, the total (origin null) last; null when it could not be loaded. */
  byOrigin: OriginStats[] | null;
  failures: FailureStats[] | null;
  clickPositions: ClickPositionStats[] | null;
  /** Today's 'llm:day' counter (0 before the first unit), or null when it could not be read. */
  budgetCounter: number | null;
  /** DAILY_SEARCH_CAP, or null when it is misconfigured. */
  budgetCap: number | null;
  fx: UsdIlsRate;
}

export interface StatsDeps {
  db: SupabaseClient;
  now: Date;
  /** DAILY_SEARCH_CAP, or null when it could not be read. */
  cap: number | null;
  /** The USD→ILS rate (lib/fx/boi.ts fetchUsdIlsRate, which never throws). */
  fx: () => Promise<UsdIlsRate>;
  log?: (message: string) => void;
}

type DbResult = { data: unknown; error: { message: string } | null };

class StatsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatsQueryError";
  }
}

async function rows<S extends z.ZodType, T>(
  run: () => PromiseLike<DbResult>,
  schema: S,
  map: (row: z.infer<S>) => T,
): Promise<T[]> {
  const { data, error } = await run();
  if (error) throw new StatsQueryError(error.message);
  const parsed = z.array(schema).safeParse(data ?? []);
  if (!parsed.success) throw new StatsQueryError("unexpected row shape");
  return parsed.data.map(map);
}

async function budgetCounter(db: SupabaseClient, now: Date): Promise<number> {
  const { data, error } = await db
    .from("rate_limits")
    .select("count")
    .eq("ip_hash", LLM_BUDGET_KEY)
    .eq("window_start", israelDayWindow(now).start.toISOString())
    .maybeSingle();
  if (error) throw new StatsQueryError(error.message);
  if (data === null) return 0; // nothing charged yet today
  const parsed = z.object({ count }).safeParse(data);
  if (!parsed.success) throw new StatsQueryError("unexpected row shape");
  return parsed.data.count;
}

export async function loadAdminStats(deps: StatsDeps): Promise<AdminStats> {
  const { db } = deps;
  const log = deps.log ?? ((m: string) => console.error(`[stats] ${m.slice(0, 300)}`));
  const part = async <T>(name: string, load: () => Promise<T>): Promise<T | null> => {
    try {
      return await load();
    } catch (err) {
      log(`${name}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
      return null;
    }
  };
  const rpc = (fn: string, args: Record<string, number>) => () => db.rpc(fn, args);
  const window = { p_days: STATS_DAYS };

  const [
    daily,
    topQueries,
    zeroResultQueries,
    topProducts,
    llmByKind,
    byOrigin,
    failures,
    clickPositions,
    counter,
    fx,
  ] = await Promise.all([
    part("daily", () =>
      rows(rpc("stats_daily", window), dailySchema, (r) => ({
        day: r.day,
        searches: r.searches,
        fresh: r.searches_fresh,
        cached: r.searches_cached,
        zeroResults: r.searches_zero,
        previews: r.previews,
        moreLoads: r.more_loads,
        clicks: r.clicks,
        llmCalls: r.llm_calls,
        llmCostUsd: r.llm_cost_usd,
        llmUnpricedCalls: r.llm_unpriced_calls,
      })),
    ),
    part("top queries", () =>
      rows(rpc("stats_top_queries", { ...window, p_limit: TOP_QUERIES }), topQuerySchema, (r) => ({
        queryNorm: r.query_norm,
        sampleQuery: r.sample_query,
        searches: r.searches,
        zeroResults: r.zero_results,
        lastSeen: r.last_seen,
      })),
    ),
    part("zero-result queries", () =>
      rows(
        rpc("stats_zero_result_queries", { ...window, p_limit: ZERO_RESULT_QUERIES }),
        zeroQuerySchema,
        (r) => ({
          queryNorm: r.query_norm,
          sampleQuery: r.sample_query,
          searches: r.searches,
          lastSeen: r.last_seen,
        }),
      ),
    ),
    part("top products", () =>
      rows(
        rpc("stats_top_products", { ...window, p_limit: TOP_PRODUCTS }),
        topProductSchema,
        (r) => ({
          productId: r.product_id,
          clicks: r.clicks,
          lastClick: r.last_click,
          titleHe: r.title_he,
          titleEn: r.title_en,
        }),
      ),
    ),
    part("llm by kind", () =>
      rows(rpc("stats_llm_by_kind", window), llmKindSchema, (r) => ({
        kind: r.kind,
        calls: r.calls,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
        costUsd: r.cost_usd,
        unpricedCalls: r.unpriced_calls,
      })),
    ),
    part("by origin", () =>
      rows(rpc("stats_by_origin", window), originSchema, (r) => ({
        origin: r.origin,
        searches: r.searches,
        zeroResults: r.zero_results,
        partialResults: r.partial_results,
        failures: r.failures,
        chipsRemoved: r.chips_removed,
        clicked: r.clicked,
        medianMsFresh: r.median_ms_fresh,
        medianMsCached: r.median_ms_cached,
      })),
    ),
    part("failures", () =>
      rows(rpc("stats_failures", window), failureSchema, (r) => ({
        failure: r.failure,
        failures: r.failures,
        searches: r.searches,
        lastSeen: r.last_seen,
      })),
    ),
    part("click positions", () =>
      rows(rpc("stats_click_positions", window), clickPositionSchema, (r) => ({
        group: r.position_group,
        clicks: r.clicks,
      })),
    ),
    part("llm budget", () => budgetCounter(db, deps.now)),
    deps.fx(),
  ]);

  return {
    daily,
    topQueries,
    zeroResultQueries,
    topProducts,
    llmByKind,
    byOrigin,
    failures,
    clickPositions,
    budgetCounter: counter,
    budgetCap: deps.cap,
    fx,
  };
}
