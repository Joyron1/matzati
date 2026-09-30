import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { RESULTS_FIRST_VIEW, RESULTS_KEPT, RESULTS_PER_PAGE } from "@/lib/config/site";
import { EXPLAIN_SYSTEM } from "@/lib/llm/explain";
import { TITLES_SYSTEM } from "@/lib/llm/titles";
import { agePhrases, type ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import type { z } from "zod";
import { queryKey } from "./cache-key";
import {
  emptyParseCreatedAt,
  FETCH_BUDGET_MS,
  isListableSearch,
  keywordLadder,
  LLM_STAGE_LIMITS,
  loadMore,
  runSearch,
  SearchError,
  searchFailureCode,
} from "./pipeline";
import { MAX_ALI_CALLS } from "./fetch-policy";
import { MemoryStore } from "./store";

// Real product.query response ("usb cable", ILS), captured by check:ali.
const PRODUCTS = readFileSync(
  "fixtures/aliexpress/aliexpress.affiliate.product.query.json",
  "utf8",
);

const PARSE: ParsedQueryRaw = {
  product_he: "כבל USB",
  product_terms: ["cable"],
  requirements: [],
  keywords_en: "usb cable",
  min_price_ils: null,
  max_price_ils: 40,
  sort_preference: "best_value",
  category_hint: null,
};

// One line per card of a page (RESULTS_PER_PAGE), all different: a batch with two identical lines
// may be rejected.
const WHYS = [
  "עבר את הסינון עם משוב חיובי גבוה ומכירות רבות בחודש האחרון.",
  "מתאים לחיפוש ונמכר הרבה בחודש האחרון, עם משוב חיובי גבוה.",
  "בחירה פופולרית שעברה את הסינון, עם משוב חיובי גבוה.",
  "כבל שעבר את הסינון שלנו, עם משוב חיובי גבוה מקונים.",
  "מתאים למה שחיפשתם, עם הרבה מכירות ומשוב חיובי גבוה.",
];

class FakeLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-haiku-4-5";
  calls: string[] = [];
  /** Per call: its kind and the limits it was sent with. */
  limits: { kind: string; timeoutMs?: number; maxRetries?: number }[] = [];
  /** Set to make that kind of call throw, as a timeout or an API error does. */
  failing = new Set<"parse" | "explain" | "titles">();
  /** The why_he of the i-th product of an explain batch. */
  why: (i: number) => string = (i) => WHYS[i % WHYS.length];
  constructor(private parse: ParsedQueryRaw | null = PARSE) {}
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
    const usage = { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const kind =
      req.system === EXPLAIN_SYSTEM ? "explain" : req.system === TITLES_SYSTEM ? "titles" : "parse";
    this.limits.push({ kind, timeoutMs: req.timeoutMs, maxRetries: req.maxRetries });
    if (this.failing.has(kind)) throw new Error(`${kind}: request timed out`);
    if (kind === "titles") {
      this.calls.push("titles");
      const { products } = JSON.parse(req.user) as { products: { id: string }[] };
      const items = products.map((p) => ({ id: p.id, title_he: "כבל USB לטעינה" }));
      return { data: { items } as z.infer<T>, usage, model: this.model };
    }
    if (kind === "explain") {
      this.calls.push("explain");
      const { products } = JSON.parse(req.user) as { products: { id: string }[] };
      const items = products.map((p, i) => ({
        id: p.id,
        title_he: "כבל טעינה מהיר",
        why_he: this.why(i),
      }));
      return { data: { items } as z.infer<T>, usage, model: this.model };
    }
    this.calls.push("parse");
    return { data: this.parse as z.infer<T>, usage, model: this.model };
  }
}

function setup(parse?: ParsedQueryRaw | null) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(PRODUCTS));
  const ali = new AliExpressClient(
    { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
    { fetch: fetchMock, sleep: async () => {} },
  );
  const llm = new FakeLlm(parse);
  const store = new MemoryStore();
  const deps = { llm, ali, store, sleep: async () => {} };
  return { deps, llm, store, fetchMock };
}

describe("runSearch", () => {
  it("parses, fetches, ranks, explains and returns at most a page of grounded results", async () => {
    const { deps, llm, fetchMock } = setup();
    const { response, meta } = await runSearch({ q: "כבל USB עד 40 ש״ח" }, deps);
    expect(llm.calls).toEqual(["parse", "explain", "titles"]);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(meta.cache).toBe("none");
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results.length).toBeLessThanOrEqual(RESULTS_PER_PAGE);
    for (const r of response.results) {
      expect(r.price_ils).toBeLessThanOrEqual(40);
      expect(r.positive_feedback_pct).toBeGreaterThanOrEqual(90);
      expect(r.units_sold).toBeGreaterThanOrEqual(100);
      expect(r.title_en.toLowerCase()).toContain("cable");
    }
    expect(response.chips.map((c) => c.label_he)).toEqual(["כבל USB", "עד ₪40"]);
    // Places 6-10: standard cards with the titles call's Hebrew title and no line.
    expect(response.extra_results).toHaveLength(RESULTS_FIRST_VIEW - RESULTS_PER_PAGE);
    for (const r of response.extra_results!) {
      expect(r).toMatchObject({ title_he: "כבל USB לטעינה", why_he: "" });
      expect(r.units_sold).toBeGreaterThanOrEqual(100);
    }
    const shown = [...response.results, ...response.extra_results!].map((r) => r.product_id);
    expect(new Set(shown).size).toBe(RESULTS_FIRST_VIEW);
  });

  it("gives places 6-10 their Hebrew titles from the cache: a hit needs no titles call", async () => {
    const { deps, llm, store } = setup({ ...PARSE, max_price_ils: null });
    const fresh = await runSearch({ q: "כבל USB" }, deps);
    const entry = store.results.get(fresh.response.filters_key!)!;
    // Stored as titles, never as lines: places 6-10 have no line of their own.
    const second = entry.products
      .slice(RESULTS_PER_PAGE, RESULTS_FIRST_VIEW)
      .map((p) => p.productId);
    expect(Object.keys(entry.titles ?? {}).sort()).toEqual([...second].sort());
    for (const id of second) expect(entry.explanations[id]).toBeUndefined();
    // Saved to products.title_he too, for /p and similar products.
    for (const id of second) expect(store.products.get(id)?.titleHe).toBe("כבל USB לטעינה");
    const again = await runSearch({ q: "כבל USB" }, deps);
    expect(again.response.cached).toBe(true);
    expect(again.response.extra_results).toEqual(fresh.response.extra_results);
    expect(llm.calls).toEqual(["parse", "explain", "titles"]);
    expect(fresh.response.more_after_first_view).toBe(entry.products.length > RESULTS_FIRST_VIEW);
  });

  it("shows AliExpress's titles in places 6-10 when the titles call fails, and keeps the set an hour", async () => {
    const { deps, llm, store } = setup({ ...PARSE, max_price_ils: null });
    llm.failing.add("titles");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { response, meta, log } = await runSearch({ q: "כבל USB" }, { ...deps, now: () => T0 });
      expect(meta.titlesFailed).toBe(true);
      // The first page keeps its lines; places 6-10 show AliExpress's titles.
      expect(response.results.every((r) => r.why_he && r.title_he !== r.title_en)).toBe(true);
      expect(response.extra_results!.every((r) => r.title_he === r.title_en)).toBe(true);
      expect(store.results.get(response.filters_key!)?.degraded).toBe(true);
      expect(log.diag).toMatchObject({ titles_failed: true });
    } finally {
      errors.mockRestore();
    }
    llm.failing.clear();
    expect((await runSearch({ q: "כבל USB" }, { ...deps, now: () => at(0.9) })).meta.cache).toBe(
      "results",
    );
    const later = await runSearch({ q: "כבל USB" }, { ...deps, now: () => at(1) });
    expect(later.meta.cache).toBe("parse");
    expect(later.response.extra_results![0].title_he).toBe("כבל USB לטעינה");
  });

  it("serves the same query from the 14-day cache without any LLM or AliExpress call", async () => {
    const { deps, llm, fetchMock } = setup();
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, deps);
    const callsBefore = fetchMock.mock.calls.length;
    const again = await runSearch({ q: 'כבל usb  עד 40 ש"ח' }, deps);
    expect(again.meta.cache).toBe("results");
    expect(again.response.cached).toBe(true);
    expect(llm.calls).toEqual(["parse", "explain", "titles"]);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("expires cache entries after 14 days", async () => {
    const { deps, llm } = setup();
    const t0 = new Date("2026-09-27T10:00:00Z");
    const after = (hours: number) => new Date(t0.getTime() + hours * 3_600_000);
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, now: () => t0 });
    const cached = await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, now: () => after(335) });
    expect(cached.meta.cache).toBe("results");
    expect(llm.calls).toEqual(["parse", "explain", "titles"]);
    const fresh = await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, now: () => after(336) });
    expect(fresh.meta.cache).toBe("none");
    expect(llm.calls).toEqual(["parse", "explain", "titles", "parse", "explain", "titles"]);
  });

  it("says when the results were fetched, also when they come from the cache", async () => {
    const { deps } = setup({ ...PARSE, max_price_ils: null });
    const t0 = new Date("2026-09-27T10:00:00Z");
    const later = new Date(t0.getTime() + 5 * 24 * 3_600_000);
    const fresh = await runSearch({ q: "כבל USB" }, { ...deps, now: () => t0 });
    expect(fresh.response.fetched_at).toBe(t0.toISOString());
    const cached = await runSearch({ q: "כבל USB" }, { ...deps, now: () => later });
    expect(cached.response).toMatchObject({ cached: true, fetched_at: t0.toISOString() });
    const more = await loadMore(fresh.response.filters_key!, 1, { ...deps, now: () => later });
    expect(more?.fetched_at).toBe(t0.toISOString());
  });

  it("removing a chip reuses the parse (no LLM parse call)", async () => {
    const { deps, llm } = setup();
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, deps);
    const { response, meta } = await runSearch({ q: "כבל USB עד 40 ש״ח", without: ["max"] }, deps);
    expect(meta.cache).toBe("parse");
    expect(llm.calls).toEqual(["parse", "explain", "titles", "explain", "titles"]);
    expect(response.chips.map((c) => c.id)).toEqual(["product"]);
  });

  it("rejects empty and over-long queries before any call", async () => {
    const { deps, llm } = setup();
    await expect(runSearch({ q: "   " }, deps)).rejects.toMatchObject({ code: "invalid_query" });
    await expect(runSearch({ q: "א".repeat(201) }, deps)).rejects.toBeInstanceOf(SearchError);
    expect(llm.calls).toEqual([]);
  });

  it("reports a parse failure without calling AliExpress", async () => {
    const { deps, fetchMock } = setup(null);
    await expect(runSearch({ q: "משהו" }, deps)).rejects.toMatchObject({ code: "parse_failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadMore", () => {
  it("explains the next page once and then serves it from the cache", async () => {
    const { deps, llm } = setup({ ...PARSE, max_price_ils: null });
    const { response } = await runSearch({ q: "כבל USB" }, deps);
    expect(response.more_available).toBe(true);
    const more = await loadMore(response.filters_key!, 1, deps);
    expect(more?.results.length).toBeGreaterThan(0);
    const again = await loadMore(response.filters_key!, 1, deps);
    expect(again?.results).toEqual(more?.results);
    expect(llm.calls.filter((c) => c === "explain")).toHaveLength(2);
  });

  it("saves the next page's products as checked when the results were fetched", async () => {
    const { deps, store } = setup({ ...PARSE, max_price_ils: null });
    const t0 = new Date("2026-09-27T10:00:00Z");
    const later = new Date(t0.getTime() + 5 * 24 * 3_600_000);
    const { response } = await runSearch({ q: "כבל USB" }, { ...deps, now: () => t0 });
    await loadMore(response.filters_key!, 1, { ...deps, now: () => later });
    // The search saves fresh data (now) before its cards show, then the Hebrew titles under the
    // time it fetched them; the page from the 5-day-old cache keeps the cache's time.
    expect(store.savedAt).toEqual([null, t0.toISOString(), t0.toISOString()]);
  });
});

const Q = "כבל USB עד 40 ש״ח";
const refuse = () =>
  vi.fn(async () => {
    throw new SearchError("capacity", "daily LLM budget is used up");
  });

describe("daily LLM budget (beforeLlmWork)", () => {
  it("is charged exactly once per paid search and never on a full cache hit", async () => {
    const { deps, llm } = setup();
    const beforeLlmWork = vi.fn(async () => {});
    await runSearch({ q: Q }, { ...deps, beforeLlmWork });
    expect(llm.calls).toEqual(["parse", "explain", "titles"]);
    expect(beforeLlmWork).toHaveBeenCalledTimes(1);
    const again = await runSearch({ q: Q }, { ...deps, beforeLlmWork });
    expect(again.meta.cache).toBe("results");
    expect(beforeLlmWork).toHaveBeenCalledTimes(1);
  });

  it("charges a cached parse that still needs fresh results", async () => {
    const { deps } = setup();
    const beforeLlmWork = vi.fn(async () => {});
    await runSearch({ q: Q }, { ...deps, beforeLlmWork });
    const { meta } = await runSearch({ q: Q, without: ["max"] }, { ...deps, beforeLlmWork });
    expect(meta.cache).toBe("parse");
    expect(beforeLlmWork).toHaveBeenCalledTimes(2);
  });

  it("propagates a capacity refusal before any LLM or AliExpress call", async () => {
    const { deps, llm, fetchMock, store } = setup();
    const beforeLlmWork = refuse();
    await expect(runSearch({ q: Q }, { ...deps, beforeLlmWork })).rejects.toMatchObject({
      code: "capacity",
    });
    expect(llm.calls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.parses.size).toBe(0);
  });

  it("refuses after a cached parse without fetching, but keeps serving cached results", async () => {
    const { deps, llm, fetchMock } = setup();
    await runSearch({ q: Q }, deps);
    const fetches = fetchMock.mock.calls.length;
    const beforeLlmWork = refuse();

    const cached = await runSearch({ q: Q }, { ...deps, beforeLlmWork });
    expect(cached.response.cached).toBe(true);
    expect(beforeLlmWork).not.toHaveBeenCalled();

    await expect(
      runSearch({ q: Q, without: ["max"] }, { ...deps, beforeLlmWork }),
    ).rejects.toMatchObject({ code: "capacity" });
    expect(fetchMock.mock.calls.length).toBe(fetches);
    expect(llm.calls).toEqual(["parse", "explain", "titles"]);
  });
});

describe("sort override", () => {
  it("changes the filters key, reuses the parse and ranks the pool already checked", async () => {
    const { deps, llm, fetchMock } = setup();
    const first = await runSearch({ q: Q }, deps);
    const fetches = fetchMock.mock.calls.length;
    const cheapest = await runSearch({ q: Q, sort: "cheapest" }, deps);
    // No parse and no AliExpress call (plan item 13): the pool of the first search is ranked again.
    expect(cheapest.meta).toMatchObject({ cache: "results", derived: true, aliCalls: 0 });
    expect(fetchMock.mock.calls.length).toBe(fetches);
    expect(llm.calls.filter((c) => c === "parse")).toHaveLength(1);
    expect(first.response.sort).toBe("best_value");
    expect(cheapest.response.sort).toBe("cheapest");
    expect(cheapest.response.filters_key).not.toBe(first.response.filters_key);
  });
});

describe("loadMore budget", () => {
  async function searched() {
    const s = setup({ ...PARSE, max_price_ils: null });
    const { response } = await runSearch({ q: "כבל USB" }, s.deps);
    expect(response.more_available).toBe(true);
    return { ...s, fk: response.filters_key! };
  }

  it("charges only when it has to explain", async () => {
    const { deps, fk } = await searched();
    const beforeLlmWork = vi.fn(async () => {});
    await loadMore(fk, 1, { ...deps, beforeLlmWork });
    expect(beforeLlmWork).toHaveBeenCalledTimes(1);
    await loadMore(fk, 1, { ...deps, beforeLlmWork }); // now explained and cached
    await loadMore(fk, 0, { ...deps, beforeLlmWork }); // explained by the search itself
    await loadMore(fk, 99, { ...deps, beforeLlmWork }); // past the end: nothing to explain
    expect(beforeLlmWork).toHaveBeenCalledTimes(1);
  });

  it("propagates a capacity refusal without explaining or touching the cache", async () => {
    const { deps, llm, store, fk } = await searched();
    const before = structuredClone(store.results.get(fk));
    await expect(loadMore(fk, 1, { ...deps, beforeLlmWork: refuse() })).rejects.toMatchObject({
      code: "capacity",
    });
    expect(llm.calls.filter((c) => c === "explain")).toHaveLength(1);
    expect(store.results.get(fk)).toEqual(before);
  });
});

describe("search_log (stats)", () => {
  it("logs every search that returns a response: fresh, cached parse and full cache hit", async () => {
    const { deps, store } = setup();
    const fresh = await runSearch({ q: Q }, deps);
    const cached = await runSearch({ q: 'כבל usb  עד 40 ש"ח' }, deps);
    const refined = await runSearch({ q: Q, without: ["max"] }, deps);

    expect(store.logs.map((l) => [l.cache, l.source])).toEqual([
      ["none", "search"],
      ["results", "search"],
      ["parse", "search"],
    ]);
    const [first, second] = store.logs;
    expect(first).toEqual(fresh.log);
    expect(first).toMatchObject({
      query: Q,
      queryNorm: "כבל usb עד ₪40",
      // Every card of the first view: the explained page and places 6-10.
      resultsCount: fresh.response.results.length + fresh.response.extra_results!.length,
    });
    expect(first.resultsCount).toBeGreaterThan(RESULTS_PER_PAGE);
    expect(first.resultsCount).toBeGreaterThan(0);
    expect(first.resultIds.length).toBeGreaterThanOrEqual(first.resultsCount);
    expect(first.parsed?.max_price_ils).toBe(40);
    // The cache hit logs its own spelling and the same results.
    expect(second).toMatchObject({ query: 'כבל usb  עד 40 ש"ח', queryNorm: first.queryNorm });
    expect(second.resultIds).toEqual(first.resultIds);
    expect(cached.log).toEqual(second);
    expect(refined.log.parsed?.max_price_ils).toBeUndefined();
    // Never anything about the visitor.
    for (const log of store.logs) {
      expect(Object.keys(log).sort()).toEqual(
        [
          "aliCalls",
          "cache",
          "categoryId",
          "diag",
          "failure",
          "listable",
          "origin",
          "owner",
          "parsed",
          "query",
          "queryNorm",
          "rejected",
          "resultIds",
          "resultsCount",
          "searchUid",
          "shared",
          "sortOverride",
          "source",
          "timings",
          "without",
        ].sort(),
      );
    }
  });

  it("records the first shown category and whether /searches may list the search", async () => {
    const { deps, store } = setup();
    const fresh = await runSearch({ q: Q }, deps);
    const cached = await runSearch({ q: Q }, deps);
    const refined = await runSearch({ q: Q, without: ["max"] }, deps);
    const phone = await runSearch({ q: `${Q} 050-1234567` }, deps);
    const preview = await runSearch({ q: Q, source: "preview" }, deps);
    const sorted = await runSearch({ q: Q, sort: "cheapest" }, deps);
    const card = await runSearch({ q: Q, typed: false }, deps);

    const top = fresh.response.results[0].category_id;
    expect(top).toEqual(expect.any(String));
    expect(fresh.log).toMatchObject({ categoryId: top, listable: true });
    expect(cached.log).toMatchObject({ categoryId: top, listable: true });
    // A chip removal, a query with a phone number, an example preview, a sort change and a
    // click on a recent-search card are never listed.
    expect(refined.log).toMatchObject({
      categoryId: refined.response.results[0].category_id,
      listable: false,
    });
    expect(phone.log.listable).toBe(false);
    expect(preview.log.listable).toBe(false);
    expect(sorted.log).toMatchObject({ source: "search", listable: false });
    expect(card.log).toMatchObject({ source: "search", categoryId: top, listable: false });
    expect(store.logs.map((l) => l.listable)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("never lists a zero-result search", async () => {
    const { deps, store } = setup({ ...PARSE, max_price_ils: 0.5 });
    await runSearch({ q: "כבל USB עד חצי שקל" }, deps);
    expect(store.logs[0]).toMatchObject({ resultsCount: 0, categoryId: null, listable: false });
  });

  it("logs a zero-result search with resultsCount 0", async () => {
    const { deps, store } = setup({ ...PARSE, max_price_ils: 0.5 });
    const { response } = await runSearch({ q: "כבל USB עד חצי שקל" }, deps);
    expect(response.results).toEqual([]);
    expect(store.logs).toHaveLength(1);
    expect(store.logs[0]).toMatchObject({ resultsCount: 0, resultIds: [], cache: "none" });
  });

  it("marks an example preview (SEO landing page) as a preview", async () => {
    const { deps, store } = setup();
    await runSearch({ q: Q, source: "preview" }, deps);
    await runSearch({ q: Q, source: "preview" }, deps);
    expect(store.logs.map((l) => [l.source, l.cache])).toEqual([
      ["preview", "none"],
      ["preview", "results"],
    ]);
  });

  it("logs a search that fails with its failure code and what it knew", async () => {
    const { deps, store } = setup(null);
    await expect(runSearch({ q: "משהו" }, deps)).rejects.toMatchObject({ code: "parse_failed" });
    expect(store.logs).toEqual([
      expect.objectContaining({
        query: "משהו",
        parsed: null,
        cache: "none",
        resultsCount: 0,
        resultIds: [],
        categoryId: null,
        listable: false,
        origin: "typed",
        failure: "parse_failed",
        aliCalls: 0,
        rejected: null,
        shared: false,
      }),
    ]);
    expect(store.logs[0].timings).toEqual({
      parse_ms: expect.any(Number),
      fetch_ms: null,
      explain_ms: null,
      products_ms: null,
      total_ms: expect.any(Number),
    });
  });
});

describe("llm_usage (stats)", () => {
  it("records one row per LLM call with its model and token usage", async () => {
    const { deps, store } = setup();
    await runSearch({ q: Q }, deps);
    expect(store.usage).toEqual([
      {
        kind: "parse",
        model: "claude-haiku-4-5",
        usage: expect.objectContaining({ inputTokens: 900 }),
      },
      {
        kind: "explain",
        model: "claude-haiku-4-5",
        usage: expect.objectContaining({ outputTokens: 100 }),
      },
      {
        kind: "titles",
        model: "claude-haiku-4-5",
        usage: expect.objectContaining({ outputTokens: 100 }),
      },
    ]);
    await runSearch({ q: Q }, deps); // full cache hit: no LLM call, no usage row
    expect(store.usage).toHaveLength(3);
  });

  it("records the paid attempts of a parse that failed twice", async () => {
    const { deps, store, llm } = setup(null);
    await expect(runSearch({ q: "משהו" }, deps)).rejects.toMatchObject({ code: "parse_failed" });
    expect(llm.calls).toEqual(["parse", "parse"]);
    expect(store.usage.map((u) => u.kind)).toEqual(["parse", "parse"]);
  });

  it("records the parse when AliExpress fails after it", async () => {
    const { deps, store, fetchMock } = setup();
    fetchMock.mockImplementation(async () => new Response("not json"));
    await expect(runSearch({ q: Q }, deps)).rejects.toMatchObject({ code: "upstream" });
    expect(store.usage.map((u) => u.kind)).toEqual(["parse"]);
    // Logged once, with the filters it ran with and the call it made.
    expect(store.logs).toEqual([
      expect.objectContaining({ failure: "upstream", cache: "none", resultsCount: 0, aliCalls: 1 }),
    ]);
    expect(store.logs[0].parsed?.max_price_ils).toBe(40);
    expect(store.logs[0].timings.fetch_ms).toEqual(expect.any(Number));
  });

  it("never records usage for a refused search", async () => {
    const { deps, store } = setup();
    await expect(runSearch({ q: Q }, { ...deps, beforeLlmWork: refuse() })).rejects.toMatchObject({
      code: "capacity",
    });
    expect(store.usage).toEqual([]);
  });
});

describe("stats writes never fail a search", () => {
  class BrokenLogStore extends MemoryStore {
    override async logSearch(): Promise<void> {
      throw new Error("search_log is down");
    }
    override async logUsage(): Promise<void> {
      throw new Error("llm_usage is down");
    }
  }

  it("returns results when logSearch and logUsage throw", async () => {
    const { deps } = setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = new BrokenLogStore();
      const fresh = await runSearch({ q: Q }, { ...deps, store });
      expect(fresh.response.results.length).toBeGreaterThan(0);
      const cached = await runSearch({ q: Q }, { ...deps, store });
      expect(cached.meta.cache).toBe("results");
      const more = await loadMore(fresh.response.filters_key!, 1, { ...deps, store });
      expect(more).not.toBeNull();
      expect(errors.mock.calls.map(([m]) => String(m))).toEqual(
        expect.arrayContaining([
          expect.stringContaining("[search] logSearch failed"),
          expect.stringContaining("[search] logUsage failed"),
        ]),
      );
    } finally {
      errors.mockRestore();
    }
  });
});

describe("loadMore stats", () => {
  it("logs each page served as source 'more' and its explain call as explain_more", async () => {
    const { deps, store } = setup({ ...PARSE, max_price_ils: null });
    const { response } = await runSearch({ q: "כבל USB" }, deps);
    const fk = response.filters_key!;
    store.logs.length = 0;
    store.usage.length = 0;

    const more = await loadMore(fk, 1, deps);
    expect(more?.log).toEqual({
      query: "כבל USB",
      queryNorm: "כבל usb",
      parsed: expect.objectContaining({ product_he: "כבל USB" }),
      resultIds: expect.any(Array),
      cache: "results",
      resultsCount: more?.results.length,
      source: "more",
      categoryId: more?.results[0].category_id,
      listable: false, // never on /searches
      origin: "more",
      without: [],
      sortOverride: null,
      timings: {
        parse_ms: null,
        fetch_ms: null,
        explain_ms: expect.any(Number),
        products_ms: null,
        total_ms: expect.any(Number),
      },
      aliCalls: 0,
      rejected: null,
      failure: null,
      searchUid: expect.any(String),
      shared: false,
      owner: false,
      // Explained without a fallback line: nothing to diagnose.
      diag: null,
    });
    expect(more?.log?.categoryId).toEqual(expect.any(String));
    expect(store.logs).toEqual([more?.log]);
    expect(store.usage.map((u) => u.kind)).toEqual(["explain_more"]);

    await loadMore(fk, 1, deps); // already explained: logged, no LLM call
    expect(store.logs).toHaveLength(2);
    expect(store.usage).toHaveLength(1);

    const past = await loadMore(fk, 99, deps); // an empty page is not logged
    expect(past?.log).toBeNull();
    expect(store.logs).toHaveLength(2);
  });
});

describe("isListableSearch", () => {
  const typed = { source: "search", without: [], typed: true } as const;
  const q = "מנורת לילה לילדים";
  it("lists only a typed search with results and a query without personal details", () => {
    expect(isListableSearch(q, typed, 3)).toBe(true);
    expect(isListableSearch(q, { ...typed, without: ["max"] }, 3)).toBe(false);
    expect(isListableSearch(q, typed, 0)).toBe(false);
    expect(isListableSearch(q, { ...typed, source: "preview" }, 3)).toBe(false);
    expect(isListableSearch(q, { ...typed, source: "more" }, 3)).toBe(false);
    expect(isListableSearch("מנורה, לשלוח ל-dana@example.com", typed, 3)).toBe(false);
  });
  it("never lists a sort change or a query from one of our own links", () => {
    expect(isListableSearch(q, { ...typed, sort: "cheapest" }, 3)).toBe(false);
    expect(isListableSearch(q, { ...typed, sort: "best_value" }, 3)).toBe(false);
    expect(isListableSearch(q, { ...typed, typed: false }, 3)).toBe(false);
  });
});

describe("keywordLadder", () => {
  it("broadens without audience and praise words, then without requirement words", () => {
    expect(
      keywordLadder({
        keywords_en: "kids water bottle leak proof durable",
        product_terms: ["water bottle"],
        requirements: [{ en: "leak proof", alt: [], he: "לא נוזל" }],
        product_he: "בקבוק מים",
        sort_preference: "best_value",
        category_hint: "drinkware bottles",
      }),
    ).toEqual([
      "kids water bottle leak proof durable",
      "water bottle leak proof",
      "water bottle",
      "drinkware bottles",
    ]);
  });

  it("drops the number a birthday preference names once the number-specific keywords find too few", () => {
    const ladder = keywordLadder({
      keywords_en: "sonic 3rd birthday balloons",
      product_terms: ["birthday balloons", "balloons"],
      requirements: [{ en: "sonic", alt: [], he: "סוניק" }],
      preferences: [{ words: agePhrases(3), he: "יום הולדת 3" }],
      product_he: "בלונים ליום הולדת",
      sort_preference: "best_value",
      category_hint: "party balloons",
    });
    expect(ladder[0]).toBe("sonic 3rd birthday balloons");
    // The next broader step keeps the character and the product, without "3rd".
    expect(ladder[1]).toBe("sonic birthday balloons");
    expect(ladder.slice(1).every((k) => !/\b3(?:rd)?\b|number/.test(k))).toBe(true);
    // A number that is part of the product's own name or a requirement stays.
    expect(
      keywordLadder({
        keywords_en: "65w usb c charger",
        product_terms: ["usb c charger"],
        requirements: [{ en: "65w", alt: [], he: "65W" }],
        product_he: "מטען",
        sort_preference: "best_value",
      })[0],
    ).toBe("65w usb c charger");
  });
});

describe("search_log telemetry (origin, timings, calls, uid, failures)", () => {
  it("records how each search was asked for", async () => {
    const { deps, store } = setup();
    await runSearch({ q: Q }, deps);
    await runSearch({ q: Q, arrival: "example" }, deps);
    await runSearch({ q: Q, arrival: "recent" }, deps);
    await runSearch({ q: Q, arrival: "ad" }, deps);
    await runSearch({ q: Q, without: ["max"], sort: "cheapest" }, deps);
    await runSearch({ q: Q, sort: "cheapest" }, deps);
    await runSearch({ q: Q, source: "preview" }, deps);
    expect(store.logs.map((l) => [l.origin, l.listable])).toEqual([
      ["typed", true],
      ["example", false],
      ["recent", false],
      ["ad", false],
      ["chip", false],
      ["sort", false],
      ["preview", false],
    ]);
    expect(store.logs[0]).toMatchObject({ without: [], sortOverride: null });
    expect(store.logs[4]).toMatchObject({ without: ["max"], sortOverride: "cheapest" });
    expect(store.logs[5]).toMatchObject({ without: [], sortOverride: "cheapest" });
  });

  it("times each step that ran and counts every AliExpress call", async () => {
    const { deps, fetchMock } = setup();
    let t = 0;
    const clockMs = () => (t += 5);
    const fresh = await runSearch({ q: Q }, { ...deps, clockMs });
    // One clock reading at the start, two per step, one when the products are ready (before
    // their lines: plan item 15), one when the row is written. Explain and titles run side by
    // side: each starts before the other ends.
    expect(fresh.log.timings).toEqual({
      parse_ms: 5,
      fetch_ms: 5,
      explain_ms: 15,
      titles_ms: 5,
      products_ms: 25,
      total_ms: 50,
    });
    expect(fresh.log.aliCalls).toBe(fetchMock.mock.calls.length);
    expect(fresh.log.aliCalls).toBeGreaterThanOrEqual(1);
    expect(fresh.log.rejected).not.toBeNull();
    expect(fresh.log.rejected).toEqual(fresh.meta.rejected);

    const cached = await runSearch({ q: Q }, { ...deps, clockMs });
    expect(cached.log).toMatchObject({
      aliCalls: 0,
      rejected: null,
      timings: { parse_ms: null, fetch_ms: null, explain_ms: null },
    });
    const refined = await runSearch({ q: Q, without: ["max"] }, { ...deps, clockMs });
    expect(refined.log.timings).toMatchObject({ parse_ms: null, fetch_ms: 5, explain_ms: 15 });
  });

  it("gives every row its own search uid, a random UUID by default", async () => {
    const { deps, store } = setup();
    let n = 0;
    const newSearchUid = () => "uid-" + String(++n);
    const a = await runSearch({ q: Q }, { ...deps, newSearchUid });
    const b = await runSearch({ q: Q }, { ...deps, newSearchUid });
    expect([a.log.searchUid, b.log.searchUid]).toEqual(["uid-1", "uid-2"]);
    const c = await runSearch({ q: Q }, deps);
    expect(c.log.searchUid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(store.logs.every((l) => l.shared === false && l.failure === null)).toBe(true);
  });

  it("logs a search refused by the daily budget as a capacity failure", async () => {
    const { deps, store } = setup();
    await expect(runSearch({ q: Q }, { ...deps, beforeLlmWork: refuse() })).rejects.toMatchObject({
      code: "capacity",
    });
    expect(store.logs).toEqual([
      expect.objectContaining({ failure: "capacity", parsed: null, aliCalls: 0 }),
    ]);
  });

  it("logs the code the server answers with, or no row when it says so", async () => {
    const { deps, store } = setup(null);
    const q = { q: "משהו" };
    await expect(runSearch(q, { ...deps, failureOf: () => "llm" })).rejects.toBeInstanceOf(
      SearchError,
    );
    await expect(runSearch(q, { ...deps, failureOf: () => null })).rejects.toBeInstanceOf(
      SearchError,
    );
    expect(store.logs.map((l) => l.failure)).toEqual(["llm"]);
  });

  it("fails with the original error when the failure row cannot be written", async () => {
    class BrokenLog extends MemoryStore {
      override async logSearch(): Promise<void> {
        throw new Error("search_log is down");
      }
    }
    const { deps } = setup(null);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        runSearch({ q: "משהו" }, { ...deps, store: new BrokenLog() }),
      ).rejects.toMatchObject({ code: "parse_failed" });
    } finally {
      errors.mockRestore();
    }
  });

  it("logs a 'more' page that fails after the result set was found", async () => {
    const { deps, store } = setup({ ...PARSE, max_price_ils: null });
    const { response } = await runSearch({ q: "כבל USB" }, deps);
    store.logs.length = 0;
    await expect(
      loadMore(response.filters_key!, 1, { ...deps, beforeLlmWork: refuse() }),
    ).rejects.toMatchObject({ code: "capacity" });
    expect(store.logs).toEqual([
      expect.objectContaining({
        query: "כבל USB",
        source: "more",
        origin: "more",
        failure: "capacity",
        resultsCount: 0,
        listable: false,
      }),
    ]);
  });
});

describe("searchFailureCode", () => {
  it("maps what the pipeline throws to the codes the server answers with", () => {
    expect(searchFailureCode(new SearchError("parse_failed", "x"))).toBe("parse_failed");
    expect(searchFailureCode(new SearchError("capacity", "x"))).toBe("capacity");
    expect(searchFailureCode(new Error("boom"))).toBe("unavailable");
  });
});

/** product.query request fields, from the form body the client posts. */
const sent = (call: Parameters<typeof fetch>, field: string) =>
  new URLSearchParams(String(call[1]?.body)).get(field);
const queries = (fetchMock: ReturnType<typeof setup>["fetchMock"]) =>
  fetchMock.mock.calls
    .filter((c) => sent(c, "method") === "aliexpress.affiliate.product.query")
    .map((c) => `${sent(c, "keywords")} p${sent(c, "page_no")}`);

/** Few titles of the fixture state 240W, so fewer than 15 pass and the search keeps fetching. */
const PARSE_240W: ParsedQueryRaw = {
  ...PARSE,
  keywords_en: "240w usb cable",
  requirements: [{ en: "240w", alt: [], he: "240W" }],
  max_price_ils: null,
};

const T0 = new Date("2026-09-27T10:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);

/**
 * The line whyFromData builds: feedback and 30-day sales, without a number other listings of the
 * product's shop show too (lib/ranking/shared-numbers.ts), which is not its own.
 */
const dataLine = (r: { shared_numbers?: { feedback: boolean; sales: boolean } }) => {
  const feedback = !r.shared_numbers?.feedback;
  const sales = !r.shared_numbers?.sales;
  if (feedback && sales) return /^[\d.]+% משוב חיובי ו־[\d,]+ נמכרו ב־30 הימים האחרונים\.$/;
  if (feedback) return /^[\d.]+% משוב חיובי\.$/;
  if (sales) return /^[\d,]+ נמכרו ב־30 הימים האחרונים\.$/;
  return /^עבר את הסינון שלנו\.$/;
};

describe("fetch until enough pass (plan item 5)", () => {
  it("stops after one call once TARGET_PASSED (15) pass", async () => {
    const { deps, fetchMock } = setup();
    const { meta } = await runSearch({ q: Q }, deps);
    expect(meta).toMatchObject({ aliCalls: 1, fetchStop: "enough" });
    expect(queries(fetchMock)).toEqual(["usb cable p1"]);
  });

  it("fetches page 2, then broader keywords while fewer than 15 pass, at most MAX_ALI_CALLS calls", async () => {
    const { deps, fetchMock } = setup(PARSE_240W);
    const { meta, response } = await runSearch({ q: "כבל 240W" }, deps);
    expect(queries(fetchMock)).toEqual([
      "240w usb cable p1",
      "240w usb cable p2",
      "240w cable p1",
      "usb cable p1",
    ]);
    expect(meta).toMatchObject({ aliCalls: MAX_ALI_CALLS, fetchStop: "calls" });
    expect(response.results.every((r) => /240w/i.test(r.title_en))).toBe(true);
  });

  it("keeps what it found when a call after the first fails", async () => {
    const { deps, fetchMock, store } = setup(PARSE_240W);
    let n = 0;
    fetchMock.mockImplementation(async () =>
      n++ === 0 ? new Response(PRODUCTS) : new Response("busy", { status: 503 }),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { response, meta, log } = await runSearch({ q: "כבל 240W" }, deps);
      expect(meta).toMatchObject({ aliCalls: 2, fetchStop: "failed" });
      expect(response.results.length).toBeGreaterThan(0);
      expect(log.failure).toBeNull();
      expect(store.results.get(response.filters_key!)?.products.length).toBe(
        response.results.length,
      );
      expect(errors.mock.calls.map(([m]) => String(m))).toEqual([
        expect.stringContaining("[search] product.query 2 failed"),
      ]);
    } finally {
      errors.mockRestore();
    }
  });

  it("starts no call after the first once the fetch step has run FETCH_BUDGET_MS", async () => {
    const { deps, fetchMock } = setup(PARSE_240W);
    let t = T0.getTime();
    const now = () => new Date((t += FETCH_BUDGET_MS));
    const { meta } = await runSearch({ q: "כבל 240W" }, { ...deps, now });
    expect(meta).toMatchObject({ aliCalls: 1, fetchStop: "time" });
    expect(queries(fetchMock)).toHaveLength(1);
  });
});

describe("LLM failures and limits (plan item 7)", () => {
  it("fails a search whose parse call fails with 'llm', not 'upstream', before AliExpress", async () => {
    const { deps, llm, fetchMock, store } = setup();
    llm.failing.add("parse");
    await expect(runSearch({ q: Q }, deps)).rejects.toMatchObject({ code: "llm" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.logs.map((l) => l.failure)).toEqual(["llm"]);
    expect(searchFailureCode(new SearchError("llm", "x"))).toBe("llm");
  });

  it("sends each step's time limit and retries with every call", async () => {
    const { deps, llm } = setup();
    await runSearch({ q: Q }, deps);
    expect(LLM_STAGE_LIMITS).toEqual({
      parse: { timeoutMs: 10_000, maxRetries: 1 },
      explain: { timeoutMs: 10_000, maxRetries: 1 },
      titles: { timeoutMs: 10_000, maxRetries: 1 },
      seoExplain: { timeoutMs: 10_000, maxRetries: 0 },
    });
    expect(llm.limits).toEqual([
      { kind: "parse", ...LLM_STAGE_LIMITS.parse },
      { kind: "explain", ...LLM_STAGE_LIMITS.explain },
      { kind: "titles", ...LLM_STAGE_LIMITS.titles },
    ]);
  });

  it("shows the products with lines from the data when explain fails, and keeps them an hour", async () => {
    const { deps, llm, store } = setup();
    llm.failing.add("explain");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { response, meta } = await runSearch({ q: Q }, { ...deps, now: () => T0 });
      expect(meta.explainFailed).toBe(true);
      expect(response.results.length).toBeGreaterThan(0);
      for (const r of response.results) {
        expect(r.title_he).toBe(r.title_en);
        expect(r.why_he).toMatch(dataLine(r));
      }
      expect(store.results.get(response.filters_key!)?.degraded).toBe(true);
      expect(store.usage.map((u) => u.kind)).toEqual(["parse", "titles"]);
    } finally {
      errors.mockRestore();
    }
    llm.failing.clear();
    const within = await runSearch({ q: Q }, { ...deps, now: () => at(0.9) });
    expect(within.meta.cache).toBe("results");
    const later = await runSearch({ q: Q }, { ...deps, now: () => at(1) });
    expect(later.meta.cache).toBe("parse");
    expect(later.response.results[0].why_he).toBe(WHYS[0]);
  });

  it("shows a 'more' page with lines from the data when explain fails, without saving them", async () => {
    const { deps, llm, store } = setup({ ...PARSE, max_price_ils: null });
    const { response } = await runSearch({ q: "כבל USB" }, deps);
    const fk = response.filters_key!;
    llm.failing.add("explain");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const more = await loadMore(fk, 1, deps);
      expect(more?.results.length).toBeGreaterThan(0);
      for (const r of more!.results) {
        expect(r.why_he).toMatch(dataLine(r));
        expect(store.products.has(r.product_id)).toBe(true); // its /go link works
      }
      // Only the first page's lines: the failed page's are not saved.
      expect(Object.keys(store.results.get(fk)!.explanations)).toHaveLength(RESULTS_PER_PAGE);
    } finally {
      errors.mockRestore();
    }
    llm.failing.clear();
    const again = await loadMore(fk, 1, deps);
    expect(again?.results[0].why_he).toBe(WHYS[0]);
  });
});

describe("zero and partial results (plan items 8 and 12)", () => {
  it("keeps the parse of a search whose own filters found nothing for 48 hours only", async () => {
    const q = "כבל USB עד חצי שקל";
    const { deps, llm, store } = setup({ ...PARSE, max_price_ils: 0.5 });
    await runSearch({ q }, { ...deps, now: () => T0 });
    expect(store.parses.get(queryKey(q))?.at).toEqual(emptyParseCreatedAt(T0));
    expect((await runSearch({ q }, { ...deps, now: () => at(47) })).meta.cache).toBe("results");
    await runSearch({ q }, { ...deps, now: () => at(48) });
    expect(llm.calls).toEqual(["parse", "parse"]);
  });

  it("keeps the parse 14 days when the empty results came with a chip removed", async () => {
    const q = "כבל USB בין 5000 ל־6000 ש״ח";
    const { deps, store } = setup({ ...PARSE, min_price_ils: 5000, max_price_ils: 6000 });
    const { response } = await runSearch({ q, without: ["max"] }, { ...deps, now: () => T0 });
    expect(response.results).toEqual([]);
    expect(store.parses.get(queryKey(q))?.at).toEqual(T0);
  });

  it("says which filter kept the checked products out, and never shows those products", async () => {
    const q = "כבל מגסייף";
    const { deps } = setup({
      ...PARSE,
      requirements: [{ en: "magsafe", alt: [], he: "מגסייף" }],
      max_price_ils: null,
    });
    const { response } = await runSearch({ q }, deps);
    expect(response.results).toEqual([]);
    expect(response.passed_count).toBe(0);
    expect(response.blockers).toEqual([
      { chip_id: "req:magsafe", would_pass: expect.any(Number), title_matches: 0 },
    ]);
    expect(response.blockers![0].would_pass).toBeGreaterThan(0);
    const cached = await runSearch({ q }, deps);
    expect(cached.response).toMatchObject({ cached: true, blockers: response.blockers });
  });

  it("has no blockers once a page passes", async () => {
    const { deps } = setup();
    expect((await runSearch({ q: Q }, deps)).response.blockers).toBeUndefined();
  });

  it("drops a removed requirement's words from the AliExpress keywords", async () => {
    const { deps, fetchMock } = setup({
      ...PARSE,
      keywords_en: "magsafe usb cable",
      requirements: [{ en: "magsafe", alt: ["magnetic"], he: "מגסייף" }],
      max_price_ils: null,
    });
    await runSearch({ q: "כבל מגסייף", without: ["req:magsafe"] }, deps);
    expect(queries(fetchMock)[0]).toBe("usb cable p1");
  });
});

describe("affiliate links (plan item 7)", () => {
  // The fixture without promotion links, and a link.generate answer that brings none back.
  const NO_LINKS = PRODUCTS.replace(/"promotion_link": "[^"]*"/g, '"promotion_link": ""');
  const EMPTY_LINKS = JSON.stringify({
    aliexpress_affiliate_link_generate_response: {
      resp_result: {
        result: { total_result_count: 0, promotion_links: { promotion_link: [] } },
        resp_code: 200,
        resp_msg: "Call succeeds",
      },
    },
  });

  function unlinked() {
    const { deps, store } = setup();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const method = new URLSearchParams(String(init?.body)).get("method");
      return new Response(method === "aliexpress.affiliate.link.generate" ? EMPTY_LINKS : NO_LINKS);
    });
    const ali = new AliExpressClient(
      { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
      { fetch: fetchMock, sleep: async () => {} },
    );
    const gaps: number[] = [];
    const sleep = async (ms: number) => {
      gaps.push(ms);
    };
    return { deps: { ...deps, ali, sleep, aliSpacingMs: 1_100 }, store, fetchMock, gaps };
  }

  it("fails as upstream, never as 'none passed', when no product that passed can be linked", async () => {
    const { deps, store } = unlinked();
    await expect(runSearch({ q: Q }, deps)).rejects.toMatchObject({ code: "upstream" });
    expect(store.results.size).toBe(0);
    expect(store.logs[0]).toMatchObject({ failure: "upstream", resultsCount: 0 });
  });

  it("waits the AliExpress gap before link.generate too", async () => {
    const { deps, store, fetchMock, gaps } = unlinked();
    await expect(runSearch({ q: Q }, deps)).rejects.toThrow();
    const methods = fetchMock.mock.calls.map((c) => sent(c, "method"));
    expect(methods.at(-1)).toBe("aliexpress.affiliate.link.generate");
    // One gap before every call after the first, link.generate included.
    expect(gaps).toEqual(Array(methods.length - 1).fill(1_100));
    expect(store.logs[0].aliCalls).toBe(methods.length);
  });
});

describe("search_log owner and diag (plan item 10)", () => {
  it("logs the owner's search with owner true and lists a typed one like anyone's", async () => {
    // Owner decision 2026-09-29: owner keeps the row out of the stats only.
    const { deps, store } = setup();
    await runSearch({ q: Q, owner: true }, deps);
    expect(store.logs[0]).toMatchObject({ owner: true, listable: true });
    await runSearch({ q: Q }, deps);
    expect(store.logs[1]).toMatchObject({ owner: false, listable: true });
    // Not typed (one of our links): never listed, owner or not.
    await runSearch({ q: Q, owner: true, arrival: "recent" }, deps);
    expect(store.logs[2]).toMatchObject({ owner: true, listable: false });
  });

  it("records how a fresh search went, and nothing for a full cache hit", async () => {
    const { deps, store } = setup();
    await runSearch({ q: Q }, deps);
    expect(store.logs[0].diag).toEqual({
      fetch_stop: "enough",
      keywords_tried: ["usb cable"],
      demoted: [],
      explain_failed: false,
      explain_rejected: expect.any(Number),
    });
    await runSearch({ q: Q }, deps);
    expect(store.logs[1].diag).toBeNull();
  });

  it("marks the owner's 'more' page too", async () => {
    const { deps, store } = setup();
    const { response } = await runSearch({ q: Q }, deps);
    await loadMore(response.filters_key!, 1, deps, { owner: true });
    expect(store.logs.at(-1)).toMatchObject({ source: "more", owner: true });
  });
});

describe("stated needs no title can show (plan item 8)", () => {
  it("names them under the chips instead of dropping them silently", async () => {
    const { deps } = setup({
      ...PARSE,
      requirements: [
        { en: "multi-device", alt: ["laptop and phone", "universal"], he: "לטלפון ולמחשב נייד" },
      ],
      max_price_ils: null,
    });
    const { response } = await runSearch({ q: "כבל לטלפון ולמחשב נייד" }, deps);
    expect(response.not_filtered).toEqual(["לטלפון ולמחשב נייד"]);
    expect(response.chips.map((c) => c.id)).toEqual(["product"]);
    expect(response.results.length).toBeGreaterThan(0);
    // A cached answer says it too: the note comes from the parse, like the chips.
    const cached = await runSearch({ q: "כבל לטלפון ולמחשב נייד" }, deps);
    expect(cached.response).toMatchObject({ cached: true, not_filtered: ["לטלפון ולמחשב נייד"] });
  });

  it("adds nothing to a search without them", async () => {
    const { deps } = setup();
    expect((await runSearch({ q: Q }, deps)).response).not.toHaveProperty("not_filtered");
  });
});

describe("products a fetch saves (the similar products of /p)", () => {
  it("saves every kept product in one batch before the cards show, titles only where written", async () => {
    const { deps, store, llm } = setup({ ...PARSE, max_price_ils: null });
    const save = vi.spyOn(store, "saveProducts");
    const { response } = await runSearch({ q: "כבל USB" }, deps);
    const kept = store.results.get(response.filters_key!)!.products.map((p) => p.productId);
    expect(kept.length).toBeGreaterThan(RESULTS_PER_PAGE);
    expect(kept.length).toBeLessThanOrEqual(RESULTS_KEPT);
    // First: every product the fetch kept, with no title (no line was written yet).
    const [first, firstTitles] = save.mock.calls[0];
    expect(first.map((p) => p.productId).sort()).toEqual([...kept].sort());
    expect(Object.values(firstTitles).filter(Boolean)).toEqual([]);
    // Then only the titles written for the first view (the lines' and the titles call's).
    expect(save).toHaveBeenCalledTimes(2);
    const [titled, titles] = save.mock.calls[1];
    expect(titled.map((p) => p.productId)).toEqual(
      [...response.results, ...response.extra_results!].map((r) => r.product_id),
    );
    expect(titled.map((p) => titles[p.productId])).toEqual([
      ...response.results.map(() => "כבל טעינה מהיר"),
      ...response.extra_results!.map(() => "כבל USB לטעינה"),
    ]);
    for (const id of kept.slice(RESULTS_FIRST_VIEW)) {
      expect(store.products.get(id)).toMatchObject({ titleHe: null });
    }
    expect(llm.calls).toEqual(["parse", "explain", "titles"]);
  });

  it("saves nothing more for a cached search", async () => {
    const { deps, store } = setup({ ...PARSE, max_price_ils: null });
    await runSearch({ q: "כבל USB" }, deps);
    const save = vi.spyOn(store, "saveProducts");
    const again = await runSearch({ q: "כבל USB" }, deps);
    expect(again.response.cached).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("the shop cap mode (the admin's setting)", () => {
  it("keys the results by the mode: a switch fetches again instead of serving the other list", async () => {
    const { deps, llm, fetchMock, store } = setup({ ...PARSE, max_price_ils: null });
    const none = await runSearch({ q: "כבל USB" }, { ...deps, shopCap: "none" });
    const calls = fetchMock.mock.calls.length;
    const max2 = await runSearch({ q: "כבל USB" }, { ...deps, shopCap: "max2" });
    expect(max2.response.filters_key).not.toBe(none.response.filters_key);
    expect(max2.meta.cache).toBe("parse");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    expect(llm.calls).toEqual(["parse", "explain", "titles", "explain", "titles"]);
    // Under "max2" no shop has more than 2 products on the first page (one fixture shop has 20).
    const page = (key: string) =>
      store.results
        .get(key)!
        .products.slice(0, RESULTS_PER_PAGE)
        .map((p) => p.shop.id);
    const most = (shops: (string | null)[]) =>
      Math.max(...shops.map((s) => shops.filter((t) => t === s).length));
    expect(most(page(max2.response.filters_key!))).toBeLessThanOrEqual(2);
    expect(most(page(none.response.filters_key!))).toBeGreaterThan(2);
    // The default is "none".
    const plain = await runSearch({ q: "כבל USB" }, deps);
    expect(plain.response).toMatchObject({ cached: true, filters_key: none.response.filters_key });
  });
});

describe("first-page safety net (plan item 2, demoteFlaggedLeads)", () => {
  it("moves a first-page product whose line says it is another product off the first page", async () => {
    const { deps, llm, store } = setup({ ...PARSE, product_he: "כבל טעינה", max_price_ils: null });
    llm.why = (i) =>
      i === 0 ? "אביזר משלים, לא המכשיר עצמו: מארגן לכבלים שעבר את הסינון שלנו." : WHYS[i];
    const { response, meta } = await runSearch({ q: "כבל טעינה" }, deps);
    expect(meta.demoted).toHaveLength(1);
    const [demoted] = meta.demoted!;
    expect(response.results.map((r) => r.product_id)).not.toContain(demoted);
    expect(store.results.get(response.filters_key!)?.products.at(-1)?.productId).toBe(demoted);
    // The product that moved up (the last of the page) gets the sentence from the data, with no
    // extra call.
    const movedUp = response.results[RESULTS_PER_PAGE - 1];
    expect(movedUp.why_he).toMatch(dataLine(movedUp));
    expect(llm.calls).toEqual(["parse", "explain", "titles"]);
    // Saved, so its card on a later page can still go through /go.
    expect(store.products.has(demoted)).toBe(true);
  });
});

describe("shared numbers (owner decision 2026-09-28, lib/ranking/shared-numbers.ts)", () => {
  it("marks the cards of a shop that shares numbers, and explain never gets a shared one", async () => {
    // The fixture holds 20 listings of one shop, every one at exactly 98.0%. Under "max2" the first
    // page shows other shops too (under "none" that shop may fill it).
    const setUp = setup();
    const { llm } = setUp;
    const deps = { ...setUp.deps, shopCap: "max2" as const };
    const generate = vi.spyOn(llm, "generateStructured");
    const { response } = await runSearch({ q: Q }, deps);
    const marked = response.results.filter((r) => r.shared_numbers);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(response.results.length);
    expect(marked.every((r) => r.shared_numbers?.feedback && r.positive_feedback_pct === 98)).toBe(
      true,
    );
    const explain = generate.mock.calls.find(([req]) => req.system === EXPLAIN_SYSTEM)![0];
    type Sent = { positive_feedback_pct: number | null; units_sold_30d: number | null };
    const sent = (JSON.parse(explain.user) as { products: Sent[] }).products;
    response.results.forEach((r, i) => {
      // The card keeps AliExpress's numbers; the model gets each only when it is the product's own.
      expect(r.units_sold).not.toBeNull();
      expect(sent[i].units_sold_30d).toBe(r.shared_numbers?.sales ? null : r.units_sold);
      expect(sent[i].positive_feedback_pct).toBe(
        r.shared_numbers?.feedback ? null : r.positive_feedback_pct,
      );
    });
    // The cached result set keeps the marks for the next visitor.
    const again = await runSearch({ q: Q }, deps);
    expect(again.response.cached).toBe(true);
    expect(again.response.results.map((r) => r.shared_numbers)).toEqual(
      response.results.map((r) => r.shared_numbers),
    );
  });
});
