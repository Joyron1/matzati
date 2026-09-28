import { describe, expect, it } from "vitest";
import {
  HOT_MAX_PAGES,
  hotBackHref,
  hotCanonicalPath,
  hotHref,
  hotProductHref,
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

describe("hotHref", () => {
  it("is the bare path for the defaults", () => {
    expect(hotHref({})).toBe("/hot");
    expect(hotHref(DEFAULTS)).toBe("/hot");
  });

  it("builds cat, price, sort, code, video and page in that order", () => {
    expect(
      hotHref({
        category: "44",
        price: "over-200",
        sort: "discount",
        withCode: true,
        withVideo: true,
        page: 2,
      }),
    ).toBe("/hot?cat=44&price=over-200&sort=discount&code=1&video=1&page=2");
  });

  it("round-trips through parseHotParams", () => {
    const filter: HotFilter = {
      category: "1501",
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
    expect(hotHref(bad)).toBe("/hot");
    expect(hotHref({ page: 2.5 })).toBe("/hot");
    expect(hotHref({ page: 50 })).toBe(`/hot?page=${HOT_MAX_PAGES}`);
  });
});

describe("hotCanonicalPath", () => {
  it("keeps only the category", () => {
    expect(hotCanonicalPath()).toBe("/hot");
    expect(hotCanonicalPath("26")).toBe("/hot?cat=26");
  });
});

describe("hotProductHref and hotBackHref", () => {
  it("links a card to /p with the list it came from, and /p back to that list", () => {
    expect(hotProductHref("1005009727076652", "44")).toBe("/p/1005009727076652?from=hot&cat=44");
    expect(hotProductHref("1005009727076652")).toBe("/p/1005009727076652?from=hot");
    const back = (href: string) =>
      hotBackHref(Object.fromEntries(new URL(href, "https://example.test").searchParams));
    expect(back(hotProductHref("1", "26"))).toBe("/hot?cat=26");
    expect(back(hotProductHref("1"))).toBe("/hot");
  });

  it("goes back only for from=hot, and never to a category outside the list", () => {
    expect(hotBackHref({})).toBeNull();
    expect(hotBackHref({ q: "אוזניות", cat: "44" })).toBeNull();
    expect(hotBackHref({ from: "recent" })).toBeNull();
    expect(hotBackHref({ from: "hot", cat: "999" })).toBe("/hot");
    expect(hotBackHref({ from: ["hot", "x"], cat: ["15"] })).toBe("/hot?cat=15");
    expect(hotBackHref(Object.create({ from: "hot" }) as Record<string, string>)).toBeNull();
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
