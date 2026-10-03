import { describe, expect, it } from "vitest";
import { HOT_CATEGORY_IDS } from "./categories";
import {
  HOT_MAX_PAGES,
  hotBack,
  hotBackHref,
  hotCanonicalPath,
  hotHref,
  hotProductHref,
  hotRedirectHref,
  isNarrowed,
  parseHotParams,
  type HotFilter,
} from "./params";

const DEFAULTS = { sort: "sales", withCode: false, withVideo: false, page: 1 } as const;

describe("parseHotParams", () => {
  it("defaults to the whole list by sales, page 1", () => {
    expect(parseHotParams({})).toEqual(DEFAULTS);
  });

  it("reads a curated category, a price band, a sort, the toggles and a page", () => {
    expect(
      parseHotParams({
        cat: "44",
        price: "50-100",
        sort: "price_asc",
        code: "1",
        video: "1",
        page: "3",
      }),
    ).toEqual({
      category: "44",
      price: "50-100",
      sort: "price_asc",
      withCode: true,
      withVideo: true,
      page: 3,
    });
  });

  it("drops a category outside the curated list, so no other list is ever fetched", () => {
    for (const cat of ["", "999", "200001508", "all", " 44", "44 ", "abc"]) {
      expect(parseHotParams({ cat })).toEqual(DEFAULTS);
    }
  });

  it("drops unknown price bands and sorts, and reads the toggles as on only for 1", () => {
    expect(parseHotParams({ price: "0-50", sort: "cheapest" })).toEqual(DEFAULTS);
    expect(parseHotParams({ price: "", sort: "" })).toEqual(DEFAULTS);
    expect(parseHotParams({ code: "on", video: "true" })).toEqual(DEFAULTS);
  });

  it("clamps the page to 1..HOT_MAX_PAGES and ignores anything that is not a whole number", () => {
    expect(parseHotParams({ page: "0" }).page).toBe(1);
    expect(parseHotParams({ page: "99" }).page).toBe(HOT_MAX_PAGES);
    for (const page of ["-2", "2.5", "abc", "", "1e3", " 2"]) {
      expect(parseHotParams({ page }).page).toBe(1);
    }
  });

  it("takes the first value of a repeated param and reads own keys only", () => {
    expect(parseHotParams({ cat: ["26", "44"], page: ["2", "4"] })).toMatchObject({
      category: "26",
      page: 2,
    });
    const inherited = Object.create({ cat: "44", code: "1" }) as Record<string, string>;
    expect(parseHotParams(inherited)).toEqual(DEFAULTS);
  });
});

const enc = (slug: string) => `/products/${encodeURIComponent(slug)}`;

describe("hotHref (the hub's mixed list)", () => {
  it("is the bare path for the defaults", () => {
    expect(hotHref({})).toBe("/products");
    expect(hotHref(DEFAULTS)).toBe("/products");
  });

  it("builds price, sort, code, video and page in that order, and never a category", () => {
    expect(
      hotHref({
        category: "44",
        price: "over-200",
        sort: "discount",
        withCode: true,
        withVideo: true,
        page: 2,
      }),
    ).toBe("/products?price=over-200&sort=discount&code=1&video=1&page=2");
  });

  it("round-trips through parseHotParams", () => {
    const filter: HotFilter = {
      price: "100-200",
      sort: "price_desc",
      withCode: false,
      withVideo: true,
      page: 4,
    };
    const url = new URL(hotHref(filter), "https://example.test");
    expect(parseHotParams(Object.fromEntries(url.searchParams))).toEqual(filter);
  });

  it("drops invalid values and caps the page", () => {
    const bad = {
      category: "999",
      price: "cheap",
      sort: "random",
      page: 0,
    } as unknown as HotFilter;
    expect(hotHref(bad)).toBe("/products");
    expect(hotHref({ page: 2.5 })).toBe("/products");
    expect(hotHref({ page: 50 })).toBe(`/products?page=${HOT_MAX_PAGES}`);
  });
});

describe("hotCanonicalPath", () => {
  it("is the category's page, or /products for the mix", () => {
    expect(hotCanonicalPath()).toBe("/products");
    expect(hotCanonicalPath("26")).toBe(enc("צעצועים"));
    // The whole Home & Garden list, never its decor slice.
    expect(hotCanonicalPath("15")).toBe(enc("בית-ומטבח"));
  });
});

describe("hotRedirectHref (/hot, permanently redirected)", () => {
  it("sends /hot to /products and keeps the filters that mean the same", () => {
    expect(hotRedirectHref({})).toBe("/products");
    expect(hotRedirectHref({ price: "50-100", sort: "discount", code: "1", page: "2" })).toBe(
      "/products?price=50-100&sort=discount&code=1&page=2",
    );
  });

  it("sends /hot?cat=<id> to that category's page with its filters, without cat", () => {
    expect(hotRedirectHref({ cat: "44" })).toBe(enc("אלקטרוניקה"));
    expect(hotRedirectHref({ cat: "7", price: "under-50", video: "1", page: "3" })).toBe(
      `${enc("מחשבים-ומשרד")}?price=under-50&video=1&page=3`,
    );
    for (const id of HOT_CATEGORY_IDS) {
      expect(hotRedirectHref({ cat: id }).startsWith("/products/")).toBe(true);
    }
  });

  it("drops an unknown category, an unknown filter and a bad page, as /hot did", () => {
    expect(hotRedirectHref({ cat: "999", sort: "random", page: "x" })).toBe("/products");
    expect(hotRedirectHref({ cat: "200001508" })).toBe("/products");
  });
});

describe("hotProductHref and hotBack", () => {
  it("links a card to /p with the list it came from, and /p back to that list", () => {
    expect(hotProductHref("1005009727076652", "44")).toBe("/p/1005009727076652?from=hot&cat=44");
    expect(hotProductHref("1005009727076652")).toBe("/p/1005009727076652?from=hot");
    // A slice's key is its second-level id.
    expect(hotProductHref("1", "3710")).toBe("/p/1?from=hot&cat=3710");
    const back = (href: string) =>
      hotBack(Object.fromEntries(new URL(href, "https://example.test").searchParams));
    expect(back(hotProductHref("1", "26"))).toMatchObject({
      href: enc("צעצועים"),
      label: "חזרה לצעצועים ומשחקי ילדים",
    });
    expect(back(hotProductHref("1", "3710"))?.href).toBe(enc("עיצוב-ואביזרי-נוי"));
    expect(back(hotProductHref("1"))).toEqual({
      href: "/products",
      label: "חזרה לכל המוצרים",
      category: null,
    });
  });

  it("keeps old /hot links (/p?from=hot&cat=<first-level id>) working", () => {
    expect(hotBackHref({ from: "hot", cat: "7" })).toBe(enc("מחשבים-ומשרד"));
    expect(hotBack({ from: "hot", cat: "7" })?.category?.key).toBe("7");
  });

  it("goes back only for from=hot, and never to a category outside the catalog", () => {
    expect(hotBackHref({})).toBeNull();
    expect(hotBackHref({ q: "אוזניות", cat: "44" })).toBeNull();
    expect(hotBackHref({ from: "recent" })).toBeNull();
    expect(hotBackHref({ from: "hot", cat: "999" })).toBe("/products");
    expect(hotBackHref({ from: ["hot", "x"], cat: ["15"] })).toBe(enc("בית-ומטבח"));
    expect(hotBackHref(Object.create({ from: "hot" }) as Record<string, string>)).toBeNull();
    expect(hotProductHref("1", "999")).toBe("/p/1?from=hot");
  });
});

describe("isNarrowed", () => {
  it("is true for a price band or a toggle, not for a sort", () => {
    expect(isNarrowed({ ...DEFAULTS, sort: "price_asc" })).toBe(false);
    expect(isNarrowed({ ...DEFAULTS, price: "under-50" })).toBe(true);
    expect(isNarrowed({ ...DEFAULTS, withCode: true })).toBe(true);
    expect(isNarrowed({ ...DEFAULTS, withVideo: true })).toBe(true);
  });
});
