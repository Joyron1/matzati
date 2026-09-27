import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { EXPLAIN_SYSTEM } from "@/lib/llm/explain";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import type { z } from "zod";
import { isListableSearch, keywordLadder, loadMore, runSearch, SearchError } from "./pipeline";
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

class FakeLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-haiku-4-5";
  calls: string[] = [];
  constructor(private parse: ParsedQueryRaw | null = PARSE) {}
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
    const usage = { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    if (req.system === EXPLAIN_SYSTEM) {
      this.calls.push("explain");
      const { products } = JSON.parse(req.user) as { products: { id: string }[] };
      const items = products.map((p) => ({
        id: p.id,
        title_he: "כבל טעינה מהיר",
        why_he: "עבר את הסינון עם משוב חיובי גבוה ומכירות רבות בחודש האחרון.",
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
  it("parses, fetches, ranks, explains and returns at most 3 grounded results", async () => {
    const { deps, llm, fetchMock } = setup();
    const { response, meta } = await runSearch({ q: "כבל USB עד 40 ש״ח" }, deps);
    expect(llm.calls).toEqual(["parse", "explain"]);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(meta.cache).toBe("none");
    expect(response.results.length).toBeGreaterThan(0);
    expect(response.results.length).toBeLessThanOrEqual(3);
    for (const r of response.results) {
      expect(r.price_ils).toBeLessThanOrEqual(40);
      expect(r.positive_feedback_pct).toBeGreaterThanOrEqual(90);
      expect(r.units_sold).toBeGreaterThanOrEqual(100);
      expect(r.title_en.toLowerCase()).toContain("cable");
    }
    expect(response.chips.map((c) => c.label_he)).toEqual(["כבל USB", "עד ₪40"]);
  });

  it("serves the same query from the 14-day cache without any LLM or AliExpress call", async () => {
    const { deps, llm, fetchMock } = setup();
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, deps);
    const callsBefore = fetchMock.mock.calls.length;
    const again = await runSearch({ q: 'כבל usb  עד 40 ש"ח' }, deps);
    expect(again.meta.cache).toBe("results");
    expect(again.response.cached).toBe(true);
    expect(llm.calls).toEqual(["parse", "explain"]);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("expires cache entries after 14 days", async () => {
    const { deps, llm } = setup();
    const t0 = new Date("2026-09-27T10:00:00Z");
    const after = (hours: number) => new Date(t0.getTime() + hours * 3_600_000);
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, now: () => t0 });
    const cached = await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, now: () => after(335) });
    expect(cached.meta.cache).toBe("results");
    expect(llm.calls).toEqual(["parse", "explain"]);
    const fresh = await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, now: () => after(336) });
    expect(fresh.meta.cache).toBe("none");
    expect(llm.calls).toEqual(["parse", "explain", "parse", "explain"]);
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
    expect(llm.calls).toEqual(["parse", "explain", "explain"]);
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
    // The search saves fresh data (now); the page from the 5-day-old cache keeps the cache's time.
    expect(store.savedAt).toEqual([null, t0.toISOString()]);
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
    expect(llm.calls).toEqual(["parse", "explain"]);
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
    expect(llm.calls).toEqual(["parse", "explain"]);
  });
});

describe("sort override", () => {
  it("changes the filters key and reuses the parse", async () => {
    const { deps, llm } = setup();
    const first = await runSearch({ q: Q }, deps);
    const cheapest = await runSearch({ q: Q, sort: "cheapest" }, deps);
    expect(cheapest.meta.cache).toBe("parse");
    expect(llm.calls).toEqual(["parse", "explain", "explain"]);
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
      resultsCount: fresh.response.results.length,
    });
    expect(first.resultsCount).toBeGreaterThan(0);
    expect(first.resultIds.length).toBeGreaterThanOrEqual(first.resultsCount);
    expect(first.parsed.max_price_ils).toBe(40);
    // The cache hit logs its own spelling and the same results.
    expect(second).toMatchObject({ query: 'כבל usb  עד 40 ש"ח', queryNorm: first.queryNorm });
    expect(second.resultIds).toEqual(first.resultIds);
    expect(cached.log).toEqual(second);
    expect(refined.log.parsed.max_price_ils).toBeUndefined();
    // Never anything about the visitor.
    for (const log of store.logs) {
      expect(Object.keys(log).sort()).toEqual(
        [
          "cache",
          "categoryId",
          "listable",
          "parsed",
          "query",
          "queryNorm",
          "resultIds",
          "resultsCount",
          "source",
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

  it("logs nothing for a search that fails", async () => {
    const { deps, store } = setup(null);
    await expect(runSearch({ q: "משהו" }, deps)).rejects.toMatchObject({ code: "parse_failed" });
    expect(store.logs).toEqual([]);
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
    ]);
    await runSearch({ q: Q }, deps); // full cache hit: no LLM call, no usage row
    expect(store.usage).toHaveLength(2);
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
    expect(store.logs).toEqual([]);
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
  it("falls back to shorter keywords without requirement or filler words", () => {
    expect(
      keywordLadder({
        ...PARSE,
        keywords_en: "kids water bottle leak proof durable",
        product_terms: ["water bottle"],
        requirements: [{ en: "leak proof", alt: [], he: "לא נוזל" }],
        product_he: "בקבוק מים",
        min_price_ils: undefined,
        max_price_ils: undefined,
        category_hint: "drinkware bottles",
      }),
    ).toEqual(["kids water bottle leak proof durable", "kids water bottle", "drinkware bottles"]);
  });
});
