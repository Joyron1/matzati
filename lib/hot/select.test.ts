import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvelope, parseJsonKeepingIds } from "@/lib/aliexpress/client";
import type { AliPromoCode } from "@/lib/aliexpress/promo-code";
import { parseProductPage, type AliProduct } from "@/lib/aliexpress/schemas";
import { FILTERS } from "@/lib/ranking/config";
import {
  CAROUSEL_MAX_PER_SUBCATEGORY,
  MIX_PER_CATEGORY,
  PER_SHOP,
  PER_SUBCATEGORY,
  hasCurrentCode,
  interleaveHotProducts,
  mixHotProducts,
  passingFilters,
  randomCarouselProducts,
  selectHotProducts,
  shuffled,
  toHotProduct,
  viewHotProducts,
  type HotProduct,
  type HotView,
} from "./select";

function product(overrides: Partial<AliProduct>): AliProduct {
  return {
    productId: "1",
    title: "כיסוי טלפון",
    price: 20,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 95,
    unitsSold: 1000,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: [],
    detailUrl: "https://he.aliexpress.com/item/1.html",
    promotionLink: "https://s.click.aliexpress.com/s/x",
    shop: { id: null, name: null, url: null },
    commissionRatePct: 7,
    category: { firstId: "44", firstName: null, secondId: null, secondName: null },
    videoUrl: null,
    promoCode: null,
    ...overrides,
  };
}

const ids = (ps: { productId: string }[]) => ps.map((p) => p.productId);

/** The probe's masked responses (fixtures/aliexpress/probe-hot, 2026-09-28). */
function fixture(name: string): AliProduct[] {
  const method = "aliexpress.affiliate.hotproduct.query";
  const text = readFileSync(`fixtures/aliexpress/probe-hot/${method}.${name}.json`, "utf8");
  return parseProductPage(parseEnvelope(method, parseJsonKeepingIds(text)).result).products;
}

describe("selectHotProducts", () => {
  it("keeps only products that pass FILTERS with an ILS price and an affiliate link", () => {
    const kept = selectHotProducts([
      product({ productId: "ok" }),
      product({
        productId: "low-feedback",
        positiveFeedbackPct: FILTERS.minPositiveFeedbackPct - 0.1,
      }),
      product({ productId: "few-sales", unitsSold: FILTERS.minUnitsSold - 1 }),
      product({ productId: "no-feedback", positiveFeedbackPct: null }),
      product({ productId: "no-sales", unitsSold: null }),
      product({ productId: "usd", currency: "USD" }),
      product({ productId: "no-link", promotionLink: null }),
      product({
        productId: "at-thresholds",
        positiveFeedbackPct: FILTERS.minPositiveFeedbackPct,
        unitsSold: FILTERS.minUnitsSold,
      }),
    ]);
    expect(ids(kept)).toEqual(["ok", "at-thresholds"]);
  });

  it("drops excluded categories at either level", () => {
    const kept = selectHotProducts([
      product({ productId: "vape", category: { ...product({}).category, secondId: "200003561" } }),
      product({
        productId: "virtual",
        category: { ...product({}).category, firstId: "201169612" },
      }),
      product({ productId: "ok" }),
    ]);
    expect(ids(kept)).toEqual(["ok"]);
  });

  it("sorts by 30-day sales, then feedback, and drops repeated ids", () => {
    const kept = selectHotProducts([
      product({ productId: "a", unitsSold: 500 }),
      product({ productId: "b", unitsSold: 900 }),
      product({ productId: "c", unitsSold: 500, positiveFeedbackPct: 99 }),
      product({ productId: "b", unitsSold: 100 }),
    ]);
    expect(ids(kept)).toEqual(["b", "c", "a"]);
  });

  it("gives one shop at most PER_SHOP places, its best sellers", () => {
    const shop = { id: "s1", name: null, url: null };
    const kept = selectHotProducts([
      product({ productId: "s1-low", shop, unitsSold: 200 }),
      product({ productId: "s1-top", shop, unitsSold: 900 }),
      product({ productId: "s1-mid", shop, unitsSold: 500 }),
      product({ productId: "other", unitsSold: 300 }),
    ]);
    expect(PER_SHOP).toBe(2);
    expect(ids(kept)).toEqual(["s1-top", "s1-mid", "other"]);
  });

  it("keeps most of a category list (probe: 41 of 46 passed FILTERS in category 44)", () => {
    const cat = fixture("cat44-HE");
    const kept = selectHotProducts(cat);
    expect(kept.length).toBeGreaterThan(30);
    expect(kept.length).toBeLessThanOrEqual(41);
    expect(kept.every((p) => p.positiveFeedbackPct! >= 90 && p.unitsSold! >= 100)).toBe(true);
  });
});

describe("interleaveHotProducts", () => {
  const hot = (id: string, sub: string | null, first = "44"): HotProduct => ({
    ...toHotProduct(product({ productId: id })),
    categoryId: first,
    subcategoryId: sub,
  });

  it("takes the lists in turn, each from its best seller, up to the limit", () => {
    const a = [hot("a1", "x1"), hot("a2", "x2"), hot("a3", "x3")];
    const b = [hot("b1", "y1", "15"), hot("b2", "y2", "15")];
    expect(ids(interleaveHotProducts([a, b], 10))).toEqual(["a1", "b1", "a2", "b2", "a3"]);
    expect(ids(interleaveHotProducts([a, b], 3))).toEqual(["a1", "b1", "a2"]);
    expect(interleaveHotProducts([], 5)).toEqual([]);
  });

  it("gives a second-level category at most PER_SUBCATEGORY places and a product one", () => {
    const cases = [1, 2, 3, 4].map((n) => hot(`case${n}`, "202228401", "202192403"));
    const b = [hot("case1", "202228401", "202192403"), hot("b1", "y1", "15")];
    expect(PER_SUBCATEGORY).toBe(2);
    expect(ids(interleaveHotProducts([cases, b], 16))).toEqual(["case1", "b1", "case2"]);
  });

  it("mixes the probe's category list with the list without a category", () => {
    const lists = [fixture("cat44-HE"), fixture("all-HE")].map((l) =>
      selectHotProducts(l).map(toHotProduct),
    );
    const mixed = interleaveHotProducts(lists, 16);
    expect(mixed).toHaveLength(16);
    expect(new Set(ids(mixed)).size).toBe(16);
    const perGroup = new Map<string, number>();
    for (const p of mixed) {
      const g = p.subcategoryId ?? p.categoryId ?? "";
      perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
    }
    expect(Math.max(...perGroup.values())).toBeLessThanOrEqual(PER_SUBCATEGORY);
  });
});

/** A seeded random source (mulberry32), so a test's pick is repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("shuffled", () => {
  it("keeps every item once, leaves its input alone and follows the random source", () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const a = shuffled(items, seeded(1));
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(items[0]).toBe(0);
    expect(shuffled(items, seeded(1))).toEqual(a);
    expect(shuffled(items, seeded(2))).not.toEqual(a);
    // A source at its upper bound still stays in range.
    expect(shuffled(items, () => 0.9999999999).sort((x, y) => x - y)).toEqual(items);
  });
});

describe("randomCarouselProducts", () => {
  const hot = (id: string, sub: string | null, first = "44"): HotProduct => ({
    ...toHotProduct(product({ productId: id })),
    categoryId: first,
    subcategoryId: sub,
  });
  /** The probe's four lists, as the cache holds them (selected, then FILTERS again). */
  const probeLists = () =>
    ["cat44-HE", "cat44-HE.page2", "all-HE", "cat44-EN"].map((name) =>
      passingFilters(selectHotProducts(fixture(name)).map(toHotProduct)),
    );
  const perGroup = (ps: HotProduct[]) => {
    const counts = new Map<string, number>();
    for (const p of ps) {
      const g = p.subcategoryId ?? p.categoryId ?? "";
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return counts;
  };

  it("picks 50 different products from the probe's lists, each passing FILTERS, within the cap", () => {
    const lists = probeLists();
    const picked = randomCarouselProducts(lists, 50, seeded(7));
    expect(picked).toHaveLength(50);
    expect(new Set(ids(picked)).size).toBe(50);
    const pool = new Set(lists.flat());
    expect(picked.every((p) => pool.has(p))).toBe(true);
    expect(passingFilters(picked)).toEqual(picked);
    expect(Math.max(...perGroup(picked).values())).toBeLessThanOrEqual(
      CAROUSEL_MAX_PER_SUBCATEGORY,
    );
  });

  it("gives another set and order for another random source, the same for the same one", () => {
    const lists = probeLists();
    const a = ids(randomCarouselProducts(lists, 50, seeded(1)));
    const b = ids(randomCarouselProducts(lists, 50, seeded(2)));
    expect(b).not.toEqual(a);
    expect(new Set(b)).not.toEqual(new Set(a));
    expect(ids(randomCarouselProducts(lists, 50, seeded(1)))).toEqual(a);
  });

  it("raises the cap only as far as it needs to", () => {
    // 3 kinds of 10 products: 2 each gives 6, 3 each gives 9.
    const list = ["x", "y", "z"].flatMap((g) =>
      Array.from({ length: 10 }, (_, i) => hot(`${g}${i}`, g)),
    );
    const nine = randomCarouselProducts([list], 9, seeded(3));
    expect(nine).toHaveLength(9);
    expect([...perGroup(nine).values()]).toEqual([3, 3, 3]);
    const six = randomCarouselProducts([list], 6, seeded(3));
    expect([...perGroup(six).values()]).toEqual([2, 2, 2]);
  });

  it("gives every product the highest cap allows when the lists hold too few", () => {
    const list = [
      ...Array.from({ length: 10 }, (_, i) => hot(`x${i}`, "x")),
      hot("y0", "y"),
      hot("n0", null, "15"),
    ];
    const picked = randomCarouselProducts([list, [list[0]]], 50, seeded(4));
    expect(picked).toHaveLength(CAROUSEL_MAX_PER_SUBCATEGORY + 2);
    expect(perGroup(picked).get("x")).toBe(CAROUSEL_MAX_PER_SUBCATEGORY);
    expect(randomCarouselProducts([], 50, seeded(4))).toEqual([]);
  });

  it("takes the lists in turn, so neighbours come from different lists", () => {
    const a = Array.from({ length: 5 }, (_, i) => hot(`a${i}`, `a${i}`));
    const b = Array.from({ length: 5 }, (_, i) => hot(`b${i}`, `b${i}`, "15"));
    const picked = ids(randomCarouselProducts([a, b], 10, seeded(5)));
    for (let i = 1; i < picked.length; i++) expect(picked[i][0]).not.toBe(picked[i - 1][0]);
  });
});

describe("mixHotProducts", () => {
  it("takes the first MIX_PER_CATEGORY of each list, once each", () => {
    const list = (prefix: string) =>
      Array.from({ length: 20 }, (_, i) => toHotProduct(product({ productId: `${prefix}${i}` })));
    const shared = toHotProduct(product({ productId: "a0" }));
    const mixed = mixHotProducts([list("a"), [shared, ...list("b")]]);
    expect(mixed).toHaveLength(MIX_PER_CATEGORY * 2 - 1);
    expect(ids(mixed).slice(0, 2)).toEqual(["a0", "a1"]);
    expect(ids(mixed)).not.toContain(`b${MIX_PER_CATEGORY - 1}`);
  });
});

describe("toHotProduct", () => {
  it("keeps what the cards and filters need, with AliExpress's title unchanged", () => {
    const [p] = fixture("cat44-HE").filter((x) => x.promoCode && x.videoUrl);
    const hot = toHotProduct(p);
    expect(hot).toMatchObject({
      productId: p.productId,
      title: p.title,
      imageUrl: p.mainImageUrl,
      price: p.price,
      hasVideo: true,
      promoCode: p.promoCode,
      categoryId: "44",
    });
    expect(Object.keys(hot)).not.toContain("promotionLink");
  });
});

describe("viewHotProducts", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  const code = (endsAt: string): AliPromoCode => ({
    code: "HOT5",
    offerText: null,
    offer: null,
    minSpend: null,
    startsAt: "2026-09-01T00:00:00Z",
    endsAt,
    promotionUrl: null,
  });
  const hot = (id: string, overrides: Partial<HotProduct>): HotProduct => ({
    ...toHotProduct(product({ productId: id })),
    ...overrides,
  });
  const list = [
    hot("p50", { price: 50, unitsSold: 300, discountPct: 10 }),
    hot("p50.01", { price: 50.01, unitsSold: 900 }),
    hot("p100", { price: 100, unitsSold: 200, discountPct: 40, hasVideo: true }),
    hot("p200", { price: 200, unitsSold: 100, promoCode: code("2026-10-01T00:00:00Z") }),
    hot("p250", { price: 250, unitsSold: 500, promoCode: code("2026-09-28T11:00:00Z") }),
  ];
  const view = (overrides: Partial<HotView>): HotView => ({
    sort: "sales",
    withCode: false,
    withVideo: false,
    ...overrides,
  });

  it("sorts by sales, discount or price", () => {
    expect(ids(viewHotProducts(list, view({}), now))).toEqual([
      "p50.01",
      "p250",
      "p50",
      "p100",
      "p200",
    ]);
    expect(ids(viewHotProducts(list, view({ sort: "discount" }), now)).slice(0, 2)).toEqual([
      "p100",
      "p50",
    ]);
    expect(ids(viewHotProducts(list, view({ sort: "price_asc" }), now))[0]).toBe("p50");
    expect(ids(viewHotProducts(list, view({ sort: "price_desc" }), now))[0]).toBe("p250");
  });

  it("puts a price on a band's edge in the lower band", () => {
    expect(ids(viewHotProducts(list, view({ price: "under-50" }), now))).toEqual(["p50"]);
    expect(ids(viewHotProducts(list, view({ price: "50-100" }), now))).toEqual(["p50.01", "p100"]);
    expect(ids(viewHotProducts(list, view({ price: "100-200" }), now))).toEqual(["p200"]);
    expect(ids(viewHotProducts(list, view({ price: "over-200" }), now))).toEqual(["p250"]);
  });

  it("filters on a promo code valid now and on a video", () => {
    expect(ids(viewHotProducts(list, view({ withCode: true }), now))).toEqual(["p200"]);
    expect(hasCurrentCode(list[4], now)).toBe(false);
    expect(ids(viewHotProducts(list, view({ withVideo: true }), now))).toEqual(["p100"]);
  });

  it("never reorders the cached list itself", () => {
    const before = ids(list);
    viewHotProducts(list, view({ sort: "price_desc" }), now);
    expect(ids(list)).toEqual(before);
  });
});

describe("passingFilters", () => {
  const hot = (id: string, positiveFeedbackPct: number, unitsSold: number): HotProduct => ({
    ...toHotProduct(product({ productId: id })),
    positiveFeedbackPct,
    unitsSold,
  });
  const { minPositiveFeedbackPct: pct, minUnitsSold: sold } = FILTERS;

  it("keeps a cached product only while it passes the current FILTERS, at the edges too", () => {
    const list = [
      hot("edge", pct, sold),
      hot("low-feedback", pct - 0.1, sold * 10),
      hot("few-sales", 99, sold - 1),
      hot("well-above", 99, sold * 10),
    ];
    expect(ids(passingFilters(list))).toEqual(["edge", "well-above"]);
  });

  it("drops what a list selected under lower thresholds when they are raised", () => {
    // Cached pools are selected once, at fetch time (lib/hot/queries.ts).
    const list = [hot("a", 92, 150), hot("b", 97, 900)];
    expect(ids(passingFilters(list, { minPositiveFeedbackPct: 95, minUnitsSold: 200 }))).toEqual([
      "b",
    ]);
  });
});
