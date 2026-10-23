import { describe, expect, it } from "vitest";
import { hotProductQueryParams } from "./affiliate";

describe("hotProductQueryParams with keywords (the search's extra call, 2026-10-24)", () => {
  it("sends the keywords, the price bounds in agorot and the categories", () => {
    const p = hotProductQueryParams(
      {
        keywords: "car phone holder",
        minPriceIls: 20,
        maxPriceIls: 100,
        categoryId: "34,202192403",
        language: "EN",
      },
      "t",
    );
    expect(p).toMatchObject({
      keywords: "car phone holder",
      min_sale_price: 2000,
      max_sale_price: 10000,
      category_ids: "34,202192403",
      target_language: "EN",
      ship_to_country: "IL",
    });
  });

  it("sends neither keywords nor bounds for a hot list", () => {
    const p = hotProductQueryParams({ categoryId: "44" }, "t");
    expect(p).not.toHaveProperty("keywords");
    expect(p).not.toHaveProperty("min_sale_price");
    expect(p).not.toHaveProperty("max_sale_price");
  });
});
