// The simple search ("חיפוש פשוט", SearchInput.mode "simple"; owner request 2026-10-19).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_FIRST_VIEW, RESULTS_KEPT } from "@/lib/config/site";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import type { z } from "zod";
import { parseMode, searchHref } from "@/lib/search-url";
import { simpleResultsKey } from "./cache-key";
import { CacheMissError, loadMore, runSearch, simpleShowable } from "./pipeline";
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

/** Answers the parse only; any other call fails the test (the simple search writes no lines). */
class ParseOnlyLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-haiku-4-5";
  calls = 0;
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
    this.calls++;
    if (!req.system.includes("Hebrew shopping request")) throw new Error("not a parse call");
    const usage = { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    return { data: PARSE as z.infer<T>, usage, model: this.model };
  }
}

/** A smart search's LLM: the parse, then explain and titles answered with empty lists. */
class SmartLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-haiku-4-5";
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
    const usage = { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const data = req.system.includes("Hebrew shopping request") ? PARSE : { items: [] };
    return { data: data as z.infer<T>, usage, model: this.model };
  }
}

function setup() {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(PRODUCTS));
  const ali = new AliExpressClient(
    { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
    { fetch: fetchMock, sleep: async () => {} },
  );
  const llm = new ParseOnlyLlm();
  const store = new MemoryStore();
  return { deps: { llm, ali, store, sleep: async () => {} }, llm, store, fetchMock };
}

const sent = (call: Parameters<typeof fetch>, field: string) =>
  new URLSearchParams(String(call[1]?.body)).get(field);
const productQueries = (fetchMock: ReturnType<typeof setup>["fetchMock"]) =>
  fetchMock.mock.calls.filter((c) => sent(c, "method") === "aliexpress.affiliate.product.query");

describe("simple search", () => {
  it("makes one product.query for the parse's keywords, in Hebrew by sales, and no line", async () => {
    const { deps, llm, store, fetchMock } = setup();
    const { response, log } = await runSearch({ q: "כבל USB עד 40 ש״ח", mode: "simple" }, deps);

    expect(llm.calls).toBe(1); // the parse only
    const queries = productQueries(fetchMock);
    expect(queries).toHaveLength(1);
    expect(sent(queries[0], "keywords")).toBe("usb cable");
    expect(sent(queries[0], "target_language")).toBe("HE");
    expect(sent(queries[0], "sort")).toBe("LAST_VOLUME_DESC");
    expect(sent(queries[0], "max_sale_price")).toBe("4000");

    expect(response.mode).toBe("simple");
    expect(response.searched_keywords).toBe("usb cable");
    expect(response.results.length).toBeGreaterThan(RESULTS_FIRST_VIEW);
    expect(response.results.length).toBeLessThanOrEqual(RESULTS_KEPT);
    expect(response.extra_results).toEqual([]);
    expect(response.more_available).toBe(false);
    // Nothing on a card says it passed a filter of ours.
    expect(response.results.every((r) => r.passed_tier === null && r.why_he === "")).toBe(true);
    expect(response.results.every((r) => r.shared_numbers === undefined)).toBe(true);
    expect(response.passed_count).toBe(response.results.length);

    // Logged, listed like any search (owner decision 2026-10-19), marked simple; the first view's
    // count, as a smart search counts it.
    expect(log.listable).toBe(true);
    expect(log.origin).toBe("typed");
    expect(log.diag?.simple).toBe(true);
    expect(log.resultsCount).toBe(RESULTS_FIRST_VIEW);
    expect(store.logs).toHaveLength(1);
    // Saved for /p and /go, as AliExpress's Hebrew data (source "hot").
    expect(store.products.size).toBe(response.results.length);
    expect([...store.products.values()].every((r) => r.product.source === "hot")).toBe(true);
    // Cached under its own key, marked simple.
    expect(
      store.results.get(simpleResultsKey({ keywords_en: "usb cable", max_price_ils: 40 })),
    ).toMatchObject({ simple: true });
  });

  it("serves the same simple search again from the cache, with no call", async () => {
    const { deps, llm, fetchMock } = setup();
    await runSearch({ q: "כבל USB עד 40 ש״ח", mode: "simple" }, deps);
    const again = await runSearch({ q: "כבל USB עד 40 ש״ח", mode: "simple" }, deps);
    expect(llm.calls).toBe(1);
    expect(productQueries(fetchMock)).toHaveLength(1);
    expect(again.response.cached).toBe(true);
    expect(again.meta.cache).toBe("results");
  });

  it("never answers a smart search, and is never answered by one", async () => {
    const { deps, store } = setup();
    const simple = await runSearch({ q: "כבל USB עד 40 ש״ח", mode: "simple" }, deps);
    // The smart search's cache holds nothing yet: the simple set is under another key.
    expect([...store.results.keys()]).toEqual([simple.response.filters_key]);
    expect(simple.response.filters_key).toBe(
      simpleResultsKey({ keywords_en: "usb cable", max_price_ils: 40 }),
    );
  });

  it("runs under a smart search as 'more': no LLM with a cached parse, never listed", async () => {
    const { deps, llm } = setup();
    // The smart search parsed the query first.
    await runSearch({ q: "כבל USB עד 40 ש״ח" }, { ...deps, llm: new SmartLlm() });
    const charged: string[] = [];
    const { log } = await runSearch(
      { q: "כבל USB עד 40 ש״ח", mode: "simple", source: "more", typed: false },
      { ...deps, beforeLlmWork: async () => void charged.push("charged") },
    );
    expect(llm.calls).toBe(0);
    expect(charged).toEqual(["charged"]); // the new AliExpress call, once
    expect(log.origin).toBe("more");
    expect(log.listable).toBe(false);
    // Cached now: no new work, nothing charged.
    await runSearch(
      { q: "כבל USB עד 40 ש״ח", mode: "simple", source: "more", typed: false },
      { ...deps, beforeLlmWork: async () => void charged.push("charged") },
    );
    expect(charged).toEqual(["charged"]);
  });

  it("has no 'עוד N': loadMore refuses a simple result set", async () => {
    const { deps } = setup();
    const { response } = await runSearch({ q: "כבל USB עד 40 ש״ח", mode: "simple" }, deps);
    await expect(loadMore(response.filters_key!, 0, deps, { cards: true })).resolves.toBeNull();
  });

  it("serves a crawler only what is cached", async () => {
    const { deps, store, fetchMock } = setup();
    await store.putParse(
      (await import("./cache-key")).queryKey("כבל USB עד 40 ש״ח"),
      "כבל usb עד 40",
      { ...PARSE, min_price_ils: undefined, category_hint: undefined } as never,
    );
    await expect(
      runSearch({ q: "כבל USB עד 40 ש״ח", mode: "simple", cacheOnly: true, bot: true }, deps),
    ).rejects.toBeInstanceOf(CacheMissError);
    expect(productQueries(fetchMock)).toHaveLength(0);
  });
});

describe("simpleShowable", () => {
  const product = (id: string, over: Partial<AliProduct> = {}): AliProduct =>
    ({
      productId: id,
      currency: "ILS",
      category: { firstId: "44", secondId: "100" },
      ...over,
    }) as AliProduct;

  it("keeps AliExpress's order, once per product, ILS only, no excluded category", () => {
    const kept = simpleShowable([
      product("1"),
      product("2", { currency: "USD" }),
      product("1"),
      product("3", { category: { firstId: "66", secondId: "200001508" } } as Partial<AliProduct>),
      product("4"),
    ]);
    expect(kept.map((p) => p.productId)).toEqual(["1", "4"]);
  });

  it("keeps at most RESULTS_KEPT", () => {
    const many = Array.from({ length: RESULTS_KEPT + 7 }, (_, i) => product(String(i)));
    expect(simpleShowable(many)).toHaveLength(RESULTS_KEPT);
  });
});

describe("simple search URLs", () => {
  it("reads mode=simple only", () => {
    expect(parseMode("simple")).toBe("simple");
    expect(parseMode(["simple", "smart"])).toBe("simple");
    expect(parseMode("smart")).toBeUndefined();
    expect(parseMode(undefined)).toBeUndefined();
  });

  it("adds mode=simple to a search link, and nothing for the smart search", () => {
    expect(searchHref({ q: "פופ נארוטו", mode: "simple" })).toBe(
      "/search?q=%D7%A4%D7%95%D7%A4+%D7%A0%D7%90%D7%A8%D7%95%D7%98%D7%95&mode=simple",
    );
    expect(searchHref({ q: "פופ", mode: "smart" })).toBe("/search?q=%D7%A4%D7%95%D7%A4");
  });
});
