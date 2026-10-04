import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_FIRST_VIEW, RESULTS_PER_PAGE } from "@/lib/config/site";
import { FILL_TIER, FILL_UP_TO } from "@/lib/ranking/config";
import {
  keywordLadder,
  keywordSteps,
  lowestUnitsSold,
  MAX_ALI_CALLS,
  nextFetch,
  REQUIREMENT_STOP_CHECKED,
  SEO_FETCH,
  TARGET_PASSED,
  type FetchedPage,
} from "./fetch-policy";
import type { ParsedQuery } from "./filters";

const BOTTLE: ParsedQuery = {
  keywords_en: "leakproof water bottle",
  product_terms: ["water bottle", "sports bottle"],
  requirements: [{ en: "leakproof", alt: ["no leak"], he: "לא נוזל" }],
  sort_preference: "best_value",
  product_he: "בקבוק מים",
  category_hint: "drink bottles",
};

let serial = 0;
/** A word of letters only for each number, so titles differ without looking like model codes. */
const word = (n: number) => n.toString(26).replace(/\d/g, (d) => "qrstuvwxyz"[Number(d)]) + "x";
function product(o: Partial<AliProduct> = {}): AliProduct {
  const n = serial++;
  const id = String(1005000000000000 + n);
  return {
    productId: id,
    title: `Leakproof Water Bottle ${word(n)} ${n}`,
    price: 20,
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
    category: { firstId: null, firstName: null, secondId: null, secondName: null },
    ...o,
  };
}
const good = (o: Partial<AliProduct> = {}) => product(o);
const offType = (o: Partial<AliProduct> = {}) =>
  product({ title: `Kitchen Sponge ${word(serial)} ${serial}`, ...o });
const lowFeedback = () => product({ positiveFeedbackPct: 80 });
/** The right product without the requirement in its title. */
const noReq = () => product({ title: `Water Bottle Plain ${word(serial)} ${serial}` });
const times = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make);

function page(
  keywords: string,
  pageNo: number,
  products: AliProduct[],
  totalRecords: number | null = 1000,
): FetchedPage {
  return {
    keywords,
    pageNo,
    count: products.length,
    totalRecords,
    lowestUnitsSold: lowestUnitsSold(products),
  };
}

/** nextFetch after the given pages, with the pool they bring. */
function after(pages: [FetchedPage, AliProduct[]][], filters: ParsedQuery = BOTTLE) {
  return nextFetch({ filters, calls: pages.map(([p]) => p), pool: pages.flatMap(([, ps]) => ps) });
}

const P = BOTTLE.keywords_en;
const call = (keywords: string, pageNo: number, products: AliProduct[], total?: number | null) =>
  [page(keywords, pageNo, products, total), products] as [FetchedPage, AliProduct[]];

describe("keywordSteps", () => {
  it("broadens from the parse's keywords: without audience and praise words, without requirement words, another product phrase with the requirement, the category", () => {
    const night: ParsedQuery = {
      keywords_en: "motion sensor night light kids",
      product_terms: ["night light", "kids night light"],
      requirements: [{ en: "motion sensor", alt: ["motion detection"], he: "חיישן תנועה" }],
      sort_preference: "best_value",
      product_he: "מנורת לילה לחדר ילדים",
      category_hint: "children lighting",
    };
    expect(keywordSteps(night)).toEqual([
      { keywords: "motion sensor night light kids", kind: "primary" },
      { keywords: "motion sensor night light", kind: "general" },
      { keywords: "night light", kind: "reduced" },
      // "motion sensor night light" is already the general step; this one has 5 words with it.
      { keywords: "kids night light", kind: "term" },
      // The hint with the main requirement is 4 words: it fits, and the bare hint drops it.
      { keywords: "motion sensor children lighting", kind: "category" },
      { keywords: "children lighting", kind: "reduced" },
    ]);
    expect(keywordLadder(night)).toEqual(keywordSteps(night).map((s) => s.keywords));
  });

  it("keeps an audience word the product's own name has, and gender words", () => {
    const bottle: ParsedQuery = {
      ...BOTTLE,
      keywords_en: "leak proof kids water bottle",
      product_terms: ["kids water bottle", "leak proof bottle"],
      requirements: [{ en: "leak proof", alt: ["leakproof"], he: "אטום לדליפות" }],
      category_hint: "kids drinkware",
    };
    expect(keywordLadder(bottle)).toEqual([
      "leak proof kids water bottle",
      "kids water bottle",
      "leak proof bottle",
      "leak proof kids drinkware",
      "kids drinkware",
    ]);
    const shoes: ParsedQuery = {
      ...BOTTLE,
      keywords_en: "women running shoes",
      product_terms: ["running shoes"],
      requirements: [],
      category_hint: undefined,
    };
    expect(keywordLadder(shoes)).toEqual(["women running shoes", "running shoes"]);
  });

  it("keeps a named character in the category step and drops it only in the reduced steps", () => {
    // Live "Naruto pop", 2026-10-04: "pop figure" and "collectible figures" brought other anime.
    const naruto: ParsedQuery = {
      keywords_en: "naruto pop figure",
      product_terms: ["pop figure", "funko pop"],
      requirements: [{ en: "naruto", alt: ["naruto shippuden"], he: "נארוטו" }],
      sort_preference: "best_value",
      product_he: "פופ נארוטו",
      category_hint: "collectible figures",
    };
    expect(keywordSteps(naruto)).toEqual([
      { keywords: "naruto pop figure", kind: "primary" },
      { keywords: "pop figure", kind: "reduced" },
      { keywords: "naruto funko pop", kind: "term" },
      { keywords: "naruto collectible figures", kind: "category" },
      { keywords: "collectible figures", kind: "reduced" },
    ]);
    // Trust limited the first page: the steps that keep "naruto" come first.
    const lowTrust = times(50, () =>
      product({ title: `Naruto Funko Pop Figure ${word(serial)}`, positiveFeedbackPct: 80 }),
    );
    const first = call("naruto pop figure", 1, lowTrust);
    expect(after([first], naruto)).toEqual({ step: { keywords: "naruto funko pop", pageNo: 1 } });
    const second = call("naruto funko pop", 1, lowTrust);
    expect(after([first, second], naruto)).toEqual({
      step: { keywords: "naruto collectible figures", pageNo: 1 },
    });
  });

  it("drops praise words and never repeats a set of words", () => {
    expect(
      keywordLadder({
        ...BOTTLE,
        keywords_en: "durable leakproof water bottle",
        product_terms: ["water bottle"],
        category_hint: "bottle water",
      }),
    ).toEqual(["durable leakproof water bottle", "leakproof water bottle", "water bottle"]);
  });
});

describe("nextFetch", () => {
  it("starts with page 1 of the parse's keywords", () => {
    expect(after([])).toEqual({ step: { keywords: P, pageNo: 1 } });
  });

  it("stops once the first view and a page pass (TARGET_PASSED), and after MAX_ALI_CALLS calls", () => {
    expect(TARGET_PASSED).toBe(RESULTS_FIRST_VIEW + RESULTS_PER_PAGE);
    expect(MAX_ALI_CALLS).toBe(4);
    expect(
      after([
        call(
          P,
          1,
          times(TARGET_PASSED, () => good()),
        ),
      ]),
    ).toEqual({ stop: "enough" });
    // One short of it: page 2.
    expect(
      after([
        call(
          P,
          1,
          times(TARGET_PASSED - 1, () => good()),
        ),
      ]),
    ).toEqual({ step: { keywords: P, pageNo: 2 } });
    const four = [
      call(P, 1, [offType()]),
      call(P, 2, [offType()]),
      call("water bottle", 1, [offType()]),
      call("leakproof sports bottle", 1, [offType()]),
    ];
    expect(four).toHaveLength(MAX_ALI_CALLS);
    expect(after(four)).toEqual({ stop: "calls" });
    // One call before the limit, the search goes on.
    expect(after(four.slice(0, 3))).not.toEqual({ stop: "calls" });
  });

  it("takes page 2 while relevance limits the results and page 2 can still pass the trust bar", () => {
    const p1 = [...times(2, () => good()), ...times(47, () => offType())]; // 49 items
    expect(after([call(P, 1, p1)])).toEqual({ step: { keywords: P, pageNo: 2 } });
    // AliExpress did not say how many: a page of 40 or more counts as having more.
    expect(after([call(P, 1, p1, null)])).toEqual({ step: { keywords: P, pageNo: 2 } });
  });

  it("skips page 2 when there are no more records or when page 1 already sold under the bar", () => {
    const p1 = [...times(2, () => good()), ...times(20, () => offType())];
    const noMore = after([call(P, 1, p1, 22)]);
    expect(noMore).toEqual({ step: { keywords: "leakproof sports bottle", pageNo: 1 } });
    // Fewer than the first view pass (FILL_UP_TO): the bar is FILL_TIER's sales.
    const fill = FILL_TIER.minUnitsSold;
    const low = [
      ...times(2, () => good()),
      ...times(47, () => offType()),
      good({ unitsSold: fill - 1 }),
    ];
    expect(after([call(P, 1, low)])).toEqual(noMore);
    const fillable = [...times(2, () => good()), ...times(47, () => offType({ unitsSold: fill }))];
    // Off-type items at FILL_TIER's sales are volume rejections (trust): broader keywords first,
    // those that keep the requirement before those that drop it.
    expect(after([call(P, 1, fillable)])).toEqual({
      step: { keywords: "leakproof sports bottle", pageNo: 1 },
    });
    // With the first view passing, the bar is FILTERS' 100 sales.
    const view = [
      ...times(FILL_UP_TO, () => good()),
      ...times(48 - FILL_UP_TO, () => offType()),
      good({ unitsSold: 99 }),
    ];
    expect(after([call(P, 1, view)])).toEqual(noMore);
    const enough = [
      ...times(FILL_UP_TO, () => good()),
      ...times(48 - FILL_UP_TO, () => offType()),
      good({ unitsSold: 100 }),
    ];
    expect(after([call(P, 1, enough)])).toEqual({ step: { keywords: P, pageNo: 2 } });
    // One page passing is not the first view yet: page 2 may still pass at FILL_TIER's bar. An SEO
    // refresh (SEO_FETCH) fills one page only, as before, so there FILTERS' bar holds.
    const page = [
      ...times(RESULTS_PER_PAGE, () => good()),
      ...times(48 - RESULTS_PER_PAGE, () => offType()),
      good({ unitsSold: 99 }),
    ];
    expect(after([call(P, 1, page)])).toEqual({ step: { keywords: P, pageNo: 2 } });
    expect(SEO_FETCH.fillTo).toBe(RESULTS_PER_PAGE);
    const [seoCall] = call(P, 1, page);
    const seo = nextFetch({ filters: BOTTLE, calls: [seoCall], pool: page }, SEO_FETCH);
    expect(seo).not.toEqual({ step: { keywords: P, pageNo: 2 } });
  });

  it("goes to broader keywords first when trust limited the results, page 2 last", () => {
    const p1 = [good(), ...times(49, () => lowFeedback())];
    const low = (keywords: string) =>
      call(
        keywords,
        1,
        times(50, () => lowFeedback()),
      );
    // The steps that keep the requirement first, then those without it.
    expect(after([call(P, 1, p1)])).toEqual({
      step: { keywords: "leakproof sports bottle", pageNo: 1 },
    });
    const l1 = low("leakproof sports bottle");
    expect(after([call(P, 1, p1), l1])).toEqual({
      step: { keywords: "leakproof drink bottles", pageNo: 1 },
    });
    const l2 = low("leakproof drink bottles");
    expect(after([call(P, 1, p1), l1, l2])).toEqual({
      step: { keywords: "water bottle", pageNo: 1 },
    });
    // Page 2 only when no step is left.
    const noHint = { ...BOTTLE, product_terms: ["water bottle"], category_hint: undefined };
    expect(after([call(P, 1, p1), low("water bottle")], noHint)).toEqual({
      step: { keywords: P, pageNo: 2 },
    });
  });

  it("does not repeat keywords already fetched, whatever their word order", () => {
    const p1 = [good(), ...times(20, () => offType())];
    const tried = call("sports bottle leakproof", 1, [offType()]);
    expect(after([call(P, 1, p1, 21), tried])).toEqual({
      step: { keywords: "leakproof drink bottles", pageNo: 1 },
    });
  });

  it("stops early when a requirement blocks every otherwise passing product of 100 checked", () => {
    const p1 = times(50, noReq);
    const p2 = times(50, noReq);
    expect(after([call(P, 1, p1)])).toEqual({ step: { keywords: P, pageNo: 2 } });
    expect(REQUIREMENT_STOP_CHECKED).toBe(100);
    expect(after([call(P, 1, p1), call(P, 2, p2)])).toEqual({ stop: "requirement" });
    // Something passes: the requirement is not what blocks everything, so the search goes on.
    expect(after([call(P, 1, p1), call(P, 2, [...p2.slice(1), good()])])).toEqual({
      step: { keywords: "leakproof sports bottle", pageNo: 1 },
    });
  });

  it("tries another phrasing before page 2 when every product of page 1 was of another type", () => {
    // Live SEO page "מזוודה לילדים" (2026-10-04): "kids suitcase" brought stickers "for suitcase".
    const p1 = times(50, () => offType());
    expect(after([call(P, 1, p1)])).toEqual({
      step: { keywords: "leakproof sports bottle", pageNo: 1 },
    });
  });

  it("stops when no step is left", () => {
    const only: ParsedQuery = {
      ...BOTTLE,
      keywords_en: "water bottle",
      product_terms: ["water bottle"],
      requirements: [],
      category_hint: undefined,
    };
    expect(after([call("water bottle", 1, [offType()], 1)], only)).toEqual({ stop: "exhausted" });
  });
});

describe("lowestUnitsSold", () => {
  it("is the fewest sales on a page, a missing number counting as 0", () => {
    expect(lowestUnitsSold([{ unitsSold: 500 }, { unitsSold: 120 }])).toBe(120);
    expect(lowestUnitsSold([{ unitsSold: 500 }, { unitsSold: null }])).toBe(0);
    expect(lowestUnitsSold([])).toBeNull();
  });
});
