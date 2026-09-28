import { describe, expect, it } from "vitest";
import { formatComparison, formatDetail, formatRun, shortStep } from "./format";
import { buildLabelBook } from "./labels";
import { R5_POLICY, untilPassing } from "./policies";
import type { ProductLine, QueryResult } from "./replay";
import { compareRuns, relabelRun, runVariant, shopShares, summarize } from "./report";
import { BOTTLE, call, good, offType, snapshot, times } from "./testing";

// Two queries: "few" has 2 passers on page 1 (49 items) and 4 more on page 2; "many" has 7.
const few = snapshot(
  [
    call("primary-p1", BOTTLE.keywords_en, 1, [
      ...times(2, () => good()),
      ...times(47, () => offType()),
    ]),
    call(
      "primary-p2",
      BOTTLE.keywords_en,
      2,
      times(4, () => good()),
    ),
  ],
  { id: "few" },
);
const many = snapshot(
  [
    call(
      "primary-p1",
      BOTTLE.keywords_en,
      1,
      times(7, () => good()),
    ),
  ],
  {
    id: "many",
    group: "example",
  },
);
const book = buildLabelBook([
  {
    fileId: "few",
    json: few.calls[0].products.slice(0, 2).map((p, i) => ({
      productId: p.productId,
      label: i === 0 ? "exact" : "wrong",
    })),
  },
]);
const baseline = runVariant([few, many], book, { name: "current", policy: R5_POLICY });
const candidate = runVariant([few, many], book, {
  name: "until-6-3",
  policy: untilPassing({ target: 6, maxCalls: 3 }),
});

describe("summarize", () => {
  it("counts results, calls and label metrics over the queries", () => {
    const s = baseline.summary;
    expect(s).toMatchObject({
      queries: 2,
      copies: 0,
      incomplete: ["few"], // current wants the ladder after p1, which "few" lacks
      aliCalls: 2,
      noResults: [],
      underOnePage: ["few"],
      exactlyOnePage: [],
      twoPagesOrMore: 1,
      moreAvailable: 1,
      sameShopTop3: [],
    });
    expect(s.labels).toMatchObject({ queries: 1, cardsLabelled: 2, cardsShown: 2, wrongTop3: 1 });
    expect(summarize([])).toMatchObject({ queries: 0, meanBudgetShare: null });
  });
});

describe("shopShares", () => {
  const line = (id: string, shop: string | null, shared = false): ProductLine => ({
    id,
    label: null,
    tier: "standard",
    shop,
    price: 10,
    feedbackPct: 98,
    unitsSold: 500,
    ...(shared ? { shared: true as const } : {}),
    title: `Product ${id}`,
  });
  const query = (
    id: string,
    top3: ProductLine[],
    sameQueryAs: string | null = null,
  ): QueryResult => ({
    ...baseline.queries[1],
    id,
    sameQueryAs,
    top3,
  });

  it("counts the leading shop and the shared-number cards over the distinct queries", () => {
    const shares = shopShares([
      query("a", [line("1", "s", true), line("2", "o"), line("3", null)]),
      query("b", [line("4", "o"), line("5", "s", true)]),
      query("c", [line("6", "s", true)]),
      query("a-copy", [line("1", "s", true)], "a"), // the same query again: left out
      query("none", []),
    ]);
    expect(shares).toEqual({
      queries: 3,
      cards: 6,
      topShop: { id: "s", leads: 2, cards: 3 },
      shared: { leads: 2, cards: 3 },
    });
    expect(shopShares([])).toEqual({
      queries: 0,
      cards: 0,
      topShop: null,
      shared: { leads: 0, cards: 0 },
    });
  });
});

describe("compareRuns", () => {
  it("lists what changed per query and in total, and counts the unchanged", () => {
    const c = compareRuns(baseline, candidate);
    expect(c).toMatchObject({ baseline: "current", candidate: "until-6-3", unchanged: 1 });
    expect(c.queries).toHaveLength(1);
    expect(c.queries[0].id).toBe("few");
    expect(c.queries[0].changes).toEqual(
      expect.arrayContaining(["calls 1→2", "checked 49→53", "passed 2→6", "more false→true"]),
    );
    const calls = c.totals.find((t) => t.metric === "AliExpress calls");
    expect(calls).toEqual({ metric: "AliExpress calls", baseline: 2, candidate: 3 });
  });

  it("reports queries that only one run has", () => {
    const partial = runVariant([many], book, { name: "one", policy: R5_POLICY });
    const c = compareRuns(baseline, partial);
    expect(c.queries.find((q) => q.id === "few")?.changes).toEqual(["only in the baseline"]);
  });
});

describe("relabelRun", () => {
  it("judges a saved run by today's labels, keeping its whole-pool metrics", () => {
    const same = relabelRun(baseline, book);
    expect(same.summary).toEqual(baseline.summary);
    const top = baseline.queries.find((q) => q.id === "many")!.top3[0].id;
    const today = buildLabelBook([
      { fileId: "few", json: [] },
      { fileId: "many", json: [{ productId: top, label: "exact" }] },
    ]);
    const relabelled = relabelRun(baseline, today);
    const many = relabelled.queries.find((q) => q.id === "many")!;
    expect(many.labels).toMatchObject({ count: 1, leadCorrect: true, cardsLabelled: 1 });
    expect(many.labels!.typeFalseNegatives).toEqual([]);
    expect(relabelled.queries.find((q) => q.id === "few")!.labels).toMatchObject({
      count: 0,
      cardsLabelled: 0,
      wrongTop3: 0,
    });
    expect(relabelled.summary.labels.leadCorrect).toBe(1);
  });
});

describe("format", () => {
  it("prints a row per query, the totals and the comparison", () => {
    const text = formatRun(baseline);
    expect(text).toContain("few");
    expect(text).toContain("p1 +missing");
    expect(text).toContain("AliExpress calls");
    expect(formatDetail(baseline)).toContain(few.calls[0].products[0].productId);
    expect(formatComparison(compareRuns(baseline, candidate))).toContain("calls 1→2");
    expect(["primary-p1", "primary-p2", "ladder-2"].map(shortStep)).toEqual(["p1", "p2", "L2"]);
  });
});
