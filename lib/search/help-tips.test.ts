// The tips /search shows when a search finds little (owner request 2026-10-03), chosen by code from
// the search's own chips and blockers.
import { describe, expect, it } from "vitest";
import type { FilterChip } from "@/lib/types";
import { GENERAL_TIPS, MAX_REMOVAL_TIPS, needsHelp, searchHelp } from "./help-tips";

const product: FilterChip = {
  id: "product",
  kind: "keywords",
  label_he: "בלונים ליום הולדת",
  removable: false,
};
const sonic: FilterChip = {
  id: "req:sonic",
  kind: "must_have",
  label_he: "סוניק",
  removable: true,
};
const gold: FilterChip = { id: "req:gold", kind: "must_have", label_he: "זהב", removable: true };
const max: FilterChip = { id: "max", kind: "max_price", label_he: "עד ₪50", removable: true };
const min: FilterChip = { id: "min", kind: "min_price", label_he: "מ־₪20", removable: true };

describe("searchHelp", () => {
  it("few results with blockers: the one that lets the most through first, with its count", () => {
    const help = searchHelp(
      [product, sonic, gold],
      [
        { chip_id: "req:gold", would_pass: 4, title_matches: 2 },
        { chip_id: "req:sonic", would_pass: 9, title_matches: 3 },
      ],
    );
    expect(help.removals).toEqual([
      { kind: "blocker", chip: sonic, wouldPass: 9 },
      { kind: "blocker", chip: gold, wouldPass: 4 },
    ]);
    expect(help.general).toEqual([...GENERAL_TIPS]);
  });

  it("puts a requirement before a price on a tie, and never repeats a blocker", () => {
    const help = searchHelp(
      [product, gold, max],
      [
        { chip_id: "max", would_pass: 6, title_matches: null },
        { chip_id: "req:gold", would_pass: 6, title_matches: 0 },
      ],
    );
    expect(help.removals).toEqual([
      { kind: "blocker", chip: gold, wouldPass: 6 },
      { kind: "blocker", chip: max, wouldPass: 6 },
    ]);
  });

  it("with a price chip: suggests a wider budget (both bounds together), no count", () => {
    const help = searchHelp([product, min, max], []);
    expect(help.removals).toEqual([{ kind: "price", chips: [min, max] }]);
  });

  it("with a character requirement and no blockers (5 to 9 results): searching without it", () => {
    // Blockers come only under a page of results; above that the response has none.
    const help = searchHelp([product, sonic], undefined);
    expect(help.removals).toEqual([{ kind: "requirement", chip: sonic }]);
  });

  it("orders blockers, then the price, then the other requirements, capped", () => {
    const help = searchHelp(
      [product, sonic, gold, max],
      [{ chip_id: "req:gold", would_pass: 3, title_matches: 0 }],
    );
    expect(help.removals.map((t) => t.kind)).toEqual(["blocker", "price", "requirement"]);
    expect(help.removals).toHaveLength(MAX_REMOVAL_TIPS);
    expect(help.removals[2]).toEqual({ kind: "requirement", chip: sonic });
  });

  it("with nothing removable: only the general tips", () => {
    const help = searchHelp([product], undefined);
    expect(help.removals).toEqual([]);
    expect(help.general).toEqual(["simpler_words", "synonym", "spelling"]);
  });

  it("ignores blockers of chips that are gone or not removable, and ones that add nothing", () => {
    const help = searchHelp(
      [product, gold],
      [
        { chip_id: "product", would_pass: 40, title_matches: null },
        { chip_id: "req:gone", would_pass: 5, title_matches: 0 },
        { chip_id: "req:gold", would_pass: 0, title_matches: 0 },
      ],
    );
    expect(help.removals).toEqual([{ kind: "requirement", chip: gold }]);
  });

  it("leaves out what the no-results card already offers before the cap", () => {
    const blockers = [{ chip_id: "req:gold", would_pass: 3, title_matches: 0 }];
    expect(searchHelp([product, sonic, gold, max], blockers, ["blocker"]).removals).toEqual([
      { kind: "price", chips: [max] },
      { kind: "requirement", chip: sonic },
    ]);
    expect(searchHelp([product, max], [], ["price"]).removals).toEqual([]);
  });
});

describe("needsHelp", () => {
  it("only with some results, fewer passed than the first view, and nothing more to load", () => {
    expect(needsHelp(3, 3, 10, false)).toBe(true);
    expect(needsHelp(9, 9, 10, false)).toBe(true);
    expect(needsHelp(10, 10, 10, false)).toBe(false);
    expect(needsHelp(5, 5, 10, true)).toBe(false);
    expect(needsHelp(0, 0, 10, false)).toBe(false);
  });
});
