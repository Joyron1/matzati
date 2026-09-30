// The checked pool kept with a result set (plan item 13), over the real snapshots: every view it
// serves is exactly what ranking the whole pool for that request gives, a removed requirement
// re-admits only products that pass every remaining filter, and the pool stays bounded.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_KEPT, RESULTS_PER_PAGE } from "@/lib/config/site";
import { loadSnapshots, SNAPSHOT_DIR } from "@/lib/eval/files";
import { distinctProducts } from "@/lib/eval/snapshot";
import { FILL_TIER, FILTERS, SHOP_CAP_MODES } from "@/lib/ranking/config";
import { passesFilters, rankForSearch, rejectReason } from "@/lib/ranking/rank";
import { filtersKey } from "./cache-key";
import { applyOverrides, MAX_CHIP, MIN_CHIP, requirementChipId } from "./chips";
import type { ParsedQuery } from "./filters";
import {
  poolFrom,
  poolOf,
  poolView,
  rankView,
  removedPrices,
  removedRequirements,
  SORTS,
  viewKeyOf,
  viewSpecs,
  type RankedView,
} from "./pool";
import type { CachedResults } from "./store";

const KEPT = RESULTS_KEPT;
/** Ranking real pools is CPU work that the full suite runs beside other files. */
const SNAPSHOT_TEST_TIMEOUT_MS = 30_000;
const noBlockers = () => [];
const present = existsSync(SNAPSHOT_DIR);
// One per distinct query: copies of another snapshot's calls add nothing.
const snapshots = present ? loadSnapshots().filter((s) => !s.sameQueryAs) : [];

/** The filters a request builds (lib/search/pipeline.ts): chips removed, then the sort. */
const requestFilters = (
  parsed: ParsedQuery,
  without: string[],
  sort: ParsedQuery["sort_preference"],
) => ({
  ...applyOverrides(parsed, without),
  sort_preference: sort,
});

const passesAnyTier = (p: AliProduct, f: ParsedQuery) =>
  passesFilters(p, f, FILTERS) || passesFilters(p, f, FILL_TIER);

describe("viewKeyOf and the chips a request removes", () => {
  const parsed: ParsedQuery = {
    product_he: "מטען",
    product_terms: ["charger"],
    keywords_en: "65w usb c charger",
    requirements: [
      { en: "65w", alt: [], he: "65W" },
      { en: "usb c", alt: ["type c"], he: "USB-C" },
    ],
    max_price_ils: 100,
    sort_preference: "best_value",
  };

  it("names a view by its sort and requirement chips, in any order and repeated", () => {
    expect(viewKeyOf("cheapest", ["req:usb c", "req:65w"])).toBe(
      viewKeyOf("cheapest", ["req:65w", "req:usb c", "req:65w"]),
    );
    expect(viewKeyOf("cheapest", [])).not.toBe(viewKeyOf("best_value", []));
  });

  it("keeps only the chips that change the filters", () => {
    const without = ["req:65w", "req:nothing", MIN_CHIP, MAX_CHIP, "req:65w"];
    expect(removedRequirements(parsed, without)).toEqual(["req:65w"]);
    // No minimum price was parsed: "min" removes nothing.
    expect(removedPrices(parsed, without)).toEqual([MAX_CHIP]);
  });

  it("builds every view the way a request builds its filters, so their keys agree", () => {
    const specs = viewSpecs(parsed, [MAX_CHIP]);
    // 3 sorts for each of the 4 sets of the 2 requirements removed.
    expect(specs).toHaveLength(12);
    for (const spec of specs) {
      const [sort, removed] = JSON.parse(spec.key) as [ParsedQuery["sort_preference"], string[]];
      // Chips as a visitor removes them: price first, one at a time, in any order.
      const asked = requestFilters(parsed, [...removed].reverse().concat(MAX_CHIP, "junk"), sort);
      expect(filtersKey(spec.filters, "none")).toBe(filtersKey(asked, "none"));
      expect(spec.filters.max_price_ils).toBeUndefined();
      expect(spec.removesMore).toBe(removed.length > 0);
    }
  });

  it("starts from the chips the fetch removed: only more requirements can go", () => {
    const specs = viewSpecs(parsed, [requirementChipId("65w")]);
    expect(specs).toHaveLength(6);
    for (const spec of specs) {
      expect(spec.filters.requirements.map((r) => r.en)).not.toContain("65w");
      expect(spec.filters.max_price_ils).toBe(100);
    }
  });
});

describe.skipIf(!present)("views of the real snapshot pools", () => {
  it("has snapshots with requirements to remove", () => {
    expect(snapshots.some((s) => s.parse.parsed.requirements.length > 0)).toBe(true);
  });

  it.each(snapshots.flatMap((s) => SHOP_CAP_MODES.map((mode) => [s.id, mode, s] as const)))(
    "%s (shop cap %s): every view is the ranking of the whole pool, and shows only products that pass",
    (_id, mode, snap) => {
      const parsed = snap.parse.parsed;
      const pool = distinctProducts(snap.calls);
      const views: [string, RankedView][] = [];
      for (const spec of viewSpecs(parsed, [])) {
        const ranked = rankView(pool, spec, KEPT, noBlockers, mode);
        if (!ranked) {
          // Only a view that removes a requirement and leaves fewer than a page is not kept: that
          // request fetches again.
          expect(spec.removesMore).toBe(true);
          const passed = rankForSearch(pool, spec.filters, mode).ranked.length;
          expect(passed).toBeLessThan(RESULTS_PER_PAGE);
          continue;
        }
        views.push([spec.key, ranked]);
        for (const p of ranked.products) {
          // Honesty: every product a view shows passes every filter the view still has.
          expect(passesAnyTier(p, spec.filters)).toBe(true);
          // A product the parse's own filters kept out came back only for a removed requirement:
          // under the trust tier it passes now, the requirement was all that kept it out.
          if (!passesAnyTier(p, parsed)) {
            const tier = passesFilters(p, spec.filters, FILTERS) ? FILTERS : FILL_TIER;
            expect(rejectReason(p, parsed, tier)).toBe("requirement");
          }
        }
      }

      // The pool keeps each product of the views once, and none the result set holds itself.
      const own = views.find(([key]) => key === viewKeyOf(parsed.sort_preference, []))!;
      expect(own[1].view.ids).toEqual(
        rankForSearch(pool, parsed, mode)
          .ranked.slice(0, KEPT)
          .map((p) => p.productId),
      );
      const cached = poolFrom(views, own[1].products, [], {});
      const ids = cached.products.map((p) => p.productId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.some((id) => own[1].view.ids.includes(id))).toBe(false);
      // Bounded: at most the kept products of every view (3 sorts, at most 8 sets of chips).
      expect(ids.length).toBeLessThanOrEqual(views.length * KEPT);
      const entry: CachedResults = {
        filters: parsed,
        checked: pool.length,
        passed: own[1].view.passed,
        products: own[1].products,
        explanations: {},
        createdAt: "2026-09-28T10:00:00.000Z",
        pool: cached,
      };
      for (const [key, ranked] of views) {
        expect(poolView(entry, key)?.products.map((p) => p.productId)).toEqual(ranked.view.ids);
      }
    },
    // Up to 24 rankings of a whole pool: well under a second alone, slower beside the full suite.
    SNAPSHOT_TEST_TIMEOUT_MS,
  );
});

describe("poolFrom, poolOf and poolView", () => {
  const product = (id: string): AliProduct =>
    ({ productId: id, title: `Cable ${id}`, promotionLink: null }) as unknown as AliProduct;
  const view = (ids: string[]): RankedView => ({
    view: { ids, passed: ids.length },
    products: ids.map(product),
  });

  it("keeps the linked version of a product the search linked", () => {
    const linked = { ...product("2"), promotionLink: "https://s.click.aliexpress.com/e/_x" };
    const pool = poolFrom([["a", view(["1", "2"])]], [product("1")], [linked], {});
    expect(pool.products).toEqual([linked]);
  });

  it("ignores a damaged pool and a view that names a product it does not hold", () => {
    const entry = {
      filters: {},
      checked: 2,
      passed: 1,
      products: [product("1")],
      explanations: {},
      createdAt: "2026-09-28T10:00:00.000Z",
    } as unknown as CachedResults;
    expect(poolOf(entry)).toBeNull();
    expect(poolOf({ ...entry, pool: { views: [], products: [], lines: {} } } as never)).toBeNull();
    const pool = { views: { a: { ids: ["1", "9"], passed: 2 } }, products: [], lines: {} };
    expect(poolView({ ...entry, pool }, "a")).toBeNull();
    expect(poolView({ ...entry, pool }, "b")).toBeNull();
  });

  it("lists the sorts the results page offers", () => {
    expect(SORTS).toEqual(["best_value", "cheapest", "most_popular"]);
  });
});
