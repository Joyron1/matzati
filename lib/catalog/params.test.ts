import { describe, expect, it } from "vitest";
import { HOT_MAX_LIST_PAGES } from "@/lib/hot/categories";
import { catalogBySlug } from "./categories";
import {
  CATEGORY_MAX_STEPS,
  CATEGORY_PAGE_SIZE,
  categoryHref,
  nextCategoryStep,
  parseCategoryParams,
  type CategoryFilter,
} from "./params";

const jewelry = catalogBySlug("תכשיטים")!;
const decor = catalogBySlug("עיצוב-ואביזרי-נוי")!;
const base = `/products/${encodeURIComponent("תכשיטים")}`;
const DEFAULTS: CategoryFilter = {
  sort: "sales",
  withCode: false,
  withVideo: false,
  page: 1,
  lists: 1,
};

describe("parseCategoryParams", () => {
  it("defaults to every product of page 1 of the list, by sales", () => {
    expect(parseCategoryParams(jewelry, {})).toEqual(DEFAULTS);
  });

  it("reads a named sub-category or עוד, and drops any other", () => {
    expect(parseCategoryParams(jewelry, { sub: "1509" }).sub).toBe("1509");
    expect(parseCategoryParams(jewelry, { sub: "other" }).sub).toBe("other");
    for (const sub of ["405", "999", "", "__proto__", "1509 "]) {
      expect(parseCategoryParams(jewelry, { sub }).sub).toBeUndefined();
    }
    // A slice is one sub-category already.
    expect(parseCategoryParams(decor, { sub: "3710" }).sub).toBeUndefined();
  });

  it("caps the lists at HOT_MAX_LIST_PAGES and the steps at what 3 lists can fill", () => {
    expect(HOT_MAX_LIST_PAGES).toBe(3);
    expect(CATEGORY_MAX_STEPS).toBe(Math.ceil(150 / CATEGORY_PAGE_SIZE));
    expect(parseCategoryParams(jewelry, { lists: "3" }).lists).toBe(3);
    expect(parseCategoryParams(jewelry, { lists: "99" }).lists).toBe(3);
    expect(parseCategoryParams(jewelry, { page: "999" }).page).toBe(CATEGORY_MAX_STEPS);
    for (const v of ["0", "-1", "2.5", "x", "", "1e3"]) {
      expect(parseCategoryParams(jewelry, { lists: v, page: v })).toMatchObject({
        lists: 1,
        page: 1,
      });
    }
  });

  it("reads /hot's view params as /hot did, and own keys only", () => {
    expect(
      parseCategoryParams(jewelry, {
        price: "50-100",
        sort: "discount",
        code: "1",
        video: "1",
        page: "2",
      }),
    ).toEqual({
      ...DEFAULTS,
      price: "50-100",
      sort: "discount",
      withCode: true,
      withVideo: true,
      page: 2,
    });
    const inherited = Object.create({ sub: "1509", lists: "3" }) as Record<string, string>;
    expect(parseCategoryParams(jewelry, inherited)).toEqual(DEFAULTS);
  });
});

describe("categoryHref", () => {
  it("is the bare path for the defaults, and round-trips a full filter", () => {
    expect(categoryHref(jewelry, {})).toBe(base);
    expect(categoryHref(jewelry, DEFAULTS)).toBe(base);
    const filter: CategoryFilter = {
      sub: "1509",
      price: "under-50",
      sort: "price_asc",
      withCode: true,
      withVideo: false,
      page: 4,
      lists: 2,
    };
    const href = categoryHref(jewelry, filter);
    expect(href).toBe(`${base}?sub=1509&price=under-50&sort=price_asc&code=1&page=4&lists=2`);
    const url = new URL(href, "https://example.test");
    expect(parseCategoryParams(jewelry, Object.fromEntries(url.searchParams))).toEqual(filter);
  });

  it("never links past the caps or to a sub-category the page does not name", () => {
    expect(categoryHref(jewelry, { lists: 9, page: 99, sub: "405" })).toBe(
      `${base}?page=${CATEGORY_MAX_STEPS}&lists=${HOT_MAX_LIST_PAGES}`,
    );
  });
});

describe('nextCategoryStep ("הצגת עוד מוצרים")', () => {
  it("shows the next step of the products already loaded first: no call", () => {
    expect(nextCategoryStep(DEFAULTS, 12, 40, true)).toEqual({ ...DEFAULTS, page: 2 });
  });

  it("asks for the next page of the list only once every loaded product is shown", () => {
    const step4 = { ...DEFAULTS, page: 4 };
    expect(nextCategoryStep(step4, 40, 40, true)).toEqual({ ...step4, page: 5, lists: 2 });
    expect(nextCategoryStep({ ...step4, lists: 2 }, 80, 80, true)).toEqual({
      ...step4,
      page: 5,
      lists: 3,
    });
  });

  it("never asks for a 4th page, after a page that failed, or past the last step", () => {
    expect(nextCategoryStep({ ...DEFAULTS, page: 9, lists: 3 }, 100, 100, true)).toBeNull();
    expect(nextCategoryStep({ ...DEFAULTS, page: 4 }, 40, 40, false)).toBeNull();
    expect(
      nextCategoryStep({ ...DEFAULTS, page: CATEGORY_MAX_STEPS, lists: 2 }, 100, 140, true),
    ).toBeNull();
  });
});
