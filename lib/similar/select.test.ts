// The similar products on /p: the other products of the list that led to the page, in its order,
// only those /p can show. Pure; real products from the product.query fixture.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseProductPage, type AliProduct } from "@/lib/aliexpress/schemas";
import type { HotProduct } from "@/lib/hot/select";
import type { CachedResults } from "@/lib/search/store";
import { SIMILAR_LIMIT, searchProductHref, similarFromHot, similarFromSearch } from "./select";

const PRODUCTS: AliProduct[] = parseProductPage(
  JSON.parse(readFileSync("fixtures/aliexpress/aliexpress.affiliate.product.query.json", "utf8"))
    .aliexpress_affiliate_product_query_response?.resp_result?.result,
).products;

const CREATED_AT = "2026-09-27T10:00:00.000Z";
const Q = "מארגן כבלים";

function cached(products: AliProduct[], explanations: CachedResults["explanations"] = {}) {
  return { products, explanations, createdAt: CREATED_AT };
}

/** Every id has a row, none with a title of ours. */
const allStored = (products: { productId: string }[]) =>
  new Map<string, string | null>(products.map((p) => [p.productId, null]));

describe("similarFromSearch", () => {
  const ranked = PRODUCTS.slice(0, 12);
  const current = ranked[2].productId;

  it("keeps the search's order, leaves out the current product and stops at SIMILAR_LIMIT", () => {
    const out = similarFromSearch(cached(ranked), {
      currentId: current,
      q: Q,
      stored: allStored(ranked),
    });
    const expected = ranked
      .map((p) => p.productId)
      .filter((id) => id !== current)
      .slice(0, SIMILAR_LIMIT);
    expect(out?.items.map((i) => i.productId)).toEqual(expected);
    expect(out?.source).toEqual({ kind: "search" });
    expect(out?.checkedAt).toBe(CREATED_AT);
  });

  it("shows only products that have a row, since /p serves nothing else", () => {
    const stored = allStored([ranked[0], ranked[5], ranked[9]]);
    const out = similarFromSearch(cached(ranked), { currentId: current, q: Q, stored });
    expect(out?.items.map((i) => i.productId)).toEqual([
      ranked[0].productId,
      ranked[5].productId,
      ranked[9].productId,
    ]);
  });

  it("is null when no other product can be shown", () => {
    const only = allStored([ranked[2]]);
    expect(similarFromSearch(cached(ranked), { currentId: current, q: Q, stored: only })).toBe(
      null,
    );
    expect(
      similarFromSearch(cached([]), { currentId: current, q: Q, stored: allStored(ranked) }),
    ).toBeNull();
  });

  it("links each card to its /p with the same query, as the result cards do", () => {
    const out = similarFromSearch(cached(ranked), {
      currentId: current,
      q: Q,
      stored: allStored(ranked),
    });
    const [first] = out!.items;
    expect(first.href).toBe(`/p/${first.productId}?q=${encodeURIComponent(Q)}`);
    expect(searchProductHref("1", "")).toBe("/p/1");
  });

  it("titles a card with its line's title, else our stored title, else AliExpress's", () => {
    const [a, b, c] = ranked;
    const stored = new Map<string, string | null>([
      [a.productId, "כותרת שמורה"],
      [b.productId, "כותרת שמורה"],
      [c.productId, null],
    ]);
    const out = similarFromSearch(
      cached([a, b, c], {
        [a.productId]: { title_he: "כותרת מהחיפוש", why_he: "" },
        [b.productId]: { title_he: null, why_he: "" },
      }),
      { currentId: "other", q: Q, stored },
    );
    expect(out?.items.map((i) => i.title)).toEqual(["כותרת מהחיפוש", "כותרת שמורה", c.title]);
  });

  it("reads our cached Hebrew titles with the known transliterations fixed", () => {
    const [a, b, c] = ranked;
    const plush = { ...a, title: "Round Plush Dog Bed Warm Winter" } as AliProduct;
    const stored = new Map<string, string | null>([
      [a.productId, null],
      [b.productId, "מעמד לספיקר"],
      [c.productId, null],
    ]);
    const out = similarFromSearch(
      cached([plush, b, c], {
        // "פלאש" is fixed only when the English title has the word it stands for.
        [a.productId]: { title_he: "מיטת כלב פלאש", why_he: "" },
      }),
      { currentId: "other", q: Q, stored },
    );
    expect(out?.items.map((i) => i.title)).toEqual(["מיטת כלב מפרווה רכה", "מעמד לרמקול", c.title]);
  });

  it("shows the search's own numbers and price, with its shared-numbers mark", () => {
    const [a, b] = ranked;
    const marked = { ...a, sharedNumbers: { feedback: true, sales: false } } as AliProduct;
    const usd = { ...b, currency: "USD" };
    const out = similarFromSearch(cached([marked, usd]), {
      currentId: "other",
      q: Q,
      stored: allStored([a, b]),
    });
    expect(out?.items[0]).toMatchObject({
      imageUrl: a.mainImageUrl,
      price: {
        price_ils: a.price,
        original_price_ils: a.originalPrice,
        price_is_approx: false,
        discount_pct: a.discountPct,
      },
      trust: {
        positive_feedback_pct: a.positiveFeedbackPct,
        units_sold: a.unitsSold,
        shared_numbers: { feedback: true, sales: false },
      },
    });
    expect(out?.items[1].trust).not.toHaveProperty("shared_numbers");
    expect(out?.items[1].price.price_is_approx).toBe(true);
  });

  it("lists a product once even when the result set repeats it", () => {
    const [a, b] = ranked;
    const out = similarFromSearch(cached([a, b, a]), {
      currentId: "other",
      q: Q,
      stored: allStored([a, b]),
    });
    expect(out?.items.map((i) => i.productId)).toEqual([a.productId, b.productId]);
  });
});

describe("similarFromHot", () => {
  const hot = (n: number): HotProduct => ({
    productId: `100500000000${n}`,
    title: `מוצר חם ${n}`,
    imageUrl: `https://ae-pic-a1.aliexpress-media.com/kf/S${n}.jpg`,
    price: 10 + n,
    originalPrice: null,
    discountPct: null,
    positiveFeedbackPct: 97,
    unitsSold: 1000 - n,
    hasVideo: false,
    promoCode: null,
    categoryId: "7",
    subcategoryId: null,
    shopId: `shop${n}`,
  });
  const list = Array.from({ length: 12 }, (_, i) => hot(i));

  it("keeps the list's order, leaves out the current product and keeps from=hot and the category", () => {
    const out = similarFromHot(list, {
      currentId: list[0].productId,
      category: "7",
      categoryHe: "מחשבים",
      fetchedAt: CREATED_AT,
      stored: allStored(list),
    });
    expect(out?.items.map((i) => i.productId)).toEqual(
      list.slice(1, 1 + SIMILAR_LIMIT).map((p) => p.productId),
    );
    expect(out?.items[0]).toMatchObject({
      href: `/p/${list[1].productId}?from=hot&cat=7`,
      title: "מוצר חם 1",
      price: { price_ils: 11, price_is_approx: false },
      trust: { positive_feedback_pct: 97, units_sold: 999 },
    });
    expect(out?.source).toEqual({ kind: "hot", categoryHe: "מחשבים" });
    expect(out?.checkedAt).toBe(CREATED_AT);
  });

  it("shows AliExpress's Hebrew titles with the known transliterated loan words fixed", () => {
    const withLoanWord = { ...hot(20), title: "בובת פלוש 30 ס״מ" };
    const out = similarFromHot([withLoanWord], {
      currentId: "x",
      category: "7",
      categoryHe: null,
      fetchedAt: CREATED_AT,
      stored: allStored([withLoanWord]),
    });
    expect(out?.items[0].title).toBe("בובת מפרווה רכה 30 ס״מ");
  });

  it("shows only products with a row, and is null without any", () => {
    const stored = allStored([list[3]]);
    const args = {
      currentId: "x",
      category: "7" as const,
      categoryHe: null,
      fetchedAt: CREATED_AT,
    };
    expect(similarFromHot(list, { ...args, stored })?.items.map((i) => i.productId)).toEqual([
      list[3].productId,
    ]);
    expect(similarFromHot(list, { ...args, stored: new Map() })).toBeNull();
  });
});
