import { describe, expect, it } from "vitest";
import {
  CACHE_TTL_DAYS,
  CACHE_TTL_HOURS,
  EMPTY_RESULTS_TTL_HOURS,
  filtersKey,
  isFresh,
  isFreshResults,
  normalizeQuery,
  queryKey,
} from "./cache-key";
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

  it("ignores keyword order, case, hyphens and a known misspelling of a label", () => {
    expect(
      filtersKey({
        ...base,
        keywords_en: "Waterproof  running earphones running",
        product_terms: ["Earphones", "earbuds"],
        requirements: [{ en: "Water-proof", alt: ["water resistant"], he: "עמידות למיים" }],
      }),
    ).toBe(filtersKey({ ...base, requirements: [{ ...base.requirements[0], en: "water proof" }] }));
    expect(filtersKey({ ...base, max_price_ils: 100.4 })).toBe(filtersKey(base));
    expect(
      filtersKey({
        ...base,
        requirements: [{ ...base.requirements[0], alt: ["water resistant", "waterproof"] }],
      }),
    ).toBe(filtersKey(base));
  });

  it("separates anything that changes the results", () => {
    const key = filtersKey(base);
    expect(filtersKey({ ...base, max_price_ils: 150 })).not.toBe(key);
    expect(filtersKey({ ...base, min_price_ils: 20 })).not.toBe(key);
    expect(filtersKey({ ...base, requirements: [] })).not.toBe(key);
    expect(filtersKey({ ...base, product_terms: ["headphones"] })).not.toBe(key);
    expect(filtersKey({ ...base, sort_preference: "cheapest" })).not.toBe(key);
    expect(filtersKey({ ...base, keywords_en: "swimming earphones waterproof" })).not.toBe(key);
    expect(
      filtersKey({ ...base, preferences: [{ words: ["laptop"], he: "למחשב נייד" }] }),
    ).not.toBe(key);
    expect(filtersKey({ ...base, category_hint: "sports audio" })).not.toBe(key);
  });

  it("keeps the order the code reads: the first product term and requirement", () => {
    // relevance and the broader keyword steps read product_terms[0], the steps requirements[0].en
    // (the finding on canonicalFilters: sorted, two parses shared results ranked for the other).
    const key = filtersKey(base);
    expect(filtersKey({ ...base, product_terms: ["earbuds", "earphones"] })).not.toBe(key);
    const two: SearchFilters = {
      ...base,
      requirements: [...base.requirements, { en: "sweatproof", alt: [], he: "עמיד לזיעה" }],
    };
    expect(filtersKey({ ...two, requirements: [...two.requirements].reverse() })).not.toBe(
      filtersKey(two),
    );
    expect(
      filtersKey({
        ...base,
        requirements: [{ en: "water resistant", alt: ["waterproof"], he: "עמידות למים" }],
      }),
    ).not.toBe(key);
  });

  it("keeps the Hebrew labels the explanations are written with", () => {
    const labelled = { ...base, product_he: "אוזניות לריצה" };
    expect(filtersKey({ ...labelled, product_he: "אוזניות ספורט" })).not.toBe(filtersKey(labelled));
    expect(
      filtersKey({
        ...labelled,
        requirements: [{ ...base.requirements[0], he: "עמיד במים" }],
      }),
    ).not.toBe(filtersKey(labelled));
  });
});

describe("isFresh", () => {
  it("keeps entries for 14 days", () => {
    expect(CACHE_TTL_HOURS).toBe(CACHE_TTL_DAYS * 24);
    const created = new Date("2026-09-27T10:00:00Z");
    expect(isFresh(created, new Date("2026-09-29T10:00:00Z"))).toBe(true); // the old 48h limit
    expect(isFresh(created, new Date("2026-10-11T09:59:00Z"))).toBe(true);
    expect(isFresh(created, new Date("2026-10-11T10:00:00Z"))).toBe(false);
  });
});

describe("isFreshResults", () => {
  it("keeps result sets for 14 days, and empty ones for 48h only", () => {
    const created = new Date("2026-09-27T10:00:00Z");
    expect(EMPTY_RESULTS_TTL_HOURS).toBe(48);
    expect(isFreshResults(created, 4, new Date("2026-10-11T09:59:00Z"))).toBe(true);
    expect(isFreshResults(created, 0, new Date("2026-09-29T09:59:00Z"))).toBe(true);
    expect(isFreshResults(created, 0, new Date("2026-09-29T10:00:00Z"))).toBe(false);
  });

  it("keeps a degraded result set (lines from the data) for 48h only", () => {
    const created = new Date("2026-09-27T10:00:00Z");
    expect(isFreshResults(created, 4, new Date("2026-09-29T09:59:00Z"), true)).toBe(true);
    expect(isFreshResults(created, 4, new Date("2026-09-29T10:00:00Z"), true)).toBe(false);
  });
});
