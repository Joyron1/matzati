// search_log wiring in lib/search/server.ts for requests that share a run already in flight:
// a visitor's search that joins an identical running search, and a home page view that joins a
// running example preview. Each is its own request, so each writes its own row, as a cache hit.
// The pipeline itself is faked; nothing here reaches Supabase, AliExpress or an LLM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchOutcome } from "@/lib/search/pipeline";
import { examplePreview, searchForRequest } from "@/lib/search/server";
import type { SearchLogEntry } from "@/lib/search/store";

const m = vi.hoisted(() => ({
  runSearch: vi.fn(),
  logSearch: vi.fn(async () => {}),
}));

vi.mock("server-only", () => ({}));
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
}));

function outcome(q: string, source: SearchLogEntry["source"]): SearchOutcome {
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
      rejected: null,
      keywordsTried: [],
      explainRejected: [],
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
    });
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
      expect.objectContaining({ source: "preview", cache: "results", query: q }),
    );
  });
});
