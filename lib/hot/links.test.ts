// Hot links (promotion_link_type 2) for hot products, and the rule that the hot rate never
// changes what is shown or in what order. Pure: fixtures from the probe of 2026-09-28
// (fixtures/aliexpress/probe-hot, masked), nothing reaches AliExpress.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HOT_LINK_TYPE, itemSourceUrl } from "@/lib/aliexpress/affiliate";
import { parseEnvelope, parseJsonKeepingIds } from "@/lib/aliexpress/client";
import {
  parseProductPage,
  parsePromotionLinks,
  type AliProduct,
  type AliPromotionLink,
} from "@/lib/aliexpress/schemas";
import { rankWithFill } from "@/lib/ranking/rank";
import type { SearchFilters } from "@/lib/search/filters";
import { hotLinkSources, paysHotRate, withHotLinks } from "./links";
import {
  HOT_SORTS,
  interleaveHotProducts,
  mixHotProducts,
  selectHotProducts,
  toHotProduct,
  viewHotProducts,
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
    promotionLink: "https://s.click.aliexpress.com/s/list",
    shop: { id: null, name: null, url: null },
    commissionRatePct: 7,
    hotCommissionRatePct: 8,
    category: { firstId: "44", firstName: null, secondId: null, secondName: null },
    videoUrl: null,
    promoCode: null,
    ...overrides,
  };
}

function parsed<T>(method: string, file: string, parse: (result: unknown) => T): T {
  const text = readFileSync(`fixtures/aliexpress/${file}.json`, "utf8");
  return parse(parseEnvelope(method, parseJsonKeepingIds(text)).result);
}

const hotFixture = (name: string) =>
  parsed(
    "aliexpress.affiliate.hotproduct.query",
    `probe-hot/aliexpress.affiliate.hotproduct.query.${name}`,
    (r) => parseProductPage(r).products,
  );

/** The masked type 2 answer of the probe: 3 /e/ links. */
const TYPE2_LINKS = parsed(
  "aliexpress.affiliate.link.generate",
  "probe-hot/aliexpress.affiliate.link.generate.type2",
  parsePromotionLinks,
);

const ids = (ps: { productId: string }[]) => ps.map((p) => p.productId);
const MADE_AT = "2026-09-28T12:00:01.100Z";

describe("paysHotRate", () => {
  it("is true only when both rates are known and the hot one is higher", () => {
    expect(paysHotRate({ commissionRatePct: 7, hotCommissionRatePct: 8 })).toBe(true);
    expect(paysHotRate({ commissionRatePct: 7, hotCommissionRatePct: 7 })).toBe(false);
    expect(paysHotRate({ commissionRatePct: 7, hotCommissionRatePct: 3.5 })).toBe(false);
    expect(paysHotRate({ commissionRatePct: 7, hotCommissionRatePct: null })).toBe(false);
    expect(paysHotRate({ commissionRatePct: 7 })).toBe(false); // saved before the field
    expect(paysHotRate({ commissionRatePct: null, hotCommissionRatePct: 8 })).toBe(false);
  });
});

describe("hotLinkSources", () => {
  it("asks for the item URL of each product that pays a hot rate, once, at most 50", () => {
    const list = [
      product({ productId: "a" }),
      product({ productId: "b", hotCommissionRatePct: 3.5 }),
      product({ productId: "c", hotCommissionRatePct: null }),
      product({ productId: "a" }),
      product({ productId: "d", hotCommissionRatePct: 15 }),
    ];
    expect(hotLinkSources(list)).toEqual([itemSourceUrl("a"), itemSourceUrl("d")]);
    const many = Array.from({ length: 60 }, (_, i) => product({ productId: String(i) }));
    expect(hotLinkSources(many)).toHaveLength(50);
    expect(hotLinkSources([product({ hotCommissionRatePct: 0 })])).toEqual([]);
  });

  it("asks for 44 of the 46 products of the category 44 list", () => {
    expect(hotLinkSources(hotFixture("cat44-HE"))).toHaveLength(44);
  });
});

describe("withHotLinks", () => {
  const [id1, id2, id3] = TYPE2_LINKS.map((l) => l.sourceValue.match(/item\/(\d+)/)![1]);

  it("puts the real type 2 answer's links on the products asked for, marked and dated", () => {
    const list = [
      product({ productId: id1 }),
      product({ productId: "no-hot-rate", hotCommissionRatePct: null }),
      product({ productId: id2 }),
      product({ productId: id3, hotCommissionRatePct: 6 }), // not asked: its hot rate is lower
    ];
    const out = withHotLinks(list, TYPE2_LINKS, MADE_AT);
    expect(ids(out)).toEqual(ids(list));
    expect(out[0]).toEqual({
      ...list[0],
      promotionLink: TYPE2_LINKS[0].promotionLink,
      promotionLinkType: HOT_LINK_TYPE,
      promotionLinkAt: MADE_AT,
    });
    expect(out[2]).toMatchObject({
      promotionLink: TYPE2_LINKS[1].promotionLink,
      promotionLinkType: 2,
    });
    expect(out[0].promotionLink).toMatch(/^https:\/\/s\.click\.aliexpress\.com\/e\/_/);
    // The others keep the list's own link, with no type.
    expect(out[1]).toBe(list[1]);
    expect(out[3]).toBe(list[3]);
    expect(out[3].promotionLinkType).toBeUndefined();
  });

  it("accepts only https AliExpress links, one per product", () => {
    const link = (id: string, promotionLink: string | null): AliPromotionLink => ({
      sourceValue: itemSourceUrl(id),
      promotionLink,
      message: null,
    });
    const list = ["101", "102", "103", "104", "105"].map((productId) => product({ productId }));
    const out = withHotLinks(
      list,
      [
        link("101", "https://evil.test/redirect"),
        link("102", "http://s.click.aliexpress.com/e/_b"),
        link("103", null),
        link("104", "https://s.click.aliexpress.com/e/_d1"),
        link("104", "https://s.click.aliexpress.com/e/_d2"),
        {
          sourceValue: "https://www.aliexpress.com/store/9.html",
          promotionLink: "x",
          message: null,
        },
        link("105", "https://s.click.aliexpress.com/e/_e"),
      ],
      MADE_AT,
    );
    expect(out.map((p) => p.promotionLinkType ?? null)).toEqual([null, null, null, 2, 2]);
    expect(out.map((p) => p.promotionLink)).toEqual([
      list[0].promotionLink,
      list[1].promotionLink,
      list[2].promotionLink,
      "https://s.click.aliexpress.com/e/_d1",
      "https://s.click.aliexpress.com/e/_e",
    ]);
  });

  it("ignores a link for a product that was not asked for", () => {
    const list = [product({ productId: id1, hotCommissionRatePct: 7 })];
    expect(withHotLinks(list, TYPE2_LINKS, MADE_AT)).toEqual(list);
    expect(withHotLinks(list, [], MADE_AT)).toEqual(list);
  });
});

// CLAUDE.md §6.6: commission may only break exact ties. The hot rate is stored for stats and
// chooses a link type, nothing else.
describe("the hot rate never changes what is shown or in what order", () => {
  /** The same products with the hot rate removed, and with it scrambled. */
  const variants = (list: AliProduct[]) => [
    list.map((p) => {
      const copy = { ...p };
      delete copy.hotCommissionRatePct;
      return copy;
    }),
    list.map((p, i) => ({ ...p, hotCommissionRatePct: i % 2 ? 15 : null })),
    list.map((p, i) => ({ ...p, hotCommissionRatePct: 50 - i })),
  ];

  it("keeps the hot list selection, views, mix and carousel identical", () => {
    const lists = ["cat44-HE", "cat44-EN", "cat44-HE.page2", "all-HE"].map(hotFixture);
    const now = new Date("2026-09-28T12:00:00Z");
    const shown = (ls: AliProduct[][]) => {
      const selected = ls.map((l) => selectHotProducts(l).map(toHotProduct));
      return {
        selected: selected.map(ids),
        views: HOT_SORTS.map((sort) =>
          ids(viewHotProducts(selected[0], { sort, withCode: false, withVideo: false }, now)),
        ),
        mix: ids(mixHotProducts(selected)),
        carousel: ids(interleaveHotProducts(selected, 16)),
      };
    };
    const base = shown(lists);
    expect(base.selected[0].length).toBeGreaterThan(30);
    for (const i of [0, 1, 2]) {
      expect(shown(lists.map((l) => variants(l)[i]))).toEqual(base);
    }
  });

  it("keeps search ranking identical, ties included", () => {
    const filters: SearchFilters = {
      keywords_en: "usb cable",
      product_terms: ["usb cable", "charging cable"],
      requirements: [],
      sort_preference: "best_value",
    };
    const query = parsed(
      "aliexpress.affiliate.product.query",
      "aliexpress.affiliate.product.query",
      (r) => parseProductPage(r).products,
    );
    // Exact ties: the same data under two ids; commission_rate equal, the hot rate apart.
    const tied = [
      product({
        productId: "t1",
        title: "USB Cable Type C Fast Charging 1m",
        hotCommissionRatePct: 3,
      }),
      product({
        productId: "t2",
        title: "USB Cable Type C Fast Charging 2m",
        hotCommissionRatePct: 15,
      }),
    ];
    for (const list of [query, tied]) {
      const base = rankWithFill(list, filters, 3);
      expect(base.ranked.length).toBeGreaterThan(0);
      for (const variant of variants(list)) {
        const ranked = rankWithFill(variant, filters, 3);
        expect(ids(ranked.ranked)).toEqual(ids(base.ranked));
        expect(ranked.fillIds).toEqual(base.fillIds);
      }
    }
    // t2 pays the higher hot rate, yet the tie is still broken by id.
    expect(ids(rankWithFill(tied, filters, 3).ranked)[0]).toBe("t1");
  });
});
