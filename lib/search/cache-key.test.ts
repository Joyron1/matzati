import { describe, expect, it } from "vitest";
import { filtersKey, isFresh, normalizeQuery, queryKey } from "./cache-key";
import type { SearchFilters } from "./filters";

describe("normalizeQuery", () => {
  it("unifies currency spellings and number position", () => {
    const forms = [
      "אוזניות לריצה, עמידות למים, עד 100 ש״ח",
      'אוזניות לריצה עמידות למים עד 100 ש"ח',
      "אוזניות לריצה  עמידות למים עד ₪100",
      "אוזניות לריצה עמידות למים עד 100 שקל",
      "אוזניות לריצה עמידות למים עד 100 שח.",
    ];
    const normalized = new Set(forms.map(normalizeQuery));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe("אוזניות לריצה עמידות למים עד ₪100");
  });

  it("removes niqqud and case differences", () => {
    expect(normalizeQuery("שָׁעוֹן חכם")).toBe(normalizeQuery("שעון חכם"));
    expect(normalizeQuery("USB-C Cable")).toBe(normalizeQuery("usb c cable"));
  });

  it("keeps meaningful differences apart", () => {
    expect(queryKey("עד 100 ש״ח")).not.toBe(queryKey("עד 150 ש״ח"));
    expect(queryKey("אוזניות לריצה")).not.toBe(queryKey("אוזניות לשחייה"));
    expect(queryKey("מ־50 ש״ח")).not.toBe(queryKey("עד 50 ש״ח"));
  });
});

describe("filtersKey", () => {
  const base: SearchFilters = {
    keywords_en: "running earphones waterproof",
    product_terms: ["earphones", "earbuds"],
    requirements: [{ en: "waterproof", alt: ["water resistant"], he: "עמידות למים" }],
    max_price_ils: 100,
    sort_preference: "best_value",
  };

  it("ignores order, case, hyphens and Hebrew labels", () => {
    expect(
      filtersKey({
        ...base,
        keywords_en: "Waterproof  running earphones running",
        product_terms: ["earbuds", "Earphones"],
        requirements: [{ en: "Water-proof", alt: ["water resistant"], he: "עמיד במים" }],
      }),
    ).toBe(filtersKey({ ...base, requirements: [{ ...base.requirements[0], en: "water proof" }] }));
    expect(filtersKey({ ...base, max_price_ils: 100.4 })).toBe(filtersKey(base));
  });

  it("separates anything that changes the results", () => {
    const key = filtersKey(base);
    expect(filtersKey({ ...base, max_price_ils: 150 })).not.toBe(key);
    expect(filtersKey({ ...base, min_price_ils: 20 })).not.toBe(key);
    expect(filtersKey({ ...base, requirements: [] })).not.toBe(key);
    expect(filtersKey({ ...base, product_terms: ["headphones"] })).not.toBe(key);
    expect(filtersKey({ ...base, sort_preference: "cheapest" })).not.toBe(key);
    expect(filtersKey({ ...base, keywords_en: "swimming earphones waterproof" })).not.toBe(key);
  });
});

describe("isFresh", () => {
  it("keeps entries for 48 hours", () => {
    const created = new Date("2026-09-27T10:00:00Z");
    expect(isFresh(created, new Date("2026-09-29T09:59:00Z"))).toBe(true);
    expect(isFresh(created, new Date("2026-09-29T10:00:00Z"))).toBe(false);
  });
});
