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

  it("drops a removed requirement's words from the AliExpress keywords", () => {
    const earbuds: ParsedQuery = {
      ...parsed,
      keywords_en: "waterproof running earbuds",
      product_terms: ["running earbuds", "sports earbuds"],
      requirements: [{ en: "waterproof", alt: ["water resistant", "ipx"], he: "עמידות למים" }],
    };
    expect(applyOverrides(earbuds, ["req:waterproof"]).keywords_en).toBe("running earbuds");
    // A price chip leaves the keywords alone.
    expect(applyOverrides(earbuds, ["max"]).keywords_en).toBe("waterproof running earbuds");
  });

  it("keeps words a kept requirement or the product's own name uses", () => {
    const holder: ParsedQuery = {
      ...parsed,
      keywords_en: "magnetic wireless charging car phone holder",
      product_terms: ["car phone holder"],
      requirements: [
        { en: "wireless charging", alt: ["qi charging"], he: "טעינה אלחוטית" },
        { en: "magnetic", alt: ["magsafe charging"], he: "מגנטי" },
      ],
    };
    const next = applyOverrides(holder, ["req:magnetic"]);
    expect(next.keywords_en).toBe("wireless charging car phone holder");
    // "charging" stays: the kept requirement's "magsafe charging" uses it.
    expect(applyOverrides(holder, ["req:wireless charging"]).keywords_en).toBe(
      "magnetic charging car phone holder",
    );
  });

  it("searches the product's main phrase when fewer than 2 words are left", () => {
    const watch: ParsedQuery = {
      ...parsed,
      keywords_en: "smartwatch heart rate",
      product_terms: ["smartwatch", "smart watch"],
      requirements: [{ en: "heart rate monitor", alt: ["heart rate"], he: "מד דופק" }],
    };
    expect(applyOverrides(watch, ["req:heart rate monitor"]).keywords_en).toBe("smartwatch");
  });
});
