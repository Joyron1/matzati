import { describe, expect, it, vi } from "vitest";
import { chunk, generateLinks, productQueryParams, queryProducts, toMinorUnits } from "./affiliate";
import { AliExpressClient } from "./client";

const config = {
  appKey: "k",
  appSecret: "secret",
  trackingId: "trk",
  gateway: "https://g.test/sync",
};

function clientReturning(bodies: unknown[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const b of bodies) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(b)));
  return {
    client: new AliExpressClient(config, { fetch: fetchMock, sleep: async () => {} }),
    fetchMock,
  };
}

const sentFields = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, call = 0) =>
  new URLSearchParams(String(fetchMock.mock.calls[call][1]?.body));

describe("toMinorUnits", () => {
  it("converts shekels to agorot", () => {
    expect(toMinorUnits(100)).toBe(10000);
    expect(toMinorUnits(99.99)).toBe(9999);
    expect(toMinorUnits(undefined)).toBeUndefined();
    expect(toMinorUnits(-5)).toBeUndefined();
  });
});

describe("productQueryParams", () => {
  it("allows Hebrew titles on request and omits unset price bounds", () => {
    const p = productQueryParams({ keywords: "x", language: "HE", minPriceIls: 20 }, "trk");
    expect(p.target_language).toBe("HE");
    expect(p.min_sale_price).toBe(2000);
    expect(p.max_sale_price).toBeUndefined();
  });
  it("caps page size at 50", () => {
    expect(productQueryParams({ keywords: "x", pageSize: 200 }, "trk").page_size).toBe(50);
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
});

describe("queryProducts", () => {
  it("sends ILS/HE/IL, the tracking id and prices in agorot", async () => {
    const { client, fetchMock } = clientReturning([
      {
        aliexpress_affiliate_product_query_response: {
          resp_result: { resp_code: 200, result: { products: { product: [] } } },
        },
      },
    ]);
    await queryProducts(client, { keywords: "usb cable", maxPriceIls: 100 });
    const f = sentFields(fetchMock);
    expect(f.get("target_currency")).toBe("ILS");
    // EN keeps the original English title for the must_have check (CLAUDE.md §6.5).
    expect(f.get("target_language")).toBe("EN");
    expect(f.get("ship_to_country")).toBe("IL");
    expect(f.get("tracking_id")).toBe("trk");
    expect(f.get("max_sale_price")).toBe("10000");
    expect(f.has("min_sale_price")).toBe(false);
    expect(f.get("sort")).toBe("LAST_VOLUME_DESC");
    expect(f.get("page_size")).toBe("50");
  });

  it("turns resp_code 405 into an empty page", async () => {
    const { client } = clientReturning([
      {
        aliexpress_affiliate_product_query_response: {
          resp_result: { resp_code: 405, resp_msg: "The result is empty" },
        },
      },
    ]);
    await expect(queryProducts(client, { keywords: "zzzz" })).resolves.toEqual({
      products: [],
      skipped: 0,
      totalRecords: 0,
    });
  });
});

describe("generateLinks", () => {
  it("dedupes and batches source values by 50", async () => {
    const ok = {
      aliexpress_affiliate_link_generate_response: {
        resp_result: { resp_code: 200, result: { promotion_links: { promotion_link: [] } } },
      },
    };
    const { client, fetchMock } = clientReturning([ok, ok]);
    const urls = Array.from({ length: 60 }, (_, i) => `https://he.aliexpress.com/item/${i}.html`);
    await generateLinks(client, [...urls, urls[0]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentFields(fetchMock, 0).get("source_values")!.split(",")).toHaveLength(50);
    expect(sentFields(fetchMock, 1).get("source_values")!.split(",")).toHaveLength(10);
    expect(sentFields(fetchMock, 0).get("promotion_link_type")).toBe("0");
  });
});
