// The replay's CURRENT_POLICY and rankLikePipeline must do what lib/search/pipeline.ts does. This
// runs the real runSearch over every snapshot, with product.query answered from the captured calls
// (no network, no LLM: the parse comes from the store, explain gets no data and falls back), and
// compares its calls and results with the replay. When fetchAndRank changes, update
// CURRENT_POLICY in lib/eval/policies.ts until this passes again.
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aliexpress/affiliate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aliexpress/affiliate")>();
  return { ...actual, queryProducts: vi.fn(), generateLinks: vi.fn() };
});

import { generateLinks, queryProducts } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { LlmProvider } from "@/lib/llm/provider";
import { normalizeQuery, queryKey } from "@/lib/search/cache-key";
import { runSearch } from "@/lib/search/pipeline";
import { MemoryStore } from "@/lib/search/store";
import { loadSnapshots, SNAPSHOT_DIR } from "./files";
import { CURRENT_POLICY } from "./policies";
import { rankLikePipeline, replayFetch } from "./replay";
import type { Snapshot } from "./snapshot";

const NOW = new Date("2026-09-28T12:00:00Z");

/** Explain gets no data, so every line falls back to the data sentence; parse is never called. */
const llm: LlmProvider = {
  name: "anthropic",
  model: "offline",
  generateStructured: async () => ({
    data: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    model: "offline",
  }),
};

const ali = new AliExpressClient(
  { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://gateway.invalid/sync" },
  {
    fetch: async () => {
      throw new Error("network access in an offline test");
    },
  },
);

const label = (keywords: string, pageNo: number) => `${keywords} (p${pageNo})`;

async function runPipeline(snap: Snapshot) {
  const made: string[] = [];
  vi.mocked(queryProducts).mockImplementation(async (_client, q) => {
    const pageNo = q.pageNo ?? 1;
    made.push(label(q.keywords, pageNo));
    const c = snap.calls.find(
      (c) =>
        !c.error &&
        c.keywords === q.keywords &&
        c.pageNo === pageNo &&
        c.sort === q.sort &&
        c.minPriceIls === (q.minPriceIls ?? null) &&
        c.maxPriceIls === (q.maxPriceIls ?? null),
    );
    if (!c) throw new Error(`not captured: ${label(q.keywords, pageNo)}`);
    return {
      products: c.products,
      skipped: c.rawCount - c.parsedCount,
      totalRecords: c.totalRecords,
    };
  });
  // The replay assumes link.generate succeeds for a product without a link.
  vi.mocked(generateLinks).mockImplementation(async (_client, urls) =>
    urls.map((u) => ({
      sourceValue: u,
      promotionLink: "https://s.click.aliexpress.com/e/_offline",
      message: null,
    })),
  );
  const store = new MemoryStore();
  await store.putParse(queryKey(snap.query), normalizeQuery(snap.query), snap.parse.parsed, NOW);
  try {
    const outcome = await runSearch(
      { q: snap.query },
      { llm, ali, store, now: () => NOW, sleep: async () => {}, aliSpacingMs: 0 },
    );
    const cached = store.results.get(outcome.response.filters_key ?? "");
    return { made, outcome, kept: cached?.products.map((p) => p.productId) ?? null };
  } catch (error) {
    return { made, error };
  }
}

const snapshots = existsSync(SNAPSHOT_DIR) ? loadSnapshots().filter((s) => !s.sameQueryAs) : [];

describe.skipIf(!snapshots.length)("replay parity with lib/search/pipeline.ts", () => {
  it.each(snapshots.map((s) => [s.id, s] as const))(
    "%s: same calls, pool and results",
    async (_id, snap) => {
      const filters = snap.parse.parsed;
      const replay = replayFetch(snap, filters, CURRENT_POLICY);
      const wanted = [
        ...replay.calls.map((c) => label(c.keywords, c.pageNo)),
        ...(replay.missing ? [label(replay.missing.keywords, replay.missing.pageNo)] : []),
      ];
      const live = await runPipeline(snap);
      if (replay.missing) {
        // The pipeline asked for the call the snapshot lacks, right where the replay stopped.
        expect(live.made.slice(0, wanted.length)).toEqual(wanted);
        return;
      }
      expect(live.error).toBeUndefined();
      expect(live.made).toEqual(wanted);
      const ranking = rankLikePipeline(replay.pool, filters);
      const response = live.outcome!.response;
      expect(response.checked_count).toBe(replay.pool.length);
      expect(response.passed_count).toBe(ranking.passed);
      expect(live.kept).toEqual(ranking.kept.map((p) => p.productId));
      expect(response.results.map((r) => r.product_id)).toEqual(
        ranking.kept.slice(0, 3).map((p) => p.productId),
      );
      expect(response.more_available).toBe(ranking.kept.length > 3);
    },
  );
});
