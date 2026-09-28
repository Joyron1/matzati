// "What blocked" (docs/search-quality-plan.md, item 12): for each filter the visitor can remove,
// how many of the products we checked would pass without it. Pure: computed from the checked pool
// with the ranking functions, so the numbers are exactly what "Y עברו" would count. No product that
// failed a filter is ever shown; the count only says what removing the filter would let through.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { MAX_CHIP, MIN_CHIP, requirementChipId } from "@/lib/search/chips";
import type { SearchFilters } from "@/lib/search/filters";
import { requirementMatches } from "./match";
import { capacitySpecs, rankWithFill } from "./rank";
import { asksForSmall } from "./relevance";

export interface FilterRelaxation {
  /** The chip that removes this filter (FilterChip.id): "req:<en>", "min" or "max". */
  chipId: string;
  kind: "requirement" | "min_price" | "max_price";
  /** Products of the pool that pass every other filter (rankWithFill, as passed_count counts). */
  wouldPass: number;
  /** A requirement only: products of the pool whose title matches it at all; null for a price. */
  titleMatches: number | null;
  /**
   * A capacity requirement of a "small" search (fitsSmallCapacity in ./rank.ts): a title that
   * states a bigger capacity matches it and still fails, so the page must not say no title
   * mentions it.
   */
  sizeCap: boolean;
}

/**
 * "Y עברו" for a pool: standard passers, topped up from FILL_TIER to one page, as the pipeline.
 * The shop cap only reorders the list, so the count is the same under every mode ("none" here).
 */
export function passedCount(pool: readonly AliProduct[], filters: SearchFilters): number {
  return rankWithFill([...pool], filters, RESULTS_PER_PAGE, "none").ranked.length;
}

/**
 * Every removable filter of `filters` (each requirement, the minimum and the maximum price) with
 * how many of `pool` would pass without it, in the order of the filters. Only that one filter is
 * dropped: the keywords stay as they were, since this counts products already checked.
 */
export function filterRelaxations(
  pool: readonly AliProduct[],
  filters: SearchFilters,
): FilterRelaxation[] {
  const small = asksForSmall(filters);
  const out: FilterRelaxation[] = filters.requirements.map((r) => ({
    chipId: requirementChipId(r.en),
    kind: "requirement" as const,
    wouldPass: passedCount(pool, {
      ...filters,
      requirements: filters.requirements.filter((other) => other !== r),
    }),
    titleMatches: pool.filter((p) => requirementMatches(p.title, r)).length,
    sizeCap: small && capacitySpecs({ requirements: [r] }).length > 0,
  }));
  if (filters.min_price_ils !== undefined) {
    out.push({
      chipId: MIN_CHIP,
      kind: "min_price",
      wouldPass: passedCount(pool, { ...filters, min_price_ils: undefined }),
      titleMatches: null,
      sizeCap: false,
    });
  }
  if (filters.max_price_ils !== undefined) {
    out.push({
      chipId: MAX_CHIP,
      kind: "max_price",
      wouldPass: passedCount(pool, { ...filters, max_price_ils: undefined }),
      titleMatches: null,
      sizeCap: false,
    });
  }
  return out;
}

/**
 * The filters whose removal would let more of the pool through than pass now (`passed`), most
 * useful first: the most products passing without it, and a requirement before a price on a tie
 * (the price bounds were already sent to AliExpress, so the pool holds few products outside them).
 */
export function usefulRelaxations(
  pool: readonly AliProduct[],
  filters: SearchFilters,
  passed: number = passedCount(pool, filters),
): FilterRelaxation[] {
  const rank = (r: FilterRelaxation) => (r.kind === "requirement" ? 0 : 1);
  return filterRelaxations(pool, filters)
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.wouldPass > passed)
    .sort((a, b) => b.r.wouldPass - a.r.wouldPass || rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
}

/**
 * True when nothing passes and a requirement alone keeps otherwise passing products out: none of
 * the products that pass every other filter mentions it in the title. (With nothing passing, a
 * requirement that lets products through when removed was matched by none of them.)
 */
export function requirementBlocksAll(
  pool: readonly AliProduct[],
  filters: SearchFilters,
  passed: number = passedCount(pool, filters),
): boolean {
  if (passed > 0) return false;
  return filterRelaxations(pool, filters).some((r) => r.kind === "requirement" && r.wouldPass > 0);
}
