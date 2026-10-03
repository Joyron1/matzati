import { describe, expect, it } from "vitest";
import type { HotProduct } from "@/lib/hot/select";
import { catalogBySlug } from "./categories";
import {
  inSubcategory,
  mergeCategoryPages,
  subcategoryOf,
  subcategoryPills,
  type ListPage,
} from "./list";

const hot = (id: string, sub: string | null, overrides: Partial<HotProduct> = {}): HotProduct => ({
  productId: id,
  title: `מוצר ${id}`,
  imageUrl: `https://ae-pic-a1.aliexpress-media.com/kf/${id}.jpg`,
  price: 50,
  originalPrice: null,
  discountPct: null,
  positiveFeedbackPct: 96,
  unitsSold: 500,
  hasVideo: false,
  promoCode: null,
  categoryId: "15",
  subcategoryId: sub,
  shopId: `shop-${id}`,
  ...overrides,
});

const page = (products: HotProduct[], fetchedAt: string, checked = 50): ListPage => ({
  products,
  checked,
  fetchedAt,
});

const home = catalogBySlug("בית-ומטבח")!;
const decor = catalogBySlug("עיצוב-ואביזרי-נוי")!;

describe("mergeCategoryPages", () => {
  it("merges the pages in order, once per product, summing what was checked", () => {
    const merged = mergeCategoryPages(home, [
      page([hot("1", "3710"), hot("2", "405")], "2026-10-03T08:00:00.000Z", 47),
      page([hot("2", "405"), hot("3", "125")], "2026-10-03T06:00:00.000Z", 46),
    ]);
    expect(merged?.products.map((p) => p.productId)).toEqual(["1", "2", "3"]);
    expect(merged?.checked).toBe(93);
    // Every price shown was checked at the oldest time or later.
    expect(merged?.checkedFrom).toBe("2026-10-03T06:00:00.000Z");
  });

  it("keeps at most 2 products of one shop over all pages, page 1's first", () => {
    const shop = { shopId: "same" };
    const merged = mergeCategoryPages(home, [
      page([hot("1", "3710", shop), hot("2", "405", shop)], "2026-10-03T08:00:00.000Z"),
      page([hot("3", "125", shop), hot("4", "125")], "2026-10-03T08:00:00.000Z"),
    ]);
    expect(merged?.products.map((p) => p.productId)).toEqual(["1", "2", "4"]);
  });

  it("keeps only a slice's own second-level category, before the shop cap (a slice fetched through its parent list)", () => {
    const shop = { shopId: "same" };
    const filtered = { ...decor, slice: { subcategoryId: "3710", directFetch: false } };
    const merged = mergeCategoryPages(filtered, [
      page(
        [hot("1", "405", shop), hot("2", "405", shop), hot("3", "3710", shop), hot("4", null)],
        "2026-10-03T08:00:00.000Z",
      ),
    ]);
    expect(merged?.products.map((p) => p.productId)).toEqual(["3"]);
  });

  it("is null without a page", () => {
    expect(mergeCategoryPages(home, [])).toBeNull();
  });
});

describe("sub-category pills (filtering the loaded list, no call)", () => {
  const products = [
    hot("1", "3710"),
    hot("2", "200000920"),
    hot("3", "200000920"),
    hot("4", null),
    hot("5", "999999"), // a second-level id we have no name for
    hot("6", "405"),
  ];

  it("groups by our Hebrew names, most products first, unnamed ones under עוד last", () => {
    expect(subcategoryPills(home, products)).toEqual([
      { id: "200000920", labelHe: "מטבח והגשה", count: 2 },
      { id: "405", labelHe: "טקסטיל לבית", count: 1 },
      { id: "3710", labelHe: "עיצוב הבית", count: 1 },
      { id: "other", labelHe: "עוד", count: 2 },
    ]);
  });

  it("shows no pills for a slice, or when everything is in one group", () => {
    expect(subcategoryPills(decor, products)).toEqual([]);
    expect(subcategoryPills(home, [hot("1", "405"), hot("2", "405")])).toEqual([]);
    expect(subcategoryPills(home, [])).toEqual([]);
  });

  it("filters the list by a pill, and keeps everything without one", () => {
    expect(inSubcategory("15", products, "200000920").map((p) => p.productId)).toEqual(["2", "3"]);
    expect(inSubcategory("15", products, "other").map((p) => p.productId)).toEqual(["4", "5"]);
    expect(inSubcategory("15", products, undefined)).toBe(products);
    expect(subcategoryOf("15", hot("x", "405"))).toBe("405");
    expect(subcategoryOf("44", hot("x", "405"))).toBe("other"); // named under 15 only
  });
});
