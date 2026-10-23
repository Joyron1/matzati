// Photo and link searches (SearchInput.mode "match"; owner request 2026-10-23).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_FIRST_VIEW } from "@/lib/config/site";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import type { z } from "zod";
import { parseMode, searchHref } from "@/lib/search-url";
import type { ParsedQuery } from "./filters";
import { MATCH_KEPT, matchOrder } from "./match";
import { runSearch } from "./pipeline";
import { MemoryStore } from "./store";

const PRODUCTS = readFileSync(
  "fixtures/aliexpress/aliexpress.affiliate.product.query.json",
  "utf8",
);

function parseLlm(raw: ParsedQueryRaw): LlmProvider {
  return {
    name: "anthropic",
    model: "claude-haiku-4-5",
    // Only the parse may call: no LLM call follows it in a match search.
    async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
      if (!req.system.includes("Hebrew shopping request")) throw new Error("not a parse call");
      const usage = {
        inputTokens: 900,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      return { data: raw as z.infer<T>, usage, model: "claude-haiku-4-5" };
    },
  };
}

const RAW: ParsedQueryRaw = {
  product_he: "כבל USB",
  product_terms: ["cable"],
  requirements: [],
  keywords_en: "usb cable",
  min_price_ils: null,
  max_price_ils: null,
  sort_preference: "best_value",
  category_hint: null,
};

function setup(raw: ParsedQueryRaw = RAW) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(PRODUCTS));
  const ali = new AliExpressClient(
    { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
    { fetch: fetchMock, sleep: async () => {} },
  );
  const store = new MemoryStore();
  return { deps: { llm: parseLlm(raw), ali, store, sleep: async () => {} }, store, fetchMock };
}

const sent = (call: Parameters<typeof fetch>, field: string) =>
  new URLSearchParams(String(call[1]?.body)).get(field);

function product(title: string, o: Partial<AliProduct> = {}): AliProduct {
  return {
    productId: title,
    title,
    price: 20,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 97,
    unitsSold: 500,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: [],
    detailUrl: "https://www.aliexpress.com/item/1.html",
    promotionLink: "https://s.click.aliexpress.com/e/_t",
    shop: { id: null, name: null, url: null },
    commissionRatePct: 5,
    category: { firstId: null, firstName: null, secondId: null, secondName: null },
    ...o,
  };
}

const LAMP: ParsedQuery = {
  keywords_en: "motion sensor night light",
  product_terms: ["night light"],
  requirements: [{ en: "motion sensor", alt: [], he: "חיישן תנועה" }],
  sort_preference: "best_value",
  product_he: "מנורת לילה",
};

describe("matchOrder", () => {
  it("puts exact matches first, the more trusted first, and the others after", () => {
    const list = [
      product("Night Light Warm White"), // no requirement
      product("Motion Sensor Night Light LED", { positiveFeedbackPct: 85, unitsSold: 10 }),
      product("Motion Sensor Night Light Rechargeable"),
      product("Night Light Bulb Holder"), // an accessory: not the product
    ];
    const { products, exactIds } = matchOrder(list, LAMP);
    expect(products.map((p) => p.title)).toEqual([
      "Motion Sensor Night Light Rechargeable",
      "Motion Sensor Night Light LED",
      "Night Light Warm White",
      "Night Light Bulb Holder",
    ]);
    expect([...exactIds]).toEqual([
      "Motion Sensor Night Light Rechargeable",
      "Motion Sensor Night Light LED",
    ]);
  });

  it("shows exact matches only once there are a first view of them, up to MATCH_KEPT", () => {
    const exact = Array.from({ length: 30 }, (_, i) => product(`Motion Sensor Night Light ${i}`));
    const { products } = matchOrder([product("Night Light Plain"), ...exact], LAMP);
    expect(products).toHaveLength(MATCH_KEPT);
    expect(products.some((p) => p.title === "Night Light Plain")).toBe(false);
  });
});

describe("match search", () => {
  it("is its own mode in the URL", () => {
    expect(parseMode("match")).toBe("match");
    expect(searchHref({ q: "x", mode: "match" })).toContain("mode=match");
  });

  it("searches in English, puts exact matches first with their tier, and gets Hebrew titles", async () => {
    const { deps, fetchMock } = setup();
    const { response } = await runSearch({ q: "כבל USB", mode: "match" }, deps);
    const queries = fetchMock.mock.calls.filter(
      (c) => sent(c, "method") === "aliexpress.affiliate.product.query",
    );
    expect(queries).toHaveLength(1);
    expect(sent(queries[0], "target_language")).toBe("EN");
    // One productdetail.get for the cards' Hebrew titles (the fake answers it badly: English kept).
    expect(
      fetchMock.mock.calls.some(
        (c) =>
          sent(c, "method") === "aliexpress.affiliate.productdetail.get" &&
          sent(c, "target_language") === "HE",
      ),
    ).toBe(true);
    expect(response.mode).toBe("simple");
    expect(response.match).toBe(true);
    expect(response.exact_count).toBeGreaterThan(0);
    expect(response.results.length).toBeLessThanOrEqual(MATCH_KEPT);
    const exact = response.results.slice(0, response.exact_count);
    expect(exact.every((r) => r.passed_tier !== undefined)).toBe(true);
    expect(response.results.slice(response.exact_count).every((r) => r.passed_tier === null)).toBe(
      true,
    );
  });

  it("never shares a cached set with the simple search of the same query", async () => {
    const { deps } = setup();
    const simple = await runSearch({ q: "כבל USB", mode: "simple" }, deps);
    const match = await runSearch({ q: "כבל USB", mode: "match" }, deps);
    expect(match.response.filters_key).not.toBe(simple.response.filters_key);
    expect(match.response.cached).toBe(false);
    const again = await runSearch({ q: "כבל USB", mode: "match" }, deps);
    expect(again.response.cached).toBe(true);
    expect(again.response.exact_count).toBe(match.response.exact_count);
  });

  it("lists the others after the exact matches when there are few", async () => {
    // A requirement almost no USB cable title states.
    const { deps } = setup({
      ...RAW,
      requirements: [{ en: "magnetic", alt: [], he: "מגנטי" }],
    });
    const { response } = await runSearch({ q: "כבל USB מגנטי", mode: "match" }, deps);
    expect(response.exact_count).toBeLessThan(RESULTS_FIRST_VIEW);
    expect(response.results.length).toBeGreaterThan(response.exact_count ?? 0);
  });
});
