import { describe, expect, it } from "vitest";
import { applyOverrides, buildChips } from "./chips";
import type { ParsedQuery } from "./filters";

const parsed: ParsedQuery = {
  keywords_en: "running earphones",
  product_terms: ["earphones", "earbuds"],
  product_he: "אוזניות לריצה",
  requirements: [{ en: "waterproof", alt: ["water resistant"], he: "עמידות למים" }],
  min_price_ils: 50,
  max_price_ils: 100,
  sort_preference: "best_value",
};

describe("buildChips", () => {
  it("renders product, requirement and price chips, with price text from the numbers", () => {
    expect(buildChips(parsed)).toEqual([
      { id: "product", kind: "keywords", label_he: "אוזניות לריצה", removable: false },
      { id: "req:waterproof", kind: "must_have", label_he: "עמידות למים", removable: true },
      { id: "min", kind: "min_price", label_he: "מ־₪50", removable: true },
      { id: "max", kind: "max_price", label_he: "עד ₪100", removable: true },
    ]);
  });
});

describe("applyOverrides", () => {
  it("drops exactly the removed filters", () => {
    const next = applyOverrides(parsed, ["max", "req:waterproof"]);
    expect(next.max_price_ils).toBeUndefined();
    expect(next.min_price_ils).toBe(50);
    expect(next.requirements).toEqual([]);
    expect(parsed.max_price_ils).toBe(100); // input untouched
  });
  it("ignores unknown ids", () => {
    expect(applyOverrides(parsed, ["nope"])).toEqual(parsed);
  });
});
