import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { SearchFilters } from "@/lib/search/filters";
import { FEEDBACK_PRIOR, SHARED_NUMBERS } from "./config";
import { rankProducts, rankWithFill } from "./rank";
import {
  feedbackForScore,
  findSharedNumbers,
  hasSharedNumbers,
  markIn,
  NO_SHARED_NUMBERS,
  salesForScore,
  sharedMarkOf,
  withoutSharedMark,
} from "./shared-numbers";

let next = 0;
function product(overrides: Partial<AliProduct> & { shopId?: string | null }): AliProduct {
  const { shopId = null, ...rest } = overrides;
  next++;
  return {
    productId: String(1000 + next),
    title: `Wireless Earbuds Model${next}`,
    price: 50,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 95,
    unitsSold: 1000 + next,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: [],
    detailUrl: "https://he.aliexpress.com/item/1.html",
    promotionLink: null,
    shop: { id: shopId, name: null, url: null },
    commissionRatePct: 5,
    category: { firstId: null, firstName: null, secondId: null, secondName: null },
    ...rest,
  };
}

const filters = (overrides: Partial<SearchFilters> = {}): SearchFilters => ({
  keywords_en: "wireless earbuds",
  product_terms: ["earbuds"],
  requirements: [],
  sort_preference: "best_value",
  ...overrides,
});

const ids = (ps: AliProduct[]) => ps.map((p) => p.productId);

/** `n` listings of one shop, each with its own sales, all at `pct`. */
const uniformShop = (shopId: string, n: number, pct: number) =>
  Array.from({ length: n }, () => product({ shopId, positiveFeedbackPct: pct }));

describe("findSharedNumbers", () => {
  it("flags a shop whose two listings show the same sales, and splits that number", () => {
    const a = product({ shopId: "s", unitsSold: 11_268 });
    const b = product({ shopId: "s", unitsSold: 11_268 });
    const c = product({ shopId: "s", unitsSold: 3_098 });
    const shared = findSharedNumbers([a, b, c, product({ shopId: "t", unitsSold: 11_268 })]);
    expect([...shared.shops]).toEqual(["s"]);
    expect(shared.salesSharedBy.get(a.productId)).toBe(2);
    expect(shared.salesSharedBy.get(b.productId)).toBe(2);
    // The shop's other listing is affected (its note, its feedback) but its sales count fully.
    expect(shared.salesSharedBy.has(c.productId)).toBe(false);
  });

  it("ignores equal sales below the floor, across shops, and without a shop id", () => {
    const low = SHARED_NUMBERS.salesMin - 1;
    expect(
      findSharedNumbers([
        product({ shopId: "s", unitsSold: low }),
        product({ shopId: "s", unitsSold: low }),
        product({ shopId: "t", unitsSold: 5_000 }),
        product({ shopId: "u", unitsSold: 5_000 }),
        product({ shopId: null, unitsSold: 7_000 }),
        product({ shopId: null, unitsSold: 7_000 }),
      ]).shops.size,
    ).toBe(0);
  });

  it("counts a listing once even when the pool holds it twice", () => {
    const a = product({ shopId: "s", unitsSold: 4_000 });
    expect(findSharedNumbers([a, { ...a }]).shops.size).toBe(0);
  });

  it("flags a shop that shows one feedback value on nearly every listing", () => {
    const n = SHARED_NUMBERS.feedbackMinListings;
    const uniform = findSharedNumbers(uniformShop("s", n, 98));
    expect([...uniform.shops]).toEqual(["s"]);
    expect(uniform.feedbackOf.get("s")).toBe(98);
    // One listing of five at another value is still the same number on 80% of them.
    const mostly = [
      ...uniformShop("s", n - 1, 98),
      product({ shopId: "s", positiveFeedbackPct: 96 }),
    ];
    expect(findSharedNumbers(mostly).shops.has("s")).toBe(true);
    expect(findSharedNumbers(mostly).feedbackOf.get("s")).toBe(98);
  });

  it("marks on each listing which of its own numbers the shop repeats", () => {
    const n = SHARED_NUMBERS.feedbackMinListings;
    const repeated = uniformShop("s", n, 98);
    const [a, b] = repeated;
    // Snapshot ex-8: a listing of that shop at 98.3% and 4,744 sales, both its own.
    const own = product({ shopId: "s", positiveFeedbackPct: 98.3, unitsSold: 4_744 });
    const twin = { ...b, unitsSold: 11_268 };
    const pool = [{ ...a, unitsSold: 11_268 }, twin, ...repeated.slice(2), own];
    const shared = findSharedNumbers(pool);
    expect(markIn(pool[0], shared)).toEqual({ feedback: true, sales: true });
    expect(markIn(repeated[2], shared)).toEqual({ feedback: true, sales: false });
    expect(markIn(own, shared)).toEqual({ feedback: false, sales: false });
    expect(markIn(product({ shopId: "o" }), shared)).toBeNull();
    // A shop flagged by its sales alone repeats no feedback value.
    const small = [
      product({ shopId: "t", unitsSold: 2_000, positiveFeedbackPct: 97.1 }),
      product({ shopId: "t", unitsSold: 2_000, positiveFeedbackPct: 97.1 }),
      product({ shopId: "t", unitsSold: 900, positiveFeedbackPct: 97.1 }),
    ];
    const bySales = findSharedNumbers(small);
    expect(bySales.feedbackOf.has("t")).toBe(false);
    expect(small.map((p) => markIn(p, bySales))).toEqual([
      { feedback: false, sales: true },
      { feedback: false, sales: true },
      { feedback: false, sales: false },
    ]);
  });

  it("leaves small shops, spread ratings and 100% alone", () => {
    const n = SHARED_NUMBERS.feedbackMinListings;
    // Too few listings to tell.
    expect(findSharedNumbers(uniformShop("s", n - 1, 98)).shops.size).toBe(0);
    // 100% is the ceiling: many perfect ratings are not a copied number.
    expect(findSharedNumbers(uniformShop("s", n + 2, 100)).shops.size).toBe(0);
    // A normal spread: three of six at one value.
    const spread = [95.1, 96.4, 97.2, 97.2, 97.2, 98.9].map((pct) =>
      product({ shopId: "s", positiveFeedbackPct: pct }),
    );
    expect(findSharedNumbers(spread).shops.size).toBe(0);
  });

  it("counts only listings with a feedback value", () => {
    const n = SHARED_NUMBERS.feedbackMinListings;
    const unrated = Array.from({ length: 3 }, () =>
      product({ shopId: "s", positiveFeedbackPct: null }),
    );
    expect(findSharedNumbers([...uniformShop("s", n - 1, 98), ...unrated]).shops.size).toBe(0);
    expect(findSharedNumbers([...uniformShop("s", n, 98), ...unrated]).shops.has("s")).toBe(true);
  });
});

describe("feedbackForScore and salesForScore", () => {
  const s = product({ shopId: "s", unitsSold: 10_000 });
  const shared = {
    shops: new Set(["s"]),
    salesSharedBy: new Map([[s.productId, 4]]),
    feedbackOf: new Map<string, number>(),
  };

  it("gives a shop that shares numbers no feedback above the prior, and never lifts one", () => {
    expect(feedbackForScore(s, 99.4, shared)).toBe(FEEDBACK_PRIOR.pct);
    expect(feedbackForScore(s, 96.5, shared)).toBe(96.5);
    expect(feedbackForScore(s, 99.4, NO_SHARED_NUMBERS)).toBe(99.4);
  });

  it("counts a shared sales number once, split between the listings that show it", () => {
    expect(salesForScore(s, shared)).toBe(2_500);
    expect(salesForScore(s, NO_SHARED_NUMBERS)).toBe(10_000);
    expect(salesForScore(product({ unitsSold: null }), NO_SHARED_NUMBERS)).toBe(0);
  });
});

describe("ranking with shared numbers", () => {
  // Five listings of one shop at exactly 99.0%: its rating is the shop's, not each product's.
  const shop = () => uniformShop("s", SHARED_NUMBERS.feedbackMinListings, 99);

  it("marks the passers of a shop that shares numbers, without changing the input", () => {
    const listings = shop();
    const other = product({ shopId: "o", positiveFeedbackPct: 99 });
    const { ranked } = rankWithFill([...listings, other], filters(), 3, "none");
    for (const p of ranked) expect(hasSharedNumbers(p)).toBe(p.shop.id === "s");
    expect(listings.some(hasSharedNumbers)).toBe(false);
    expect(ranked.filter(hasSharedNumbers).length).toBeGreaterThan(0);
  });

  it("judges shared numbers over every product checked, not only the passers", () => {
    // Four of the shop's listings fail the price filter; the fifth still carries their number.
    const [kept, ...rest] = shop();
    const pool = [kept, ...rest.map((p) => ({ ...p, price: 500 })), product({ shopId: "o" })];
    const { ranked } = rankWithFill(pool, filters({ max_price_ils: 100 }), 3, "none");
    expect(ranked.find((p) => p.productId === kept.productId)?.sharedNumbers).toEqual({
      feedback: true,
      sales: false,
    });
  });

  it("ranks an equal product of another shop above one whose rating is shared", () => {
    const listings = shop();
    const target = { ...listings[0], unitsSold: 20_000, title: "Wireless Earbuds Pro" };
    // The same numbers and an equally plain title; it even pays less, which only breaks exact ties.
    const other = product({
      shopId: "o",
      positiveFeedbackPct: 99,
      unitsSold: 20_000,
      title: "Wireless Earbuds Max",
      commissionRatePct: 0,
    });
    const pool = [target, ...listings.slice(1), other];
    const ranked = ids(rankProducts(pool, filters()));
    expect(ranked).toContain(target.productId);
    expect(ranked.indexOf(other.productId)).toBeLessThan(ranked.indexOf(target.productId));
    // Without the shop's other listings nothing is shared: the exact tie goes to the commission.
    const alone = ids(rankProducts([target, other], filters()));
    expect(alone[0]).toBe(target.productId);
  });

  it("counts sales two listings share once, in the score and in the most popular order", () => {
    const a = product({ shopId: "s", unitsSold: 20_000, title: "Wireless Earbuds Sport" });
    const b = product({
      shopId: "s",
      unitsSold: 20_000,
      title: "Bluetooth Earbuds Gaming Headset",
    });
    const o = product({ shopId: "o", unitsSold: 15_000, title: "Wireless Earbuds Running" });
    const pool = [a, b, o];
    expect(ids(rankProducts(pool, filters()))[0]).toBe(o.productId);
    const popular = ids(rankProducts(pool, filters({ sort_preference: "most_popular" })));
    expect(popular[0]).toBe(o.productId);
    // Without the shared number, the higher sales lead as before.
    const alone = ids(rankProducts([a, o], filters({ sort_preference: "most_popular" })));
    expect(alone[0]).toBe(a.productId);
  });

  it("drops a mark another pool gave when this pool shares nothing", () => {
    const mark = { feedback: true, sales: true };
    const stale = { ...product({ shopId: "s" }), sharedNumbers: mark };
    const [p] = rankProducts([stale], filters());
    expect(hasSharedNumbers(p)).toBe(false);
    expect(JSON.parse(JSON.stringify(p))).not.toHaveProperty("sharedNumbers");
    expect(stale.sharedNumbers).toBe(mark);
  });

  it("replaces a mark another pool gave with this pool's", () => {
    const listings = shop();
    const stale = { ...listings[0], sharedNumbers: { feedback: false, sales: true } };
    const [p] = rankProducts([stale, ...listings.slice(1)], filters()).filter(
      (x) => x.productId === stale.productId,
    );
    expect(sharedMarkOf(p)).toEqual({ feedback: true, sales: false });
    expect(stale.sharedNumbers).toEqual({ feedback: false, sales: true });
  });

  it("reads only a well-formed mark back from the cache, and strips it for storage", () => {
    const p = product({ shopId: "s" });
    expect(sharedMarkOf({ ...p, sharedNumbers: "yes" } as never)).toBeNull();
    expect(sharedMarkOf({ ...p, sharedNumbers: { sales: true } } as never)).toEqual({
      feedback: false,
      sales: true,
    });
    const marked = { ...p, sharedNumbers: { feedback: true, sales: false } };
    const stored = withoutSharedMark(marked);
    expect(stored).not.toHaveProperty("sharedNumbers");
    expect(stored).toEqual(p);
    expect(marked.sharedNumbers).toEqual({ feedback: true, sales: false });
    expect(withoutSharedMark(p)).toBe(p);
  });

  it("never blocks a product: the filters read AliExpress's numbers", () => {
    const listings = shop();
    expect(rankProducts(listings, filters())).toHaveLength(listings.length);
  });
});
