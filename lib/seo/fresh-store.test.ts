import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { ParsedQuery } from "@/lib/search/filters";
import { MemoryStore, type CachedResults } from "@/lib/search/store";
import { withoutResultsCache } from "./fresh-store";

const NOW = new Date("2026-09-29T01:00:00Z");

const PARSED: ParsedQuery = {
  keywords_en: "wireless earbuds",
  product_terms: ["earbuds"],
  product_he: "אוזניות אלחוטיות",
  requirements: [],
  sort_preference: "best_value",
};

const RESULTS: CachedResults = {
  filters: PARSED,
  checked: 10,
  passed: 0,
  products: [],
  explanations: {},
  createdAt: NOW.toISOString(),
};

describe("withoutResultsCache", () => {
  it("finds no cached result set, so the search fetches again", async () => {
    const inner = new MemoryStore();
    await inner.putResults("k", "q", RESULTS);
    expect(await inner.getResults("k", NOW)).not.toBeNull();
    expect(await withoutResultsCache(inner).getResults("k", NOW)).toBeNull();
  });

  it("keeps the parse cache and writes through to the real store", async () => {
    const inner = new MemoryStore();
    const store = withoutResultsCache(inner);
    await store.putParse("qk", "אוזניות", PARSED, NOW);
    expect(await store.getParse("qk", NOW)).toEqual(PARSED);
    await store.putResults("k", "q", RESULTS);
    expect(inner.results.get("k")).toEqual(RESULTS);
    await store.updateResults("k", { ...RESULTS, passed: 3 });
    expect(inner.results.get("k")?.passed).toBe(3);
    const product = { productId: "1" } as AliProduct;
    await store.saveProducts([product], { "1": "כותרת" }, NOW);
    expect(inner.products.get("1")?.titleHe).toBe("כותרת");
    expect(inner.savedAt).toEqual([NOW.toISOString()]);
  });
});
