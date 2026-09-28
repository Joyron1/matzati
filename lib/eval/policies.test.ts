import { describe, expect, it } from "vitest";
import {
  ALL_CAPTURED,
  CURRENT_POLICY,
  policyByName,
  R5_POLICY,
  untilPassing,
  type FetchPolicy,
} from "./policies";
import { replayFetch } from "./replay";
import { BOTTLE, call, good, lowFeedback, offType, snapshot, times } from "./testing";
import type { SnapshotCall } from "./snapshot";

const PRIMARY = "leakproof water bottle";
const L1 = "water bottle";
const L2 = "drink bottles";

const p1 = (products: ReturnType<typeof good>[], o: Partial<SnapshotCall> = {}) =>
  call("primary-p1", PRIMARY, 1, products, o);
const p2 = (products = times(50, () => offType())) => call("primary-p2", PRIMARY, 2, products);
const l1 = (products = times(50, () => offType())) => call("ladder-1", L1, 1, products);
const l2 = (products = times(50, () => offType())) => call("ladder-2", L2, 1, products);

const steps = (policy: FetchPolicy, calls: SnapshotCall[]) => {
  const r = replayFetch(snapshot(calls), BOTTLE, policy);
  return {
    steps: r.calls.map((c) => c.step),
    missing: r.missing,
    checked: r.pool.length,
  };
};

describe("R5_POLICY (fetchAndRank before item 5)", () => {
  it("takes page 2 after a full page 1 limited by relevance, then the ladder while under 3 pass", () => {
    const page1 = [...times(2, () => good()), ...times(48, () => offType())];
    expect(steps(R5_POLICY, [p1(page1), p2(), l1(), l2()])).toMatchObject({
      steps: ["primary-p1", "primary-p2", "ladder-1"],
      missing: null,
    });
  });

  it("skips page 2 when page 1 held 49 items, however many records exist", () => {
    const page1 = [...times(2, () => good()), ...times(47, () => offType())];
    expect(steps(R5_POLICY, [p1(page1), p2(), l1(), l2()]).steps).toEqual([
      "primary-p1",
      "ladder-1",
      "ladder-2",
    ]);
  });

  it("skips page 2 when trust, not relevance, rejected most", () => {
    const page1 = [good(), ...times(49, () => lowFeedback())];
    expect(steps(R5_POLICY, [p1(page1), p2(), l1(), l2()]).steps).toEqual([
      "primary-p1",
      "ladder-1",
      "ladder-2",
    ]);
  });

  it("skips page 2 when AliExpress has no more records", () => {
    const page1 = [...times(2, () => good()), ...times(48, () => offType())];
    expect(steps(R5_POLICY, [p1(page1, { totalRecords: 50 }), p2(), l1(), l2()]).steps).toEqual([
      "primary-p1",
      "ladder-1",
      "ladder-2",
    ]);
  });

  it("stops after page 2 once 3 pass, and after page 1 once 6 pass", () => {
    const four = [...times(4, () => good()), ...times(46, () => offType())];
    expect(steps(R5_POLICY, [p1(four), p2(), l1()]).steps).toEqual(["primary-p1", "primary-p2"]);
    const seven = [...times(7, () => good()), ...times(43, () => offType())];
    expect(steps(R5_POLICY, [p1(seven), p2(), l1()]).steps).toEqual(["primary-p1"]);
  });

  it("reports the call it wanted when the snapshot lacks it, and stops there", () => {
    const page1 = [good(), ...times(48, () => offType())];
    const r = steps(R5_POLICY, [p1(page1), p2()]);
    expect(r.steps).toEqual(["primary-p1"]);
    expect(r.missing).toEqual({ keywords: L1, pageNo: 1 });
    expect(r.checked).toBe(49);
  });

  it("matches calls on the price bounds too", () => {
    const capped = [p1([good()], { maxPriceIls: 100 })];
    const r = replayFetch(snapshot(capped), BOTTLE, R5_POLICY);
    expect(r.missing).toEqual({ keywords: PRIMARY, pageNo: 1 });
    const matched = replayFetch(snapshot(capped), { ...BOTTLE, max_price_ils: 100 }, R5_POLICY);
    expect(matched.calls.map((c) => c.step)).toEqual(["primary-p1"]);
  });
});

// The rules themselves are tested on nextFetch (lib/search/fetch-policy.test.ts); these check that
// the replay feeds it what the pipeline does.
describe("CURRENT_POLICY (nextFetch in lib/search/fetch-policy.ts)", () => {
  it("takes page 2 after a page 1 of 49 limited by relevance, then broader keywords", () => {
    const page1 = [...times(2, () => good()), ...times(47, () => offType())];
    expect(steps(CURRENT_POLICY, [p1(page1), p2(), l1(), l2()]).steps).toEqual([
      "primary-p1",
      "primary-p2",
      "ladder-1",
    ]);
  });

  it("skips page 2 when page 1's fewest sales are under the trust bar", () => {
    // A page (5) passes, so the bar is FILTERS' 100 sales; page 1 ends at 50, so page 2 cannot pass.
    const page1 = [
      ...times(5, () => good()),
      ...times(43, () => offType()),
      good({ unitsSold: 50 }),
    ];
    expect(steps(CURRENT_POLICY, [p1(page1), p2(), l1(), l2()]).steps).toEqual([
      "primary-p1",
      "ladder-1",
      "ladder-2",
    ]);
  });

  it("goes to broader keywords first when trust rejected most", () => {
    const page1 = [good(), ...times(49, () => lowFeedback())];
    expect(steps(CURRENT_POLICY, [p1(page1), p2(), l1(), l2()]).steps[1]).toBe("ladder-1");
  });

  it("stops after 100 checked when a requirement blocks every otherwise passing product", () => {
    let n = 0;
    const plain = () => good({ title: `Water Bottle Plain ${++n}` });
    const r = steps(CURRENT_POLICY, [
      p1(times(50, plain)),
      call("primary-p2", PRIMARY, 2, times(50, plain)),
      l1(),
    ]);
    expect(r).toMatchObject({ steps: ["primary-p1", "primary-p2"], missing: null, checked: 100 });
  });

  it("asks for another product phrase with the requirement, which a snapshot may lack", () => {
    const parsed = { ...BOTTLE, product_terms: ["water bottle", "sports bottle"] };
    const page1 = [good(), ...times(20, () => offType())];
    const r = replayFetch(
      snapshot([p1(page1, { totalRecords: 21 })], { parsed }),
      parsed,
      CURRENT_POLICY,
    );
    expect(r.missing).toEqual({ keywords: "leakproof sports bottle", pageNo: 1 });
  });
});

describe("untilPassing", () => {
  const policy = untilPassing({ target: 6, maxCalls: 3 });

  it("fetches page 2 after a page 1 of 49 while fewer than the target pass, then the ladder", () => {
    const page1 = [...times(2, () => good()), ...times(47, () => offType())];
    expect(steps(policy, [p1(page1), p2(), l1(), l2()]).steps).toEqual([
      "primary-p1",
      "primary-p2",
      "ladder-1",
    ]);
  });

  it("stops at the target", () => {
    const page1 = [...times(6, () => good()), ...times(43, () => offType())];
    expect(steps(policy, [p1(page1), p2(), l1()]).steps).toEqual(["primary-p1"]);
  });

  it("goes to the ladder when page 1 was the last page", () => {
    const page1 = [good(), ...times(10, () => offType())];
    expect(steps(policy, [p1(page1, { totalRecords: 11 }), l1(), l2()]).steps).toEqual([
      "primary-p1",
      "ladder-1",
      "ladder-2",
    ]);
  });

  it("respects maxCalls", () => {
    const one = untilPassing({ target: 6, maxCalls: 1 });
    expect(steps(one, [p1([good()]), p2(), l1()]).steps).toEqual(["primary-p1"]);
  });
});

describe("ALL_CAPTURED", () => {
  it("takes every captured call in capture order", () => {
    const seven = times(7, () => good());
    expect(steps(ALL_CAPTURED, [p1(seven), p2(), l1()]).steps).toEqual([
      "primary-p1",
      "primary-p2",
      "ladder-1",
    ]);
  });
});

describe("replayFetch guards", () => {
  it("throws when a policy asks for the same call twice", () => {
    const loop: FetchPolicy = {
      name: "loop",
      description: "",
      next: () => ({ keywords: PRIMARY, pageNo: 1 }),
    };
    expect(() => replayFetch(snapshot([p1([good()])]), BOTTLE, loop)).toThrow(/twice/);
  });

  it("gives the policy the ranked and passed counts of the pool so far", () => {
    const seen: { ranked: number; passed: number; pool: number }[] = [];
    const spy: FetchPolicy = {
      name: "spy",
      description: "",
      next: (s) => {
        seen.push({ ranked: s.ranked, passed: s.passed, pool: s.pool.length });
        return s.calls.length ? null : { keywords: PRIMARY, pageNo: 1 };
      },
    };
    replayFetch(snapshot([p1([good(), good(), offType()])]), BOTTLE, spy);
    expect(seen).toEqual([
      { ranked: 0, passed: 0, pool: 0 },
      { ranked: 2, passed: 2, pool: 3 },
    ]);
  });
});

describe("policyByName", () => {
  it("knows the named policies and any until-<target>-<calls>", () => {
    expect(policyByName("current")).toBe(CURRENT_POLICY);
    expect(policyByName("r5")).toBe(R5_POLICY);
    expect(policyByName("all")).toBe(ALL_CAPTURED);
    expect(policyByName("until-6-3").name).toBe("until-6-3");
    expect(policyByName("until-9-2").name).toBe("until-9-2");
    expect(policyByName("until-6").name).toBe("until-6-3");
    expect(() => policyByName("nope")).toThrow(/unknown fetch policy/);
  });
});
