import { describe, expect, it } from "vitest";
import { budgetUse, ratio, sumDaily, usdToIls, type DailyStats } from "./report";

function day(over: Partial<DailyStats> = {}): DailyStats {
  return {
    day: "2026-09-27",
    searches: 0,
    fresh: 0,
    cached: 0,
    zeroResults: 0,
    previews: 0,
    moreLoads: 0,
    clicks: 0,
    llmCalls: 0,
    llmCostUsd: 0,
    llmUnpricedCalls: 0,
    ...over,
  };
}

describe("ratio", () => {
  it("divides, and has no value without a denominator", () => {
    expect(ratio(1, 4)).toBe(0.25);
    expect(ratio(0, 4)).toBe(0);
    expect(ratio(3, 0)).toBeNull();
  });
});

describe("sumDaily", () => {
  it("adds every counter across days", () => {
    const totals = sumDaily([
      day({ searches: 10, fresh: 4, cached: 6, zeroResults: 1, clicks: 3, llmCalls: 8 }),
      day({ day: "2026-09-26", searches: 5, fresh: 5, llmCostUsd: 0.25, llmUnpricedCalls: 1 }),
      day({ day: "2026-09-25", previews: 7, moreLoads: 2, llmCostUsd: 0.5 }),
    ]);
    expect(totals).toEqual({
      searches: 15,
      fresh: 9,
      cached: 6,
      zeroResults: 1,
      previews: 7,
      moreLoads: 2,
      clicks: 3,
      llmCalls: 8,
      llmCostUsd: 0.75,
      llmUnpricedCalls: 1,
    });
  });

  it("is all zeros for no days", () => {
    expect(Object.values(sumDaily([])).every((v) => v === 0)).toBe(true);
  });
});

describe("usdToIls", () => {
  it("converts to the agora", () => {
    expect(usdToIls(1.2345, 3.7)).toBe(4.57);
    expect(usdToIls(0, 3.7)).toBe(0);
  });
});

describe("budgetUse", () => {
  it("shows the units used out of the cap", () => {
    expect(budgetUse(500, 2000)).toEqual({ used: 500, cap: 2000, share: 0.25, refused: 0 });
  });

  it("caps the counter and reports what was refused past the cap", () => {
    expect(budgetUse(2013, 2000)).toEqual({ used: 2000, cap: 2000, share: 1, refused: 13 });
  });

  it("treats a cap of 0 (the kill switch) as fully used", () => {
    expect(budgetUse(0, 0)).toEqual({ used: 0, cap: 0, share: 1, refused: 0 });
  });
});
