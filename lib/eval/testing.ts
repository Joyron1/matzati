// Builders for synthetic snapshots in the lib/eval tests. Titles are built to stay far apart for
// duplicate detection, and every product has its own shop, so the tests measure the replay and not
// the ranking rules.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { ParsedQuery } from "@/lib/search/filters";
import type { Snapshot, SnapshotCall } from "./snapshot";

const WORDS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "mike",
  "november",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "tango",
];

/** Ladder: "leakproof water bottle", then "water bottle" (requirement removed), then the hint. */
export const BOTTLE: ParsedQuery = {
  keywords_en: "leakproof water bottle",
  product_terms: ["water bottle"],
  requirements: [{ en: "leakproof", alt: [], he: "לא נוזל" }],
  sort_preference: "best_value",
  product_he: "בקבוק מים",
  category_hint: "drink bottles",
};

let serial = 0;

export function product(overrides: Partial<AliProduct> = {}): AliProduct {
  const n = serial++;
  const id = overrides.productId ?? String(1005000000000000 + n);
  return {
    productId: id,
    title: `Leakproof Water Bottle ${WORDS[n % WORDS.length]} ${n}`,
    price: 20,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 97,
    unitsSold: 1000 + n,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: [],
    detailUrl: `https://www.aliexpress.com/item/${id}.html`,
    promotionLink: "<promotion_link omitted>",
    shop: { id: `shop-${id}`, name: null, url: null },
    commissionRatePct: 5,
    category: { firstId: null, firstName: null, secondId: null, secondName: null },
    ...overrides,
  };
}

/** Passes every filter of BOTTLE. */
export const good = (o: Partial<AliProduct> = {}) => product(o);
/** Fails the type gate of BOTTLE (no product term), trust fine. */
export const offType = (o: Partial<AliProduct> = {}) =>
  product({ title: `Kitchen Sponge ${WORDS[serial % WORDS.length]} ${serial}`, ...o });
/** Fails on feedback. */
export const lowFeedback = (o: Partial<AliProduct> = {}) =>
  product({ positiveFeedbackPct: 80, ...o });

export const times = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make);

export function call(
  step: string,
  keywords: string,
  pageNo: number,
  products: AliProduct[],
  o: Partial<SnapshotCall> = {},
): SnapshotCall {
  return {
    step,
    keywords,
    pageNo,
    pageSize: 50,
    sort: "LAST_VOLUME_DESC",
    minPriceIls: null,
    maxPriceIls: null,
    rawCount: products.length,
    parsedCount: products.length,
    totalRecords: 1000,
    error: null,
    products,
    ...o,
  };
}

export function snapshot(
  calls: SnapshotCall[],
  o: Partial<Omit<Snapshot, "parse">> & { parsed?: ParsedQuery } = {},
): Snapshot {
  const { parsed = BOTTLE, ...rest } = o;
  return {
    format: 1,
    id: "bottle",
    group: "eval",
    query: "בקבוק מים שלא נוזל",
    sameQueryAs: null,
    capturedAt: "2026-09-28T08:00:00.000Z",
    parse: { source: "recorded", parseVersion: 5, parsed },
    calls,
    ...rest,
  };
}
