import { describe, expect, it } from "vitest";
import { buildLabelBook, type LabelBook } from "./labels";
import { ALL_CAPTURED, CURRENT_POLICY } from "./policies";
import {
  evaluateQuery,
  filtersFor,
  maxSameShop,
  rankLikePipeline,
  renormalizeParse,
  type Variant,
} from "./replay";
import { BOTTLE, call, good, lowFeedback, offType, product, snapshot, times } from "./testing";

const current: Variant = { name: "current", policy: CURRENT_POLICY };
const noLabels: LabelBook = new Map();

/** Trust falls with the index, so the ranking order is the array order. */
const ranked = (n: number) =>
  times(n, () => null).map((_, i) =>
    good({ positiveFeedbackPct: 99 - i * 0.5, unitsSold: 50_000 - i * 3_000 }),
  );

describe("evaluateQuery", () => {
  it("reports the calls, the pool, what passed and the first two pages", () => {
    const top = ranked(7);
    const snap = snapshot([call("primary-p1", BOTTLE.keywords_en, 1, [...top, offType()])]);
    const r = evaluateQuery(snap, noLabels, current);
    expect(r.fetch).toEqual({ steps: ["primary-p1"], calls: 1, missing: null });
    expect(r).toMatchObject({ checked: 8, passed: 7, fill: 0, shown: 3, moreAvailable: true });
    expect(r.top3.map((l) => l.id)).toEqual(top.slice(0, 3).map((p) => p.productId));
    expect(r.next3.map((l) => l.id)).toEqual(top.slice(3, 6).map((p) => p.productId));
    expect(r.rejected.type).toBe(1);
    expect(r.labels).toBeNull();
    expect(r.budgetShare).toBeNull();
  });

  it("says there is no more when exactly one page passed", () => {
    const snap = snapshot([call("primary-p1", BOTTLE.keywords_en, 1, ranked(3))]);
    expect(evaluateQuery(snap, noLabels, current)).toMatchObject({
      passed: 3,
      moreAvailable: false,
    });
  });

  it("measures labels: lead, cards, wrong, unlabelled, type-gate misses and false positives", () => {
    const [a, b, c, d] = ranked(4);
    const sponge = offType({ title: "Leakproof Kitchen Sponge Set" }); // only the type gate fails
    const weakSponge = offType({ positiveFeedbackPct: 80 }); // trust fails too
    const snap = snapshot([
      call("primary-p1", BOTTLE.keywords_en, 1, [a, b, c, d, sponge, weakSponge]),
    ]);
    const book = buildLabelBook([
      {
        fileId: "bottle",
        json: [
          { productId: a.productId, label: "exact" },
          { productId: b.productId, label: "wrong" },
          { productId: c.productId, label: "reasonable" },
          { productId: sponge.productId, label: "exact" },
          { productId: weakSponge.productId, label: "reasonable" },
          { productId: "999", label: "weak" },
        ],
      },
    ]);
    const r = evaluateQuery(snap, book, current);
    expect(r.top3.map((l) => l.label)).toEqual(["exact", "wrong", "reasonable"]);
    expect(r.labels).toEqual({
      count: 6,
      leadCorrect: true,
      cardsGood: 2,
      cardsLabelled: 3,
      wrongTop3: 1,
      unlabelledTop6: [d.productId],
      typeFalseNegatives: [sponge.productId, weakSponge.productId],
      typeFalseNegativesBlocking: [sponge.productId],
      falsePositives: [b.productId],
      unknownIds: ["999"],
    });
  });

  it("uses the labels of the snapshot a copy repeats", () => {
    const [a] = ranked(1);
    const snap = snapshot([call("primary-p1", BOTTLE.keywords_en, 1, [a])], {
      id: "ex-1",
      sameQueryAs: "bottle",
    });
    const book = buildLabelBook([
      { fileId: "bottle", json: [{ productId: a.productId, label: "weak" }] },
    ]);
    expect(evaluateQuery(snap, book, current).labels?.leadCorrect).toBe(false);
  });

  it("marks top-up products from FILL_TIER", () => {
    const fillOnly = good({ positiveFeedbackPct: 96, unitsSold: 50 });
    const snap = snapshot([call("primary-p1", BOTTLE.keywords_en, 1, [...ranked(2), fillOnly])]);
    const r = evaluateQuery(snap, noLabels, current);
    expect(r.fill).toBe(1);
    expect(r.top3.map((l) => l.tier)).toEqual(["standard", "standard", "fill"]);
  });

  it("gives the mean top-3 price as a share of the stated maximum", () => {
    const within = [good({ price: 20 }), good({ price: 40 })];
    const snap = snapshot(
      [call("primary-p1", BOTTLE.keywords_en, 1, within, { maxPriceIls: 100 })],
      {
        parsed: { ...BOTTLE, max_price_ils: 100 },
      },
    );
    expect(evaluateQuery(snap, noLabels, current).budgetShare).toBe(0.3);
  });

  it("reports an unusable adjusted parse as an error, with no results", () => {
    const snap = snapshot([call("primary-p1", BOTTLE.keywords_en, 1, ranked(3))]);
    const r = evaluateQuery(snap, noLabels, { ...current, adjustParse: () => null });
    expect(r).toMatchObject({ error: expect.any(String), passed: 0, shown: 0 });
  });

  it("the whole-pool policy checks every captured product", () => {
    const snap = snapshot([
      call("primary-p1", BOTTLE.keywords_en, 1, ranked(7)),
      call(
        "primary-p2",
        BOTTLE.keywords_en,
        2,
        times(5, () => lowFeedback()),
      ),
    ]);
    const r = evaluateQuery(snap, noLabels, { name: "all", policy: ALL_CAPTURED });
    expect(r).toMatchObject({ checked: 12, snapshotPool: 12 });
    expect(evaluateQuery(snap, noLabels, current).checked).toBe(7);
  });
});

describe("filtersFor", () => {
  const snap = snapshot([]);

  it("applies the sort override and removed chips as the pipeline does", () => {
    const f = filtersFor(snap, { ...current, sort: "cheapest", without: ["req:leakproof"] })!;
    expect(f.sort_preference).toBe("cheapest");
    expect(f.requirements).toEqual([]);
  });

  it('"req:*" removes every requirement', () => {
    expect(filtersFor(snap, { ...current, without: ["req:*"] })!.requirements).toEqual([]);
  });

  it("renormalizeParse keeps a clean parse as it is", () => {
    expect(renormalizeParse(BOTTLE, "בקבוק מים שלא נוזל")).toEqual(BOTTLE);
  });
});

describe("rankLikePipeline", () => {
  it("keeps at most 12 products and counts every passer", () => {
    const r = rankLikePipeline(ranked(14), BOTTLE);
    expect(r.kept).toHaveLength(12);
    expect(r.passed).toBe(14);
  });
});

describe("maxSameShop", () => {
  const at = (id: string | null) => product({ shop: { id, name: null, url: null } });

  it("counts the most products of one shop; products without a shop count on their own", () => {
    expect(maxSameShop([])).toBe(0);
    expect(maxSameShop([at("a"), at("b"), at("c")])).toBe(1);
    expect(maxSameShop([at("a"), at("b"), at("a")])).toBe(2);
    expect(maxSameShop([at(null), at(null), at("a")])).toBe(1);
  });
});
