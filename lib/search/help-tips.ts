// Help when a search finds little (owner request 2026-10-03): the tips /search shows under fewer
// results than the first view (RESULTS_FIRST_VIEW) and with none, built from the search's own chips
// and blockers only. Deterministic, no LLM; a number is given only where the blockers counted it
// (products already checked that would pass without that filter), never a guess.
import type { FilterBlocker, FilterChip } from "@/lib/types";

/** One filter (or the price bounds) the visitor may remove, most useful first. */
export type RemovalTip =
  /** A filter whose removal lets `wouldPass` of the checked products through (FilterBlocker). */
  | { kind: "blocker"; chip: FilterChip; wouldPass: number }
  /** The price bounds: a wider budget, or none. How many that adds is not known. */
  | { kind: "price"; chips: FilterChip[] }
  /**
   * A requirement (a feature, or a character, team or brand the visitor named, which the parse
   * also makes a requirement, CLAUDE.md §6.3): searching without it. How many that adds is not
   * known.
   */
  | { kind: "requirement"; chip: FilterChip };

/** Ways to write the search again, shown to everyone. */
export type GeneralTip = "simpler_words" | "synonym" | "spelling";

export interface SearchHelp {
  removals: RemovalTip[];
  general: GeneralTip[];
}

/** At most this many filters to remove, so the box stays short. */
export const MAX_REMOVAL_TIPS = 3;

export const GENERAL_TIPS: readonly GeneralTip[] = ["simpler_words", "synonym", "spelling"];

const isPrice = (c: FilterChip) => c.kind === "min_price" || c.kind === "max_price";

/**
 * The tips for one view: first the blockers (the one that would let the most checked products
 * through first; a requirement before a price on a tie, as usefulRelaxations), then the price
 * bounds when no blocker already covers them, then the other removable requirements in the order
 * of the chips; at most MAX_REMOVAL_TIPS. Only chips on the page that can be removed count.
 * `skip`: kinds the page already offers elsewhere (the no-results card lists the blockers, or a
 * button that removes the price), left out before the cap.
 */
export function searchHelp(
  chips: readonly FilterChip[],
  blockers: readonly FilterBlocker[] | undefined,
  skip: readonly RemovalTip["kind"][] = [],
): SearchHelp {
  const removable = chips.filter((c) => c.removable);
  const byId = new Map(removable.map((c) => [c.id, c]));
  const fromBlockers = (blockers ?? [])
    .flatMap((b, i) => {
      const chip = byId.get(b.chip_id);
      return chip && b.would_pass > 0 ? [{ chip, wouldPass: b.would_pass, i }] : [];
    })
    .sort(
      (a, b) =>
        b.wouldPass - a.wouldPass || Number(isPrice(a.chip)) - Number(isPrice(b.chip)) || a.i - b.i,
    );
  const taken = new Set(fromBlockers.map((b) => b.chip.id));

  const removals: RemovalTip[] = fromBlockers.map(({ chip, wouldPass }) => ({
    kind: "blocker",
    chip,
    wouldPass,
  }));
  const prices = removable.filter((c) => isPrice(c) && !taken.has(c.id));
  if (prices.length) removals.push({ kind: "price", chips: prices });
  for (const chip of removable) {
    if (chip.kind === "must_have" && !taken.has(chip.id)) {
      removals.push({ kind: "requirement", chip });
    }
  }
  return {
    removals: removals.filter((t) => !skip.includes(t.kind)).slice(0, MAX_REMOVAL_TIPS),
    general: [...GENERAL_TIPS],
  };
}

/**
 * Whether the results page shows the help box under its results: some shown, fewer passed than a
 * full first view (`firstView`; `passed` is the page's "Y עברו", which the box repeats), and
 * nothing more to load.
 */
export function needsHelp(
  shown: number,
  passed: number,
  firstView: number,
  moreAvailable: boolean,
): boolean {
  return shown > 0 && passed < firstView && !moreAvailable;
}
