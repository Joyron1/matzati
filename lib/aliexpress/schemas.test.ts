import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvelope, parseJsonKeepingIds } from "./client";
import {
  affiliateUrl,
  mediaUrl,
  positivePercent,
  parseAmount,
  parseCategories,
  parsePercent,
  parseProductPage,
  parsePromotionLinks,
  parseSkuDetails,
  productSchema,
} from "./schemas";

function fixtureResult(method: string, file = method) {
  const text = readFileSync(`fixtures/aliexpress/${file}.json`, "utf8");
  return parseEnvelope(method, parseJsonKeepingIds(text)).result;
}

describe("parsePercent / parseAmount", () => {
  it("parses AliExpress strings", () => {
    expect(parsePercent("97.2%")).toBe(97.2);
    expect(parsePercent("50%")).toBe(50);
    expect(parsePercent("")).toBeNull();
    expect(parsePercent(undefined)).toBeNull();
    expect(parseAmount("183.70")).toBe(183.7);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("-1")).toBeNull();
  });
});

describe("product.query fixture", () => {
  const result = fixtureResult("aliexpress.affiliate.product.query") as {
    current_record_count: number;
  };
  const page = parseProductPage(result);

  it("parses every product in the real response", () => {
    expect(page.products.length).toBeGreaterThan(0);
    expect(page.products).toHaveLength(Number(result.current_record_count));
    expect(page.skipped).toBe(0);
    expect(page.totalRecords).toBeGreaterThan(0);
  });

  it("keeps ids as exact strings and prices in ILS", () => {
    for (const p of page.products) {
      expect(p.productId).toMatch(/^\d{10,}$/);
      expect(p.currency).toBe("ILS");
      expect(p.price).toBeGreaterThan(0);
      expect(p.imageUrls[0]).toBe(p.mainImageUrl);
      expect(p.promotionLink).toMatch(/^https:\/\/s\.click\.aliexpress\.com\//);
    }
  });

  it("maps trust signals from evaluate_rate and lastest_volume", () => {
    const p = page.products[0];
    expect(p.positiveFeedbackPct).toBeGreaterThan(0);
    expect(p.positiveFeedbackPct).toBeLessThanOrEqual(100);
    expect(p.unitsSold).toBeGreaterThan(0);
  });
});

describe("productdetail.get fixture", () => {
  it("parses the product with ILS prices", () => {
    const page = parseProductPage(fixtureResult("aliexpress.affiliate.productdetail.get"));
    expect(page.products).toHaveLength(1);
    expect(page.products[0].currency).toBe("ILS");
  });
});

describe("category.get fixture", () => {
  it("parses the flat two-level category list", () => {
    const cats = parseCategories(fixtureResult("aliexpress.affiliate.category.get"));
    expect(cats.length).toBeGreaterThan(100);
    expect(cats.some((c) => c.parentId === null)).toBe(true);
    expect(cats.some((c) => c.parentId !== null)).toBe(true);
  });
});

describe("link.generate fixture", () => {
  it("returns a promotion link per source value", () => {
    const links = parsePromotionLinks(fixtureResult("aliexpress.affiliate.link.generate"));
    expect(links).toHaveLength(1);
    expect(links[0].promotionLink).toMatch(/^https:\/\/s\.click\.aliexpress\.com\//);
  });
});

describe("productSchema edge cases", () => {
  const base = {
    product_id: "1005000000000001",
    product_title: "x",
    target_sale_price: "10.00",
    target_sale_price_currency: "ILS",
    product_main_image_url: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    product_detail_url: "https://he.aliexpress.com/item/1005000000000001.html",
  };

  it("treats missing or empty trust fields as null, never zero", () => {
    const p = productSchema.parse({ ...base, evaluate_rate: "" });
    expect(p.positiveFeedbackPct).toBeNull();
    expect(p.unitsSold).toBeNull();
    expect(p.promotionLink).toBeNull();
  });

  it("drops an original price that is not above the sale price", () => {
    expect(
      productSchema.parse({ ...base, target_original_price: "9.00" }).originalPrice,
    ).toBeNull();
    expect(productSchema.parse({ ...base, target_original_price: "20.00" }).originalPrice).toBe(20);
  });

  it("rejects products without a usable price", () => {
    expect(productSchema.safeParse({ ...base, target_sale_price: "" }).success).toBe(false);
  });

  it("skips malformed items instead of failing the page", () => {
    const page = parseProductPage({ products: { product: [base, { product_id: "1" }] } });
    expect(page.products).toHaveLength(1);
    expect(page.skipped).toBe(1);
  });

  it("reads a missing video and promo code as null, and a bad one never sinks the product", () => {
    expect(productSchema.parse(base)).toMatchObject({ videoUrl: null, promoCode: null });
    const odd = productSchema.parse({
      ...base,
      product_video_url: { url: "x" },
      promo_code_info: "AJO7RM0ITRX2",
    });
    expect(odd).toMatchObject({ productId: base.product_id, videoUrl: null, promoCode: null });
  });
});

describe("product videos (probe of 2026-09-28)", () => {
  const page = parseProductPage(
    fixtureResult(
      "aliexpress.affiliate.productdetail.get",
      "probe-extras/aliexpress.affiliate.productdetail.get.fields",
    ),
  );

  it('keeps a real video URL and reads "" as none', () => {
    const byId = Object.fromEntries(page.products.map((p) => [p.productId, p.videoUrl]));
    expect(byId).toEqual({
      "1005006338829917": null,
      "1005006861238003":
        "https://video.aliexpress-media.com/play/u/ae_sg_item/2673771774/p/1/e/6/t/10301/1100149788409.mp4",
    });
  });

  it("accepts only https on *.aliexpress-media.com", () => {
    const mp4 = "https://video.aliexpress-media.com/play/u/1.mp4";
    expect(mediaUrl(mp4)).toBe(mp4);
    expect(mediaUrl(` ${mp4} `)).toBe(mp4);
    expect(mediaUrl("http://video.aliexpress-media.com/play/u/1.mp4")).toBeNull();
    expect(mediaUrl("https://video.aliexpress-media.com.evil.test/1.mp4")).toBeNull();
    expect(mediaUrl("https://aliexpress-media.com/1.mp4")).toBeNull();
    expect(mediaUrl("https://example.com/1.mp4")).toBeNull();
    expect(mediaUrl("javascript:alert(1)")).toBeNull();
    expect(mediaUrl("")).toBeNull();
    expect(mediaUrl(42)).toBeNull();
  });
});

describe("hot commission rate (probe of 2026-09-28)", () => {
  const hot = parseProductPage(
    fixtureResult(
      "aliexpress.affiliate.hotproduct.query",
      "probe-hot/aliexpress.affiliate.hotproduct.query.cat44-HE",
    ),
  ).products;

  it("reads hot_product_commission_rate of hot products as a number", () => {
    expect(hot).toHaveLength(46);
    for (const p of hot) {
      expect(p.hotCommissionRatePct).toBeGreaterThanOrEqual(3.5);
      expect(p.hotCommissionRatePct).toBeLessThanOrEqual(15);
    }
    // The probe: the hot rate was higher on 44 of these 46.
    const higher = hot.filter((p) => p.hotCommissionRatePct! > (p.commissionRatePct ?? 0));
    expect(higher).toHaveLength(44);
  });

  it('reads "0.0%" (product.query, productdetail.get) and a missing rate as null', () => {
    const query = parseProductPage(fixtureResult("aliexpress.affiliate.product.query")).products;
    expect(query.length).toBeGreaterThan(0);
    expect(query.every((p) => p.hotCommissionRatePct === null)).toBe(true);
    const detail = parseProductPage(fixtureResult("aliexpress.affiliate.productdetail.get"));
    expect(detail.products[0].hotCommissionRatePct).toBeNull();
    const base = {
      product_id: "1",
      product_title: "x",
      target_sale_price: "10.00",
      target_sale_price_currency: "ILS",
      product_main_image_url: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
      product_detail_url: "https://he.aliexpress.com/item/1.html",
    };
    expect(productSchema.parse(base).hotCommissionRatePct).toBeNull();
    expect(
      productSchema.parse({ ...base, hot_product_commission_rate: "" }).hotCommissionRatePct,
    ).toBeNull();
    expect(
      productSchema.parse({ ...base, hot_product_commission_rate: "9.5%" }).hotCommissionRatePct,
    ).toBe(9.5);
    expect(positivePercent("0.0%")).toBeNull();
    expect(positivePercent("-1%")).toBeNull();
    expect(positivePercent("8.0%")).toBe(8);
  });

  it("never sets a link type or source: those are ours", () => {
    for (const p of hot) {
      expect(p.promotionLinkType).toBeUndefined();
      expect(p.promotionLinkAt).toBeUndefined();
      expect(p.source).toBeUndefined();
    }
  });
});

describe("affiliateUrl", () => {
  it("accepts only https links on aliexpress.com and its subdomains, serialized", () => {
    const link = "https://s.click.aliexpress.com/e/_c2yIJ7i5";
    expect(affiliateUrl(link)).toBe(link);
    expect(affiliateUrl(` ${link} `)).toBe(link);
    expect(affiliateUrl("https://aliexpress.com/item/1.html")).toBe(
      "https://aliexpress.com/item/1.html",
    );
    expect(affiliateUrl("http://s.click.aliexpress.com/e/_x")).toBeNull();
    expect(affiliateUrl("https://s.click.aliexpress.com.evil.test/e/_x")).toBeNull();
    expect(affiliateUrl("https://evilaliexpress.com/e/_x")).toBeNull();
    expect(affiliateUrl("https://evil.test/redirect")).toBeNull();
    expect(affiliateUrl("javascript:alert(1)")).toBeNull();
    expect(affiliateUrl("")).toBeNull();
    expect(affiliateUrl(null)).toBeNull();
    // Serialized: a raw non-Latin-1 character would make a Location header throw.
    expect(affiliateUrl("https://s.click.aliexpress.com/e/_ק")).toBe(
      "https://s.click.aliexpress.com/e/_%D7%A7",
    );
  });
});

describe("promo codes (featuredpromo.products.get, 2026-09-28)", () => {
  const page = parseProductPage(
    fixtureResult(
      "aliexpress.affiliate.featuredpromo.products.get",
      "probe-extras/aliexpress.affiliate.featuredpromo.products.get",
    ),
  );

  it("parses every product and attaches the one promo code to its product", () => {
    expect(page.products).toHaveLength(5);
    expect(page.skipped).toBe(0);
    const withCode = page.products.filter((p) => p.promoCode);
    expect(withCode).toHaveLength(1);
    expect(withCode[0].promoCode).toMatchObject({
      code: "AJO7RM0ITRX2",
      offer: { kind: "amount", off: 3.11, minSpend: 62.2, currency: "ILS" },
    });
    expect(page.products.filter((p) => p.videoUrl)).toHaveLength(3);
  });
});

// Hand-written from the documented fields and demo response of product.sku.detail.get (doc 1795,
// read 2026-09-28). NOT a live response: the app has no permission for the method yet.
const DOCUMENTED_SKU_RESULT = {
  result: {
    ae_item_info: {
      product_id: "1005004757833857",
      title: "Documented demo title",
      review_number: "2",
      product_score: "5.0",
      brand: "FLHJLWOC",
      original_link: "https://de.aliexpress.com/item/1005004757833857.html",
    },
    ae_item_sku_info: [
      {
        sku_id: "12000030358585276",
        color: "WHITE",
        size: "S",
        sku_image_link: "https://ae-pic-a1.aliexpress-media.com/kf/white.jpg",
        sale_price_with_tax: "17.19",
        price_with_tax: "22.32",
        discount_rate: "22",
        currency: "ILS",
        min_delivery_days: "3",
        max_delivery_days: "7",
        delivery_days: "5",
        ship_from_country: "CN",
        shipping_fees: "20.03",
        tax_rate: "0.190000",
        link: "https://de.aliexpress.com/item/1005004757833857.html",
        sku_properties: '[{"Color": "WHITE"}]',
      },
      {
        sku_id: "12000030358585277",
        color: "BLACK",
        size: "M",
        sku_image_link: "http://insecure.example/black.jpg",
        sale_price_with_tax: "",
        currency: "ILS",
        min_delivery_days: "4.5",
        max_delivery_days: "9",
        ship_from_country: "",
      },
      { color: "no sku id" },
    ],
  },
  code: "200",
  success: "true",
};

describe("parseSkuDetails (documented shape, not live)", () => {
  const ID = "1005004757833857";

  it("maps the documented fields and never keeps the per-SKU link", () => {
    const details = parseSkuDetails(DOCUMENTED_SKU_RESULT, ID);
    expect(details).toEqual({
      reviewCount: 2,
      score: 5,
      skus: [
        {
          skuId: "12000030358585276",
          color: "WHITE",
          size: "S",
          imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/white.jpg",
          price: 17.19,
          currency: "ILS",
          minDeliveryDays: 3,
          maxDeliveryDays: 7,
          shipFrom: "CN",
        },
        {
          skuId: "12000030358585277",
          color: "BLACK",
          size: "M",
          imageUrl: null,
          price: null,
          currency: "ILS",
          minDeliveryDays: null,
          maxDeliveryDays: 9,
          shipFrom: null,
        },
      ],
    });
    expect(JSON.stringify(details)).not.toContain("de.aliexpress.com");
  });

  it("accepts the inner result, a one-item ae_item_info array and a wrapped SKU list", () => {
    const inner = DOCUMENTED_SKU_RESULT.result;
    expect(parseSkuDetails(inner, ID)?.skus).toHaveLength(2);
    const variant = {
      ae_item_info: [inner.ae_item_info],
      ae_item_sku_info: { traffic_sku_info_list: inner.ae_item_sku_info },
    };
    expect(parseSkuDetails(variant, ID)?.reviewCount).toBe(2);
    expect(parseSkuDetails(variant, ID)?.skus).toHaveLength(2);
  });

  it("returns null for another product, no SKUs or junk", () => {
    expect(parseSkuDetails(DOCUMENTED_SKU_RESULT, "1005000000000001")).toBeNull();
    expect(parseSkuDetails({ result: { ae_item_sku_info: [] } }, ID)).toBeNull();
    expect(parseSkuDetails(undefined, ID)).toBeNull();
    expect(parseSkuDetails("nope", ID)).toBeNull();
  });
});
