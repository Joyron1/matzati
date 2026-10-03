// A search limited to a category (/search?q=…&cat=<first-level id>, owner request 2026-10-03):
// the param sent to product.query, the cache and in-flight keys, the allow-list and the chip.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { productQueryParams } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { EXPLAIN_SYSTEM } from "@/lib/llm/explain";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import { TITLES_SYSTEM } from "@/lib/llm/titles";
import { parseSearchCategory, searchCategoryChip, searchHref } from "@/lib/search-url";
import { canonicalFilters, filtersKey, queryKey } from "./cache-key";
import type { ParsedQuery } from "./filters";
import { runSearch } from "./pipeline";
import { MemoryStore } from "./store";

vi.mock("@/components/pending-navigation", () => ({
  LinkPending: () => null,
  RestoreFocus: () => null,
}));

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
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
    const usage = { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const kind =
      req.system === EXPLAIN_SYSTEM ? "explain" : req.system === TITLES_SYSTEM ? "titles" : "parse";
    this.calls.push(kind);
    if (kind === "parse") return { data: PARSE as z.infer<T>, usage, model: this.model };
    const { products } = JSON.parse(req.user) as { products: { id: string }[] };
    const items = products.map((p, i) => ({
      id: p.id,
      title_he: "כבל טעינה מהיר",
      why_he: `כבל שעבר את הסינון שלנו, עם משוב חיובי גבוה ומכירות רבות ${"א".repeat(i)}.`,
    }));
    return { data: { items } as z.infer<T>, usage, model: this.model };
  }
}

function setup() {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(PRODUCTS));
  const ali = new AliExpressClient(
    { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
    { fetch: fetchMock, sleep: async () => {} },
  );
  const llm = new FakeLlm();
  const store = new MemoryStore();
  return { deps: { llm, ali, store, sleep: async () => {} }, llm, store, fetchMock };
}

/** A field of each product.query request the client posted. */
const productQueries = (fetchMock: ReturnType<typeof setup>["fetchMock"], field: string) =>
  fetchMock.mock.calls
    .map((c) => new URLSearchParams(String(c[1]?.body)))
    .filter((p) => p.get("method") === "aliexpress.affiliate.product.query")
    .map((p) => p.get(field));

const FILTERS: ParsedQuery = {
  product_he: "כבל USB",
  product_terms: ["cable"],
  requirements: [],
  keywords_en: "usb cable",
  max_price_ils: 40,
  sort_preference: "best_value",
};

describe("product.query params", () => {
  it("sends category_ids only for a search limited to a category", () => {
    const q = { keywords: "usb cable" };
    expect(productQueryParams({ ...q, categoryIds: "36" }, "t").category_ids).toBe("36");
    expect("category_ids" in productQueryParams(q, "t")).toBe(false);
    expect("category_ids" in productQueryParams({ ...q, categoryIds: "" }, "t")).toBe(false);
  });
});

describe("the results cache key", () => {
  it("differs with a category, and is what it always was without one", () => {
    const plain = canonicalFilters(FILTERS, "none");
    expect("c" in plain).toBe(false);
    expect(canonicalFilters({ ...FILTERS, category_id: "36" }, "none").c).toBe("36");
    const keys = new Set([
      filtersKey(FILTERS, "none"),
      filtersKey({ ...FILTERS, category_id: "36" }, "none"),
      filtersKey({ ...FILTERS, category_id: "44" }, "none"),
    ]);
    expect(keys.size).toBe(3);
    // An undefined category is no category.
    expect(filtersKey({ ...FILTERS, category_id: undefined }, "none")).toBe(
      filtersKey(FILTERS, "none"),
    );
  });
});

describe("parseSearchCategory (the allow-list)", () => {
  it("accepts a first-level id of a catalog category, and ignores anything else", () => {
    expect(parseSearchCategory("36")).toBe("36");
    expect(parseSearchCategory(["44", "36"])).toBe("44");
    for (const v of ["", "2", "999", "3710", "36 ", " 36", "abc", "200001508", undefined]) {
      expect(parseSearchCategory(v)).toBeUndefined();
    }
  });
});

describe("links and the chip", () => {
  it("keeps the category in a search link, and only a valid one", () => {
    expect(searchHref({ q: "שרשרת", cat: "36" })).toBe(
      `/search?q=${encodeURIComponent("שרשרת")}&cat=36`,
    );
    expect(searchHref({ q: "שרשרת", cat: "999" })).toBe(`/search?q=${encodeURIComponent("שרשרת")}`);
    expect(searchCategoryChip("36")).toBe("בקטגוריה: תכשיטים");
    expect(searchCategoryChip("999")).toBeNull();
    expect(searchCategoryChip(undefined)).toBeNull();
  });

  it("removing the chip is the same search, sort and removed chips, without the category", async () => {
    const { FilterChips, categoryRemovedHref } = await import("@/components/filter-chips");
    const input = { q: "שרשרת", sort: "cheapest" as const, without: ["max"] };
    expect(categoryRemovedHref(input)).toBe(searchHref(input));
    expect(categoryRemovedHref(input)).not.toContain("cat=");
    const html = renderToStaticMarkup(
      createElement(FilterChips, { ...input, cat: "36", chips: [] }),
    );
    expect(html).toContain("בקטגוריה: תכשיטים");
    expect(html).toContain('aria-label="הסרת הסינון: בקטגוריה: תכשיטים"');
    expect(html).toContain(`href="${searchHref(input).replace(/&/g, "&amp;")}"`);
    // The other links of the row keep it.
    expect(html).toContain("cat=36");
  });
});

describe("runSearch limited to a category", () => {
  it("sends category_ids on every product.query call and parses the query as without it", async () => {
    const { deps, store, fetchMock } = setup();
    const { response } = await runSearch({ q: "כבל USB עד 40 ש״ח", category: "44" }, deps);
    const sent = productQueries(fetchMock, "category_ids");
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((v) => v === "44")).toBe(true);
    expect(response.results.length).toBeGreaterThan(0);
    // The stored parse is the query's own: no category in it.
    const parse = await store.getParse(queryKey("כבל USB עד 40 ש״ח"), new Date());
    expect(parse && "category_id" in parse).toBe(false);
    // Logged with the filters (search_log.parsed).
    expect(store.logs.at(-1)?.parsed?.category_id).toBe("44");
  });

  it("never serves the unrestricted results for a category search, or the other way round", async () => {
    const { deps, llm, fetchMock } = setup();
    const q = "כבל USB עד 40 ש״ח";
    const plain = await runSearch({ q }, deps);
    const callsAfterPlain = productQueries(fetchMock, "keywords").length;
    expect(productQueries(fetchMock, "category_ids").every((v) => v === null)).toBe(true);

    const scoped = await runSearch({ q, category: "44" }, deps);
    expect(scoped.response.filters_key).not.toBe(plain.response.filters_key);
    // Fetched anew (no parse call: the parse is reused).
    expect(productQueries(fetchMock, "keywords").length).toBeGreaterThan(callsAfterPlain);
    expect(llm.calls.filter((c) => c === "parse")).toHaveLength(1);

    // Each is then a cache hit of its own.
    const callsBefore = fetchMock.mock.calls.length;
    const again = await runSearch({ q, category: "44" }, deps);
    const plainAgain = await runSearch({ q }, deps);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
    expect(again.response.filters_key).toBe(scoped.response.filters_key);
    expect(plainAgain.response.filters_key).toBe(plain.response.filters_key);
  });
});
