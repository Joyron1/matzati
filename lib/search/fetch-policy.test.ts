import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import {
  keywordLadder,
  keywordSteps,
  lowestUnitsSold,
  MAX_ALI_CALLS,
  nextFetch,
  REQUIREMENT_STOP_CHECKED,
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
      { keywords: "children lighting", kind: "category" },
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

  it("stops once 6 pass, and after MAX_ALI_CALLS calls", () => {
    expect(
      after([
        call(
          P,
          1,
          times(7, () => good()),
        ),
      ]),
    ).toEqual({ stop: "enough" });
    const three = [
      call(P, 1, [offType()]),
      call(P, 2, [offType()]),
      call("water bottle", 1, [offType()]),
    ];
    expect(three).toHaveLength(MAX_ALI_CALLS);
    expect(after(three)).toEqual({ stop: "calls" });
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
    // Fewer than a page pass: the bar is FILL_TIER's 30 sales.
    const low = [...times(2, () => good()), ...times(47, () => offType()), good({ unitsSold: 29 })];
    expect(after([call(P, 1, low)])).toEqual(noMore);
    const fillable = [...times(2, () => good()), ...times(47, () => offType({ unitsSold: 30 }))];
    // 30-sale off-type items are volume rejections (trust): broader keywords first.
    expect(after([call(P, 1, fillable)])).toEqual({
      step: { keywords: "water bottle", pageNo: 1 },
    });
    // With a page passing, the bar is FILTERS' 100 sales.
    const three = [
      ...times(3, () => good()),
      ...times(45, () => offType()),
      good({ unitsSold: 99 }),
    ];
    expect(after([call(P, 1, three)])).toEqual(noMore);
    const enough = [
      ...times(3, () => good()),
      ...times(45, () => offType()),
      good({ unitsSold: 100 }),
    ];
    expect(after([call(P, 1, enough)])).toEqual({ step: { keywords: P, pageNo: 2 } });
  });

  it("goes to broader keywords first when trust limited the results, page 2 last", () => {
    const p1 = [good(), ...times(49, () => lowFeedback())];
    expect(after([call(P, 1, p1)])).toEqual({ step: { keywords: "water bottle", pageNo: 1 } });
    const l1 = call(
      "water bottle",
      1,
      times(50, () => lowFeedback()),
    );
    // Still trust: the other broader steps, and page 2 only when none is left.
    const two = after([call(P, 1, p1), l1]);
    expect(two).toEqual({ step: { keywords: "leakproof sports bottle", pageNo: 1 } });
    const noHint = { ...BOTTLE, product_terms: ["water bottle"], category_hint: undefined };
    expect(after([call(P, 1, p1), l1], noHint)).toEqual({ step: { keywords: P, pageNo: 2 } });
  });

  it("does not repeat keywords already fetched, whatever their word order", () => {
    const p1 = [good(), ...times(20, () => offType())];
    const tried = call("sports bottle leakproof", 1, [offType()]);
    expect(after([call(P, 1, p1, 21), tried])).toEqual({
      step: { keywords: "water bottle", pageNo: 1 },
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
