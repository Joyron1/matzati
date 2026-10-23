import { describe, expect, it } from "vitest";
import { normalizeParsed, type ParsedQueryRaw } from "@/lib/llm/parse";
import { filtersKey, simpleResultsKey } from "./cache-key";
import { CATEGORY_RULE, knownCategoryIds, SEARCH_CATEGORIES } from "./categories";
import { guessedCategories, lowestUnitsSold, nextFetch, type FetchedPage } from "./fetch-policy";
import type { ParsedQuery } from "./filters";
import type { AliProduct } from "@/lib/aliexpress/schemas";

const RC: ParsedQuery = {
  keywords_en: "remote control car",
  product_terms: ["remote control car", "rc car"],
  requirements: [],
  sort_preference: "best_value",
  product_he: "מכונית על שלט",
  category_guess: ["26"],
};

let serial = 0;
function car(o: Partial<AliProduct> = {}): AliProduct {
  const n = serial++;
  const id = String(1005000000000000 + n);
  return {
    productId: id,
    title: `Remote Control Car Drift Racing ${"abcdefghij"[n % 10]}${n}`,
    price: 60,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 97,
    unitsSold: 1000 + n,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: [],
    detailUrl: `https://www.aliexpress.com/item/${id}.html`,
    promotionLink: "https://s.click.aliexpress.com/e/_test",
    shop: { id: `shop-${id}`, name: null, url: null },
    commissionRatePct: 5,
    category: { firstId: "26", firstName: null, secondId: null, secondName: null },
    ...o,
  };
}
const page = (
  products: AliProduct[],
  o: Partial<FetchedPage> = {},
): [FetchedPage, AliProduct[]] => [
  {
    keywords: RC.keywords_en,
    pageNo: 1,
    count: products.length,
    totalRecords: 1000,
    lowestUnitsSold: lowestUnitsSold(products),
    ...o,
  },
  products,
];
const after = (pages: [FetchedPage, AliProduct[]][], filters: ParsedQuery = RC) =>
  nextFetch({ filters, calls: pages.map(([p]) => p), pool: pages.flatMap(([, ps]) => ps) });

describe("knownCategoryIds", () => {
  it("keeps known ids once each, in order, at most two", () => {
    expect(knownCategoryIds(["26", "999", "26", "36", "44"])).toEqual(["26", "36"]);
    expect(knownCategoryIds([" 36 "])).toEqual(["36"]);
    expect(knownCategoryIds(undefined)).toEqual([]);
  });

  it("lists no test, virtual or second-hand category, and the prompt names every id", () => {
    const ids = SEARCH_CATEGORIES.map((c) => c.id);
    for (const out of ["127698009", "202192001", "201169612", "201520802", "200001075"]) {
      expect(ids).not.toContain(out);
    }
    for (const id of ids) expect(CATEGORY_RULE).toContain(`${id} `);
  });
});

describe("the parse's assigned categories", () => {
  const raw = (over: Partial<ParsedQueryRaw> = {}): ParsedQueryRaw => ({
    product_he: "מכונית על שלט",
    product_terms: ["remote control car"],
    requirements: [],
    preferences: [],
    keywords_en: "remote control car",
    min_price_ils: null,
    max_price_ils: null,
    sort_preference: "best_value",
    category_hint: "rc toys",
    ...over,
  });

  it("become category_guess, known ids only", () => {
    expect(normalizeParsed(raw({ category_ids: ["26", "abc"] }))?.category_guess).toEqual(["26"]);
    expect(normalizeParsed(raw({ category_ids: [] }))).not.toHaveProperty("category_guess");
    // An answer recorded before PARSE_VERSION 10 has no category_ids.
    expect(normalizeParsed(raw())).not.toHaveProperty("category_guess");
  });
});

describe("the fetch with assigned categories", () => {
  it("limits the first call to them", () => {
    expect(after([])).toEqual({
      step: { keywords: "remote control car", pageNo: 1, categoryIds: "26" },
    });
    expect(
      nextFetch({ filters: { ...RC, category_guess: ["202192403", "509"] }, calls: [], pool: [] }),
    ).toEqual({
      step: { keywords: "remote control car", pageNo: 1, categoryIds: "202192403,509" },
    });
  });

  it("keeps them on the next page while enough pass", () => {
    const d = after([
      page(
        Array.from({ length: 10 }, () => car()),
        { categoryIds: "26" },
      ),
    ]);
    expect(d).toEqual({ step: { keywords: "remote control car", pageNo: 2, categoryIds: "26" } });
  });

  it("drops them when under a page passes, and every call after that goes without", () => {
    const few = page([car(), car()], { categoryIds: "26" });
    expect(after([few])).toEqual({ step: { keywords: "remote control car", pageNo: 1 } });
    const without = page([car(), car()]);
    const next = after([few, without]);
    expect("step" in next && next.step.categoryIds).toBeFalsy();
    expect(guessedCategories({ filters: RC, calls: [few[0], without[0]] })).toBeUndefined();
  });

  it("never sends them when the page set its own category", () => {
    expect(after([], { ...RC, category_id: "44" })).toEqual({
      step: { keywords: "remote control car", pageNo: 1 },
    });
  });
});

describe("cache keys with assigned categories", () => {
  const plain: ParsedQuery = { ...RC, category_guess: undefined };

  it("separate the results of a guessed search from an unguessed one", () => {
    expect(filtersKey(RC, "none")).not.toBe(filtersKey(plain, "none"));
    expect(simpleResultsKey(RC)).not.toBe(simpleResultsKey(plain));
  });

  it("follow the page's own category when there is one", () => {
    expect(filtersKey({ ...RC, category_id: "44" }, "none")).toBe(
      filtersKey({ ...plain, category_id: "44" }, "none"),
    );
  });
});
