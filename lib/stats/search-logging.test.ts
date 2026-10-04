// search_log wiring in lib/search/server.ts for requests that share a run already in flight:
// a visitor's search that joins an identical running search, and a landing page render that joins
// a running example preview. Each is its own request, so each writes its own row, as a cache hit.
// The pipeline itself is faked; nothing here reaches Supabase, AliExpress or an LLM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchOutcome } from "@/lib/search/pipeline";
import { examplePreview, moreForRequest, searchForRequest } from "@/lib/search/server";
import type { SearchLogEntry } from "@/lib/search/store";
import type { ResultProduct } from "@/lib/types";

const m = vi.hoisted(() => ({
  runSearch: vi.fn(),
  loadMore: vi.fn(),
  logSearch: vi.fn<(entry: SearchLogEntry) => Promise<void>>(async () => {}),
  getAdminUser: vi.fn<() => Promise<{ email: string } | null>>(async () => null),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({ getAdminUser: m.getAdminUser }));
vi.mock("@/lib/settings/queries", () => ({ shopCapMode: async () => "none" }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({}) }));
vi.mock("@/lib/guard/rate-limit", () => ({
  checkSearchRate: async () => ({ ok: true }),
  clientIp: () => "203.0.113.7",
  hashIp: () => "hash",
  consumeDailyLlmBudget: async () => true,
}));
vi.mock("@/lib/llm/anthropic", () => ({
  AnthropicProvider: class {
    readonly name = "anthropic";
    readonly model = "fake";
  },
}));
vi.mock("@/lib/search/supabase-store", () => ({
  SupabaseStore: class {
    logSearch = m.logSearch;
  },
}));
vi.mock("@/lib/search/pipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/search/pipeline")>()),
  runSearch: m.runSearch,
  // The server starts a visitor's search in stages (plan item 15): every stage of the faked run
  // comes from its one outcome, whose row uid is "run-uid" (outcome() below).
  startSearch: (...args: unknown[]) => {
    const run = Promise.resolve(m.runSearch(...args) as Promise<SearchOutcome>);
    const stage = <T>(pick: (o: SearchOutcome) => T) => {
      const p = run.then(pick);
      p.catch(() => {});
      return p;
    };
    return {
      searchUid: "run-uid",
      understood: stage((o) => ({ query: o.response.query, chips: [], sort: o.response.sort })),
      products: stage((o) => ({ response: o.response, pending: false })),
      final: stage((o) => o.response),
      outcome: run,
    };
  },
  loadMore: m.loadMore,
}));

function outcome(
  q: string,
  source: SearchLogEntry["source"],
  listable = source === "search",
): SearchOutcome {
  const log: SearchLogEntry = {
    query: q,
    queryNorm: q.trim(),
    parsed: {
      keywords_en: "usb cable",
      product_terms: ["cable"],
      requirements: [],
      sort_preference: "best_value",
      product_he: "כבל USB",
    },
    resultIds: ["1", "2", "3", "4"],
    cache: "none",
    resultsCount: 3,
    source,
    categoryId: "44",
    listable,
    origin: source === "search" ? "typed" : source,
    without: [],
    sortOverride: null,
    timings: { parse_ms: 900, fetch_ms: 4000, explain_ms: 2500, total_ms: 7500 },
    aliCalls: 2,
    rejected: null,
    failure: null,
    searchUid: "run-uid",
    shared: false,
  };
  return {
    response: {
      query: q,
      chips: [],
      sort: "best_value",
      checked_count: 50,
      passed_count: 4,
      results: [],
      more_available: true,
      filters_key: "f".repeat(64),
      cached: false,
    },
    meta: {
      cache: "none",
      llmUsage: [],
      aliCalls: 1,
      linkCalls: 0,
      rejected: null,
      keywordsTried: [],
      explainRejected: [],
      timings: { parse_ms: 900, fetch_ms: 4000, explain_ms: 2500 },
    },
    log,
  };
}

/** A runSearch that finishes only when the test says so, so requests overlap for real. */
function deferredRun(result: SearchOutcome) {
  let release!: () => void;
  const done = new Promise<SearchOutcome>((resolve) => (release = () => resolve(result)));
  m.runSearch.mockImplementationOnce(() => done);
  return release;
}

beforeEach(() => {
  vi.stubEnv("IP_HASH_SALT", "test-salt");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("LLM_PROVIDER", "anthropic");
  vi.stubEnv("ALIEXPRESS_APP_KEY", "k");
  vi.stubEnv("ALIEXPRESS_APP_SECRET", "s");
  vi.stubEnv("ALIEXPRESS_TRACKING_ID", "t");
  vi.stubEnv("DAILY_SEARCH_CAP", "2000");
  m.getAdminUser.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("searchForRequest: shared runs", () => {
  it("logs a request that joined a running search as a cache hit with its own spelling", async () => {
    const q = "כבל USB עד 40 ש״ח";
    const release = deferredRun(outcome(q, "search"));
    const first = searchForRequest({ q }, new Headers());
    const second = searchForRequest({ q: 'כבל usb  עד 40 ש"ח' }, new Headers());
    await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(1));
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.ok && b.ok).toBe(true);
    expect(m.runSearch).toHaveBeenCalledTimes(1);
    expect(m.runSearch.mock.calls[0][0]).toMatchObject({ q, without: [] });
    // The run logs itself (in the pipeline); the joiner adds exactly one row.
    expect(m.logSearch).toHaveBeenCalledTimes(1);
    expect(m.logSearch).toHaveBeenCalledWith({
      ...outcome(q, "search").log,
      query: 'כבל usb  עד 40 ש"ח',
      queryNorm: "כבל usb עד ₪40",
      cache: "results",
      listable: true,
      // No work of its own: no calls, only its own wait, and a uid of its own.
      origin: "typed",
      timings: {
        parse_ms: null,
        fetch_ms: null,
        explain_ms: null,
        products_ms: expect.any(Number),
        total_ms: expect.any(Number),
      },
      aliCalls: 0,
      searchUid: expect.any(String),
      shared: true,
      owner: false,
      diag: null,
    });
    expect(m.logSearch.mock.calls[0][0].searchUid).not.toBe("run-uid");
  });

  it("marks the owner's own search and its joiner, and lists a typed one", async () => {
    // Owner decision 2026-09-29: owner keeps the rows out of the stats, not off /searches.
    const q = "מטען נייד";
    m.getAdminUser.mockResolvedValue({ email: "owner@example.com" });
    const release = deferredRun(outcome(q, "search"));
    const first = searchForRequest({ q }, new Headers());
    const second = searchForRequest({ q }, new Headers());
    await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(m.runSearch.mock.calls[0][0]).toMatchObject({ q, owner: true });
    expect(m.logSearch.mock.calls[0][0]).toMatchObject({ owner: true, listable: true });
  });

  it("decides whether /searches may list the joiner for its own spelling", async () => {
    // Both spell "כבל example com" once normalized, but only one of them holds a link.
    async function join(runQ: string, runListable: boolean, joinQ: string, without: string[]) {
      m.logSearch.mockClear();
      const runs = m.runSearch.mock.calls.length;
      const release = deferredRun(outcome(runQ, "search", runListable));
      const first = searchForRequest({ q: runQ, without }, new Headers());
      const second = searchForRequest({ q: joinQ, without }, new Headers());
      await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(runs + 1));
      release();
      await Promise.all([first, second]);
      expect(m.logSearch).toHaveBeenCalledTimes(1);
      return m.logSearch.mock.calls[0][0];
    }
    expect(await join("כבל example com", true, "כבל example.com", [])).toMatchObject({
      query: "כבל example.com",
      listable: false,
    });
    expect(await join("כבל example.com", false, "כבל example com", [])).toMatchObject({
      query: "כבל example com",
      listable: true,
    });
    // A chip removed changes nothing since 2026-10-03: listed when its own query passes.
    expect(await join("כבל example com", false, "כבל example com", ["max"])).toMatchObject({
      listable: true,
    });
    expect(m.runSearch).toHaveBeenCalledTimes(3);
  });

  it("lists a joiner that came from one of our links too, and passes typed to the run", async () => {
    const q = "מנורת לילה לחדר ילדים";
    const release = deferredRun(outcome(q, "search"));
    const first = searchForRequest({ q }, new Headers());
    const second = searchForRequest({ q, arrival: "recent" }, new Headers());
    await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(m.runSearch.mock.calls[0][0]).toMatchObject({ q, typed: true });
    expect(m.logSearch).toHaveBeenCalledTimes(1);
    // Every search with results is listed, however it started (owner decision 2026-10-03).
    expect(m.logSearch.mock.calls[0][0]).toMatchObject({ query: q, listable: true });
  });

  it("never lists a joiner the WhatsApp bot sent (not typed, no arrival)", async () => {
    const q = "מנורת לילה לחדר שינה";
    const release = deferredRun(outcome(q, "search"));
    const first = searchForRequest({ q }, new Headers());
    const second = searchForRequest({ q, typed: false }, new Headers());
    await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(m.logSearch.mock.calls[0][0]).toMatchObject({ query: q, listable: false });
  });

  it("logs nothing extra for a search that ran on its own", async () => {
    m.runSearch.mockResolvedValueOnce(outcome("מנורת לילה", "search"));
    const res = await searchForRequest({ q: "מנורת לילה" }, new Headers());
    expect(res.ok).toBe(true);
    expect(m.logSearch).not.toHaveBeenCalled();
  });

  it("logs nothing for a joiner when the shared run fails", async () => {
    let fail!: (err: Error) => void;
    m.runSearch.mockImplementationOnce(
      () => new Promise((_, reject) => (fail = (err) => reject(err))),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = searchForRequest({ q: "רמקול" }, new Headers());
    const second = searchForRequest({ q: "רמקול" }, new Headers());
    await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(1));
    fail(new Error("boom"));
    expect(await first).toMatchObject({ ok: false });
    expect(await second).toMatchObject({ ok: false });
    expect(m.logSearch).not.toHaveBeenCalled();
  });
});

describe("examplePreview", () => {
  it("runs as source 'preview' and logs a view that joined the running preview", async () => {
    const q = "אוזניות לריצה, עמידות למים, עד 100 ש״ח";
    const release = deferredRun(outcome(q, "preview"));
    const first = examplePreview(q);
    const second = examplePreview(q);
    await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);

    expect(m.runSearch.mock.calls[0][0]).toEqual({ q, source: "preview" });
    expect(m.logSearch).toHaveBeenCalledTimes(1);
    expect(m.logSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "preview",
        cache: "results",
        query: q,
        listable: false,
        origin: "preview",
        shared: true,
      }),
    );
  });
});

const RESULT: ResultProduct = {
  product_id: "1005001234567890",
  title_he: "מנורת לילה",
  title_en: "Night Light",
  why_he: "",
  price_ils: 20,
  original_price_ils: null,
  price_is_approx: false,
  discount_pct: null,
  positive_feedback_pct: 97,
  units_sold: 500,
  passed_tier: "standard",
  image_urls: [],
  category_id: "39",
};

describe("searchForRequest: search uid and origin", () => {
  it("tags each request's results with the uid of its own search_log row", async () => {
    const q = "מנורת לילה";
    const run = outcome(q, "search");
    run.response.results = [RESULT];
    const release = deferredRun(run);
    const first = searchForRequest({ q }, new Headers());
    const second = searchForRequest({ q }, new Headers());
    await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(1));
    release();
    const [a, b] = await Promise.all([first, second]);
    if (!a.ok || !b.ok) throw new Error("expected both requests to succeed");
    expect(a.response.results).toEqual([{ ...RESULT, search_uid: "run-uid" }]);
    const joinerUid = m.logSearch.mock.calls[0][0].searchUid;
    expect(b.response.results).toEqual([{ ...RESULT, search_uid: joinerUid }]);
    // The shared outcome is never changed.
    expect(run.response.results[0]).not.toHaveProperty("search_uid");
  });

  it("passes the arrival to the run and logs a joiner with its own origin", async () => {
    const q = "מטען נייד";
    const release = deferredRun(outcome(q, "search"));
    const first = searchForRequest({ q, arrival: "ad" }, new Headers());
    const second = searchForRequest({ q, arrival: "recent" }, new Headers());
    await vi.waitFor(() => expect(m.runSearch).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(m.runSearch.mock.calls[0][0]).toMatchObject({ q, typed: false, arrival: "ad" });
    expect(m.logSearch.mock.calls[0][0]).toMatchObject({
      origin: "recent",
      listable: true,
      shared: true,
    });
  });

  it("logs the failure code the visitor is answered with", async () => {
    m.runSearch.mockResolvedValueOnce(outcome("x", "search"));
    await searchForRequest({ q: "x" }, new Headers());
    const deps = m.runSearch.mock.calls[0][1] as { failureOf: (err: unknown) => string | null };
    expect(deps.failureOf(new Error("boom"))).toBe("unavailable");
  });
});

describe("moreForRequest: search uid", () => {
  it("tags the page's results with the uid of its own 'more' row", async () => {
    const log = { ...outcome("כבל USB", "more", false).log, searchUid: "more-uid" };
    m.loadMore.mockResolvedValueOnce({
      results: [RESULT],
      more_available: false,
      fetched_at: "2026-09-28T08:00:00.000Z",
      meta: outcome("כבל USB", "more").meta,
      log,
    });
    const res = await moreForRequest("f".repeat(64), 1, new Headers());
    expect(res).toEqual({
      ok: true,
      // promo_code_valid: whether its AliExpress code is valid when the page is sent (none here).
      results: [{ ...RESULT, search_uid: "more-uid", promo_code_valid: false }],
      more_available: false,
    });
    const deps = m.loadMore.mock.calls[0][2] as { failureOf: (err: unknown) => string | null };
    expect(deps.failureOf(new Error("boom"))).toBe("unavailable");
    expect(m.loadMore.mock.calls[0][3]).toEqual({ owner: false, cards: false });
  });
});
