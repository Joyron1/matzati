// The offline evaluation over the real snapshots (fixtures/snapshots): it must be deterministic,
// make no network call, and never show a product that did not pass the filters (CLAUDE.md §1).
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import { passesFilters } from "@/lib/ranking/rank";
import { loadLabels, loadSnapshots, SNAPSHOT_DIR } from "./files";
import { ALL_CAPTURED, CURRENT_POLICY, untilPassing, type FetchPolicy } from "./policies";
import { filtersFor } from "./replay";
import { compareRuns, runVariant, type EvalRun } from "./report";
import { distinctProducts } from "./snapshot";

const present = existsSync(SNAPSHOT_DIR);

describe.skipIf(!present)("offline evaluation of the real snapshots", () => {
  const fetchSpy = vi.fn(() => {
    throw new Error("network access in the offline evaluation");
  });
  beforeAll(() => vi.stubGlobal("fetch", fetchSpy));
  afterAll(() => vi.unstubAllGlobals());

  const snapshots = present ? loadSnapshots() : [];
  const { book } = present ? loadLabels() : { book: new Map() };
  const policies: FetchPolicy[] = [
    CURRENT_POLICY,
    untilPassing({ target: 6, maxCalls: 3 }),
    ALL_CAPTURED,
  ];
  const run = (policy: FetchPolicy) => runVariant(snapshots, book, { name: policy.name, policy });
  const firstRuns = new Map<string, EvalRun>();

  it("covers every snapshot file", () => {
    expect(snapshots.length).toBeGreaterThan(0);
    expect(new Set(snapshots.map((s) => s.id)).size).toBe(snapshots.length);
  });

  it.each(policies.map((p) => [p.name, p] as const))(
    "%s: deterministic, offline, and shows only products that passed",
    (_name, policy) => {
      const first = run(policy);
      firstRuns.set(policy.name, first);
      expect(JSON.stringify(run(policy))).toBe(JSON.stringify(first));
      expect(fetchSpy).not.toHaveBeenCalled();
      const byId = new Map(snapshots.map((s) => [s.id, s]));
      for (const q of first.queries) {
        const snap = byId.get(q.id)!;
        const filters = filtersFor(snap, { name: policy.name, policy })!;
        const products = new Map(distinctProducts(snap.calls).map((p) => [p.productId, p]));
        expect(q.shown).toBeLessThanOrEqual(RESULTS_PER_PAGE);
        expect(q.passed).toBeGreaterThanOrEqual(q.shown);
        expect(q.checked).toBeLessThanOrEqual(q.snapshotPool);
        expect(q.fetch.calls).toBeLessThanOrEqual(policy === ALL_CAPTURED ? 10 : 3);
        for (const line of [...q.top3, ...q.next3]) {
          const tier = line.tier === "fill" ? FILL_TIER : FILTERS;
          expect(passesFilters(products.get(line.id)!, filters, tier)).toBe(true);
        }
      }
    },
    // Two runs over every snapshot: about 2 s alone, over 5 s beside the full suite's CPU work.
    60_000,
  );

  it("the whole-pool policy checks every captured product", () => {
    const all = firstRuns.get(ALL_CAPTURED.name) ?? run(ALL_CAPTURED);
    for (const q of all.queries) expect(q.checked).toBe(q.snapshotPool);
  }, 60_000);

  it("a policy compared with itself changes nothing", () => {
    const a = firstRuns.get(CURRENT_POLICY.name) ?? run(CURRENT_POLICY);
    const c = compareRuns(a, run(CURRENT_POLICY));
    expect(c.queries).toEqual([]);
    expect(c.unchanged).toBe(snapshots.length);
  }, 60_000);
});
