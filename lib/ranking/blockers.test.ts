import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { SearchFilters } from "@/lib/search/filters";
import {
  filterRelaxations,
  passedCount,
  requirementBlocksAll,
  usefulRelaxations,
} from "./blockers";

const CHARGER: SearchFilters = {
  keywords_en: "65w fast charger",
  product_terms: ["fast charger", "65w charger"],
  requirements: [
    { en: "65w", alt: [], he: "65W" },
    { en: "multi-device", alt: ["laptop and phone"], he: "לטלפון ולמחשב נייד" },
  ],
  max_price_ils: 100,
  sort_preference: "best_value",
};

let serial = 0;
const word = (n: number) => n.toString(26).replace(/\d/g, (d) => "qrstuvwxyz"[Number(d)]) + "x";
function product(title: string, o: Partial<AliProduct> = {}): AliProduct {
  const n = serial++;
  const id = String(1005000000000000 + n);
  return {
    productId: id,
    title: `${title} ${word(n)} ${n}`,
    price: 50,
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
const times = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make);

// The recorded tech-charger case: 65W chargers, none of which says it is for a laptop and a phone.
const chargers = () => times(8, () => product("65W Fast Charger GaN USB C"));

describe("filterRelaxations", () => {
  it("counts, per removable filter, the products that pass every other one", () => {
    const pool = [
      ...chargers(),
      ...times(2, () => product("65W Fast Charger for Laptop and Phone", { price: 150 })),
      ...times(3, () => product("20W Fast Charger")),
      product("65W Fast Charger", { positiveFeedbackPct: 80 }),
    ];
    expect(passedCount(pool, CHARGER)).toBe(0);
    expect(filterRelaxations(pool, CHARGER)).toEqual([
      { chipId: "req:65w", kind: "requirement", wouldPass: 0, titleMatches: 11, sizeCap: false },
      {
        chipId: "req:multi-device",
        kind: "requirement",
        wouldPass: 8,
        titleMatches: 2,
        sizeCap: false,
      },
      { chipId: "max", kind: "max_price", wouldPass: 2, titleMatches: null, sizeCap: false },
    ]);
  });

  it("includes the minimum price, and nothing for a search without removable filters", () => {
    const f: SearchFilters = { ...CHARGER, requirements: [], min_price_ils: 60 };
    delete f.max_price_ils;
    const pool = chargers();
    expect(filterRelaxations(pool, f)).toEqual([
      { chipId: "min", kind: "min_price", wouldPass: 8, titleMatches: null, sizeCap: false },
    ]);
    expect(filterRelaxations(pool, { ...f, min_price_ils: undefined })).toEqual([]);
  });

  it("marks the capacity of a small search, which bigger titles mention and still fail", () => {
    const bank: SearchFilters = {
      keywords_en: "mini power bank 10000mah",
      product_terms: ["power bank"],
      requirements: [{ en: "10000mah", alt: [], he: "10000 מיליאמפר" }],
      sort_preference: "best_value",
    };
    const pool = times(4, () => product("20000mAh Power Bank PD 20W"));
    const [r] = filterRelaxations(pool, bank);
    expect(r).toMatchObject({ wouldPass: 4, titleMatches: 4, sizeCap: true });
    expect(
      filterRelaxations(pool, { ...bank, keywords_en: "power bank 10000mah" })[0].sizeCap,
    ).toBe(false);
  });
});

describe("usefulRelaxations", () => {
  it("keeps only removals that let more through, most products first, a requirement before a price", () => {
    const pool = [
      ...chargers(),
      ...times(2, () => product("65W Fast Charger for Laptop and Phone", { price: 150 })),
    ];
    expect(usefulRelaxations(pool, CHARGER).map((r) => [r.chipId, r.wouldPass])).toEqual([
      ["req:multi-device", 8],
      ["max", 2],
    ]);
    // A tie between a requirement and a price: the requirement first.
    const tie = [
      ...times(2, () => product("65W Fast Charger GaN")),
      ...times(2, () => product("65W Fast Charger for Laptop and Phone", { price: 150 })),
    ];
    expect(usefulRelaxations(tie, CHARGER).map((r) => r.chipId)).toEqual([
      "req:multi-device",
      "max",
    ]);
  });

  it("measures against what passes now (partial results)", () => {
    const pool = [...chargers(), product("65W Fast Charger for Laptop and Phone")];
    expect(passedCount(pool, CHARGER)).toBe(1);
    expect(usefulRelaxations(pool, CHARGER).map((r) => [r.chipId, r.wouldPass])).toEqual([
      ["req:multi-device", 9],
    ]);
    expect(usefulRelaxations(pool, CHARGER, 9)).toEqual([]);
  });
});

describe("requirementBlocksAll", () => {
  it("is true only when nothing passes and removing one requirement lets products through", () => {
    expect(requirementBlocksAll(chargers(), CHARGER)).toBe(true);
    const onePasses = [...chargers(), product("65W Fast Charger for Laptop and Phone")];
    expect(requirementBlocksAll(onePasses, CHARGER)).toBe(false);
    // Nothing passes, but not because of a requirement: the wrong product type.
    const offType = times(5, () => product("Kitchen Sponge"));
    expect(requirementBlocksAll(offType, CHARGER)).toBe(false);
    expect(requirementBlocksAll([], CHARGER)).toBe(false);
  });
});
