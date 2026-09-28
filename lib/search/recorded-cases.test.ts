// Regression tests for the cases the quality audit recorded on the live site
// (docs/search-quality-plan.md, "מה המבקר רואה היום" and the technical appendix). Each runs the
// real runSearch over a product-pool snapshot (fixtures/snapshots): product.query is answered
// from the captured calls, the parse comes from the store, and explain gets no data (every line
// falls back to the data sentence). No network, no LLM, no database.
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aliexpress/affiliate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/aliexpress/affiliate")>();
  return { ...actual, queryProducts: vi.fn(), generateLinks: vi.fn() };
});

import { generateLinks, queryProducts } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { loadSnapshots, SNAPSHOT_DIR } from "@/lib/eval/files";
import type { Snapshot } from "@/lib/eval/snapshot";
import type { LlmProvider } from "@/lib/llm/provider";
import { normalizeQuery, queryKey } from "./cache-key";
import { runSearch } from "./pipeline";
import { MemoryStore } from "./store";

const NOW = new Date("2026-09-28T12:00:00Z");

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

const snapshots = existsSync(SNAPSHOT_DIR) ? loadSnapshots() : [];
const byId = (id: string) => snapshots.find((s) => s.id === id)!;

/** The search as the pipeline runs it on this snapshot: its shown page and every kept product. */
async function search(snap: Snapshot): Promise<{ shown: AliProduct[]; kept: AliProduct[] }> {
  vi.mocked(queryProducts).mockImplementation(async (_client, q) => {
    const c = snap.calls.find(
      (c) =>
        !c.error &&
        c.keywords === q.keywords &&
        c.pageNo === (q.pageNo ?? 1) &&
        c.minPriceIls === (q.minPriceIls ?? null) &&
        c.maxPriceIls === (q.maxPriceIls ?? null),
    );
    // A call the snapshot lacks answers empty, as a page with nothing new would.
    if (!c) return { products: [], skipped: 0, totalRecords: 0 };
    return {
      products: c.products,
      skipped: c.rawCount - c.parsedCount,
      totalRecords: c.totalRecords,
    };
  });
  vi.mocked(generateLinks).mockImplementation(async (_client, urls) =>
    urls.map((u) => ({
      sourceValue: u,
      promotionLink: "https://s.click.aliexpress.com/e/_t",
      message: null,
    })),
  );
  const store = new MemoryStore();
  await store.putParse(queryKey(snap.query), normalizeQuery(snap.query), snap.parse.parsed, NOW);
  const { response } = await runSearch(
    { q: snap.query },
    { llm, ali, store, now: () => NOW, sleep: async () => {}, aliSpacingMs: 0 },
  );
  const kept = store.results.get(response.filters_key!)!.products;
  return { shown: kept.slice(0, RESULTS_PER_PAGE), kept };
}

const titles = (ps: AliProduct[]) => ps.map((p) => p.title);

describe.skipIf(!snapshots.length)("recorded cases (fixtures/snapshots)", () => {
  it("drawer organizer: no car under-seat tray on the first page", async () => {
    const { shown } = await search(byId("live-drawer-organizer"));
    expect(shown).toHaveLength(RESULTS_PER_PAGE);
    // "Car Under Seat Storage Box ABS Drawer Organizer", #3 on the live site.
    expect(shown.map((p) => p.productId)).not.toContain("1005012698650176");
    expect(titles(shown).filter((t) => /\bcar\b|under seat/i.test(t))).toEqual([]);
  });

  it("soundbar: one shop never fills the first page while another shop has a result", async () => {
    const { shown, kept } = await search(byId("live-soundbar"));
    expect(shown).toHaveLength(RESULTS_PER_PAGE);
    const shops = shown.map((p) => p.shop.id);
    const twice = shops.some((s, i) => shops.indexOf(s) !== i);
    const otherShopLeft = kept.slice(RESULTS_PER_PAGE).some((p) => !shops.includes(p.shop.id));
    expect(new Set(shops).size).toBeGreaterThan(1);
    expect(twice && otherShopLeft).toBe(false);
    // "Soundbar Stand Base" was #4: no stand or bracket on the first two pages.
    const firstTwoPages = kept.slice(0, 2 * RESULTS_PER_PAGE);
    expect(titles(firstTwoPages).filter((t) => /\bstand\b|bracket/i.test(t))).toEqual([]);
  });

  it("garden gift: the knife sharpener (edge grinder) is not the first result, nor on the first page", async () => {
    const { shown } = await search(byId("ho-gift-garden"));
    expect(shown[0].productId).not.toBe("1005007805667144");
    expect(titles(shown).filter((t) => /sharpen|grind/i.test(t))).toEqual([]);
  });

  it("neck pillow for flights: no car headrest pillow on the first page", async () => {
    for (const id of ["ho-neck-pillow", "ex-9"]) {
      const { shown } = await search(byId(id));
      expect(shown).toHaveLength(RESULTS_PER_PAGE);
      expect(shown.map((p) => p.productId)).not.toContain("1005006678124330");
      expect(titles(shown).filter((t) => /headrest|^car\b/i.test(t))).toEqual([]);
    }
  });
});
