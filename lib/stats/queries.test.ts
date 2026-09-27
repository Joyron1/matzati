import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { UsdIlsRate } from "@/lib/fx/boi";
import { LLM_BUDGET_KEY, loadAdminStats, STATS_DAYS } from "./queries";

vi.mock("server-only", () => ({}));

type Result = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });

const DAILY = [
  {
    day: "2026-09-27",
    searches: 12,
    searches_fresh: 5,
    searches_cached: 7,
    searches_zero: 2,
    previews: 30,
    more_loads: 3,
    clicks: 4,
    llm_calls: 11,
    llm_cost_usd: 0.0154,
    llm_unpriced_calls: 0,
  },
  {
    day: "2026-09-26",
    searches: 0,
    searches_fresh: 0,
    searches_cached: 0,
    searches_zero: 0,
    previews: 0,
    more_loads: 0,
    clicks: 0,
    llm_calls: 0,
    llm_cost_usd: "0", // PostgREST may send numeric as a string
    llm_unpriced_calls: 0,
  },
];

const RPC: Record<string, unknown> = {
  stats_daily: DAILY,
  stats_top_queries: [
    {
      query_norm: "אוזניות לריצה עד ₪100",
      sample_query: "אוזניות לריצה עד 100 ש״ח",
      searches: 9,
      zero_results: 1,
      last_seen: "2026-09-27T10:00:00+00:00",
    },
  ],
  stats_zero_result_queries: [
    {
      query_norm: "משהו",
      sample_query: "משהו",
      searches: 2,
      last_seen: "2026-09-27T09:00:00+00:00",
    },
  ],
  stats_top_products: [
    {
      product_id: "1005001234567890",
      clicks: 3,
      last_click: "2026-09-27T11:00:00+00:00",
      title_he: "אוזניות אלחוטיות",
      title_en: "TWS Earbuds",
    },
    {
      product_id: "1005000000000001",
      clicks: 1,
      last_click: "2026-09-25T11:00:00+00:00",
      title_he: null,
      title_en: null,
    },
  ],
  stats_llm_by_kind: [
    {
      kind: "explain",
      calls: 6,
      input_tokens: 5400,
      output_tokens: 600,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_usd: 0.0084,
      unpriced_calls: 0,
    },
  ],
};

const FX: UsdIlsRate = { rate: 3.7, publishedAt: "2026-09-25T12:00:00Z", source: "boi" };

function fakeDb(over: { rpc?: Record<string, Result>; budget?: Result } = {}) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const filters: [string, unknown][] = [];
  const db = {
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return over.rpc?.[fn] ?? ok(RPC[fn]);
    },
    from: (table: string) => {
      expect(table).toBe("rate_limits");
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return query;
        },
        maybeSingle: async () => over.budget ?? ok({ count: 1234 }),
      };
      return query;
    },
  };
  return { db: db as unknown as SupabaseClient, rpcCalls, filters };
}

const NOW = new Date("2026-09-27T10:15:00Z");

describe("loadAdminStats", () => {
  it("loads every part for the 14-day window", async () => {
    const { db, rpcCalls, filters } = fakeDb();
    const stats = await loadAdminStats({ db, now: NOW, cap: 2000, fx: async () => FX });

    expect(rpcCalls).toEqual(
      expect.arrayContaining([
        { fn: "stats_daily", args: { p_days: STATS_DAYS } },
        { fn: "stats_top_queries", args: { p_days: STATS_DAYS, p_limit: 20 } },
        { fn: "stats_zero_result_queries", args: { p_days: STATS_DAYS, p_limit: 20 } },
        { fn: "stats_top_products", args: { p_days: STATS_DAYS, p_limit: 10 } },
        { fn: "stats_llm_by_kind", args: { p_days: STATS_DAYS } },
      ]),
    );
    expect(stats.daily).toEqual([
      {
        day: "2026-09-27",
        searches: 12,
        fresh: 5,
        cached: 7,
        zeroResults: 2,
        previews: 30,
        moreLoads: 3,
        clicks: 4,
        llmCalls: 11,
        llmCostUsd: 0.0154,
        llmUnpricedCalls: 0,
      },
      expect.objectContaining({ day: "2026-09-26", llmCostUsd: 0 }),
    ]);
    expect(stats.topQueries).toEqual([
      {
        queryNorm: "אוזניות לריצה עד ₪100",
        sampleQuery: "אוזניות לריצה עד 100 ש״ח",
        searches: 9,
        zeroResults: 1,
        lastSeen: "2026-09-27T10:00:00+00:00",
      },
    ]);
    expect(stats.zeroResultQueries?.[0]).toMatchObject({ sampleQuery: "משהו", searches: 2 });
    expect(stats.topProducts?.map((p) => [p.productId, p.clicks, p.titleHe])).toEqual([
      ["1005001234567890", 3, "אוזניות אלחוטיות"],
      ["1005000000000001", 1, null],
    ]);
    expect(stats.llmByKind).toEqual([
      {
        kind: "explain",
        calls: 6,
        inputTokens: 5400,
        outputTokens: 600,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.0084,
        unpricedCalls: 0,
      },
    ]);
    expect(stats).toMatchObject({ budgetCounter: 1234, budgetCap: 2000, fx: FX });
    // Today's global LLM counter: the Israel day that started at 21:00Z (IDT).
    expect(filters).toEqual([
      ["ip_hash", LLM_BUDGET_KEY],
      ["window_start", "2026-09-26T21:00:00.000Z"],
    ]);
  });

  it("reads no counter row as nothing used yet today", async () => {
    const { db } = fakeDb({ budget: ok(null) });
    const stats = await loadAdminStats({ db, now: NOW, cap: 2000, fx: async () => FX });
    expect(stats.budgetCounter).toBe(0);
  });

  it("turns a failing or malformed part into null and keeps the rest", async () => {
    const { db } = fakeDb({
      rpc: {
        stats_daily: {
          data: null,
          error: { message: "function public.stats_daily does not exist" },
        },
        stats_top_products: ok([{ product_id: 5 }]),
      },
      budget: { data: null, error: { message: "permission denied" } },
    });
    const log = vi.fn();
    const stats = await loadAdminStats({ db, now: NOW, cap: null, fx: async () => FX, log });
    expect(stats.daily).toBeNull();
    expect(stats.topProducts).toBeNull();
    expect(stats.budgetCounter).toBeNull();
    expect(stats.budgetCap).toBeNull();
    expect(stats.topQueries).toHaveLength(1);
    expect(log.mock.calls.map(([m]) => String(m).split(":")[0]).sort()).toEqual([
      "daily",
      "llm budget",
      "top products",
    ]);
  });

  it("rejects an unknown LLM job kind rather than mislabelling it", async () => {
    const { db } = fakeDb({
      rpc: { stats_llm_by_kind: ok([{ ...(RPC.stats_llm_by_kind as object[])[0], kind: "x" }]) },
    });
    const stats = await loadAdminStats({ db, now: NOW, cap: 1, fx: async () => FX, log: () => {} });
    expect(stats.llmByKind).toBeNull();
  });
});
