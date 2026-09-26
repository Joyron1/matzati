import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvelope, parseJsonKeepingIds } from "./client";
import {
  parseAmount,
  parseCategories,
  parsePercent,
  parseProductPage,
  parsePromotionLinks,
  productSchema,
} from "./schemas";

function fixtureResult(method: string) {
  const text = readFileSync(`fixtures/aliexpress/${method}.json`, "utf8");
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
});
