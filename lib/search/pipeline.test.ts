import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { EXPLAIN_SYSTEM } from "@/lib/llm/explain";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import type { z } from "zod";
import { keywordLadder, loadMore, runSearch, SearchError } from "./pipeline";
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

  it("serves the same query from the 48h cache without any LLM or AliExpress call", async () => {
    const { deps, llm, fetchMock } = setup();
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, deps);
    const callsBefore = fetchMock.mock.calls.length;
    const again = await runSearch({ q: 'כבל usb  עד 40 ש"ח' }, deps);
    expect(again.meta.cache).toBe("results");
    expect(again.response.cached).toBe(true);
    expect(llm.calls).toEqual(["parse", "explain"]);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("expires cache entries after 48 hours", async () => {
    const { deps, llm } = setup();
    const t0 = new Date("2026-09-27T10:00:00Z");
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, now: () => t0 });
    const later = new Date(t0.getTime() + 49 * 3_600_000);
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, now: () => later });
    expect(llm.calls).toEqual(["parse", "explain", "parse", "explain"]);
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
