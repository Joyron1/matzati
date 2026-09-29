import { describe, expect, it } from "vitest";
import { SEO_MAX_PRODUCTS } from "@/lib/config/site";
import type { ResultProduct } from "@/lib/types";
import { fixtureResults } from "./results-fixture";
import {
  chunk,
  fitForStorage,
  groupsToExplain,
  jsonbTextBytes,
  leanProduct,
  shownCount,
  shownGroups,
  SNAPSHOT_BUDGET_BYTES,
  SNAPSHOT_LIMIT_BYTES,
  type SeoResults,
} from "./results";
import { placesLabel } from "./places";

/** The largest product a page stores: the longest title and line explain allows, long numbers. */
function largest(p: ResultProduct): ResultProduct {
  return {
    ...p,
    title_he: "א".repeat(80),
    title_en: "W".repeat(250),
    why_he: "ב".repeat(120),
    price_ils: 12345.67,
    original_price_ils: 24691.34,
    discount_pct: 50,
    positive_feedback_pct: 99.9,
    units_sold: 1234567,
    shared_numbers: { feedback: true, sales: true },
    image_urls: [`https://ae-pic-a1.aliexpress-media.com/kf/S${"a".repeat(40)}.jpg`],
    category_id: "200000000",
  };
}

const worst = (r: SeoResults): SeoResults => ({ ...r, results: r.results.map(largest) });

describe("groups", () => {
  it("shows every group before the first pending one", () => {
    const r = fixtureResults(23, { states: ["model", "data", "pending", "model"] });
    expect(shownGroups(r).map((g) => g.length)).toEqual([5, 5]);
    expect(shownCount(r)).toBe(10);
    expect(groupsToExplain(r)).toBe(2);
    expect(shownCount(fixtureResults(23))).toBe(23);
    expect(chunk([1, 2, 3, 4, 5, 6, 7])).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
  });

  it("keeps one photo per product, the one the cards show", () => {
    const p = { ...fixtureResults(1).results[0], image_urls: ["a", "b", "c"] };
    expect(leanProduct(p).image_urls).toEqual(["a"]);
  });

  it("names a group's places", () => {
    expect(placesLabel(6, 5)).toBe("מקומות 6–10");
    expect(placesLabel(46, 1)).toBe("מקום 46");
  });
});

describe("storage (seo_pages_results_shape: 256 KB)", () => {
  it("measures the jsonb text as Postgres writes it (a space after : and ,)", () => {
    expect(jsonbTextBytes({ a: 1, b: [1, 2] })).toBe('{"a": 1, "b": [1, 2]}'.length);
    expect(jsonbTextBytes({ h: "אב" })).toBe(new TextEncoder().encode('{"h": "אב"}').length);
    expect(jsonbTextBytes({ a: undefined, b: null })).toBe('{"b": null}'.length);
  });

  it("fits 50 of the largest products, and a waiting run of 50 beside them, well under the limit", () => {
    const shown = worst(fixtureResults(SEO_MAX_PRODUCTS));
    const next = worst(fixtureResults(SEO_MAX_PRODUCTS, { offset: 100 }));
    const bytes = jsonbTextBytes({ ...shown, next });
    expect(bytes).toBeLessThan(SNAPSHOT_BUDGET_BYTES);
    expect(SNAPSHOT_BUDGET_BYTES).toBeLessThan(SNAPSHOT_LIMIT_BYTES);
    // No migration is needed: one page of 50 takes about a sixth of the limit.
    expect(jsonbTextBytes(shown)).toBeLessThan(SNAPSHOT_LIMIT_BYTES / 4);
    expect(fitForStorage({ ...shown, next })).toEqual({ ...shown, next });
  });

  it("drops the waiting run first, then the last groups, when a shape grows past the budget", () => {
    const huge = (r: SeoResults): SeoResults => ({
      ...r,
      results: r.results.map((p) => ({ ...p, title_en: "W".repeat(3_000) })),
    });
    const shown = huge(fixtureResults(SEO_MAX_PRODUCTS));
    const next = huge(fixtureResults(SEO_MAX_PRODUCTS, { offset: 100 }));
    const fitted = fitForStorage({ ...shown, next });
    expect(fitted.next).toBeUndefined();
    expect(jsonbTextBytes(fitted)).toBeLessThanOrEqual(SNAPSHOT_BUDGET_BYTES);
    expect(fitted.groups.length).toBeGreaterThan(1);
    expect(fitted.results.map((p) => p.product_id)).toEqual(fitted.groups.flatMap((g) => g.ids));
  });
});
