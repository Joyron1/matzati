// The search in stages (plan item 15: products before their lines) and the views of a checked
// pool (plan item 13: a sort change or a removed requirement without a new fetch). The LLM and
// AliExpress are fakes; the products are a real product.query response.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { EXPLAIN_SYSTEM } from "@/lib/llm/explain";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import { passesFilters } from "@/lib/ranking/rank";
import type { ResultProduct, SearchResponse, SortPreference } from "@/lib/types";
import { applyOverrides } from "./chips";
import type { ParsedQuery } from "./filters";
import { loadMore, runSearch, SearchError, startSearch } from "./pipeline";
import { poolOf, viewKeyOf } from "./pool";
import { MemoryStore } from "./store";

// Real product.query response ("usb cable", ILS), captured by check:ali.
const PRODUCTS = readFileSync(
  "fixtures/aliexpress/aliexpress.affiliate.product.query.json",
  "utf8",
);

const PARSE: ParsedQueryRaw = {
  product_he: "כבל USB",
  product_terms: ["cable"],
  requirements: [],
  keywords_en: "usb cable",
  min_price_ils: null,
  max_price_ils: null,
  sort_preference: "best_value",
  category_hint: null,
};
const Q = "כבל USB";

/** One line per product explained, all different, no numbers and no comparison. */
const LINES = [
  "כבל איכותי שעבר את כל הסינונים שלנו, עם משוב חיובי גבוה.",
  "מתאים לחיפוש שלכם ונמכר הרבה בחודש האחרון.",
  "בחירה פופולרית שעברה את הסינון, עם משוב חיובי גבוה.",
  "כבל שקונים רבים בחרו בו בחודש האחרון, עם משוב טוב.",
  "עונה על מה שחיפשתם ועבר את בדיקת המשוב והמכירות.",
  "כבל שימושי לטעינה יומיומית, עם הרבה קונים מרוצים.",
  "עבר את הסינון שלנו ומתאים למה שביקשתם.",
  "כבל שנמכר היטב ועם משוב חיובי מקונים רבים.",
  "מתאים לשימוש יומיומי ועבר את כל הבדיקות שלנו.",
  "כבל עם ביקוש גבוה בחודש האחרון ומשוב טוב.",
  "אפשרות נוספת לחיפוש שלכם, עם קונים מרוצים.",
  "כבל שעבר את הסינון ונבחר על ידי קונים רבים.",
];
const TITLE = "כבל טעינה מהיר";
/** A comparison's scope by the number of products compared, as EXPLAIN_SYSTEM lists them. */
const SCOPES: Record<number, string> = { 2: "השניים", 3: "השלושה", 4: "הארבעה", 5: "החמישה" };

class FakeLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-haiku-4-5";
  parses = 0;
  /** The English titles of the products of each explain call. */
  explained: string[][] = [];
  /** Holds every explain call until released. */
  gate: Promise<void> | null = null;
  /** How long each explain call takes (setTimeout, so fake timers can run it). */
  delayMs = 0;
  failing = false;
  /** The cheapest of a batch of two to five says so, as the prompt allows. */
  compare = false;
  /** Lines to write next, one per product, before the usual ones. */
  nextLines: string[] = [];
  private written = 0;
  constructor(private parse: ParsedQueryRaw = PARSE) {}

  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
    const usage = { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
    if (req.system !== EXPLAIN_SYSTEM) {
      this.parses++;
      return { data: this.parse as z.infer<T>, usage, model: this.model };
    }
    const { products } = JSON.parse(req.user) as {
      products: { id: string; title_en: string; price_ils: number }[];
    };
    this.explained.push(products.map((p) => p.title_en));
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.gate) await this.gate;
    if (this.failing) throw new Error("explain: request timed out");
    const cheapest = Math.min(...products.map((p) => p.price_ils));
    const scope = SCOPES[products.length] ?? null;
    const items = products.map((p) => ({
      id: p.id,
      title_he: TITLE,
      why_he:
        this.nextLines.shift() ??
        (this.compare && scope && p.price_ils === cheapest
          ? `כבל שעבר את הסינון שלנו, והזול מבין ${scope}.`
          : LINES[this.written++ % LINES.length]),
    }));
    return { data: { items } as z.infer<T>, usage, model: this.model };
  }
}

function setup(parse: ParsedQueryRaw = PARSE) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(PRODUCTS));
  const ali = new AliExpressClient(
    { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
    { fetch: fetchMock, sleep: async () => {} },
  );
  const llm = new FakeLlm(parse);
  const store = new MemoryStore();
  return { deps: { llm, ali, store, sleep: async () => {} }, llm, store, fetchMock };
}

/** product.query calls made so far. */
const queries = (fetchMock: ReturnType<typeof setup>["fetchMock"]) =>
  fetchMock.mock.calls.filter(
    (c) =>
      new URLSearchParams(String(c[1]?.body)).get("method") ===
      "aliexpress.affiliate.product.query",
  ).length;

const ids = (r: SearchResponse) => r.results.map((p) => p.product_id);

/** The line built from the data (whyFromData), without the numbers the shop shares. */
const dataLine = (r: Pick<ResultProduct, "shared_numbers">) => {
  const feedback = !r.shared_numbers?.feedback;
  const sales = !r.shared_numbers?.sales;
  if (feedback && sales) return /^[\d.]+% משוב חיובי ו־[\d,]+ נמכרו ב־30 הימים האחרונים\.$/;
  if (feedback) return /^[\d.]+% משוב חיובי\.$/;
  if (sales) return /^[\d,]+ נמכרו ב־30 הימים האחרונים\.$/;
  return /^עבר את הסינון שלנו\.$/;
};

/** The filters a request builds from the parse (lib/search/pipeline.ts). */
const viewFilters = (parse: ParsedQueryRaw, without: string[], sort?: SortPreference) => {
  const parsed = {
    ...parse,
    min_price_ils: parse.min_price_ils ?? undefined,
    max_price_ils: parse.max_price_ils ?? undefined,
    category_hint: parse.category_hint ?? undefined,
  } as ParsedQuery;
  return { ...applyOverrides(parsed, without), ...(sort ? { sort_preference: sort } : {}) };
};

const passesAnyTier = (p: Parameters<typeof passesFilters>[0], f: ParsedQuery) =>
  passesFilters(p, f, FILTERS) || passesFilters(p, f, FILL_TIER);

describe("products before their lines (plan item 15)", () => {
  it("shows the ranked products with lines from the data while the explain call runs", async () => {
    const { deps, llm, store } = setup();
    let release!: () => void;
    llm.gate = new Promise<void>((r) => (release = r));
    const stages = startSearch({ q: Q }, deps);

    const understood = await stages.understood;
    expect(understood.chips.map((c) => c.label_he)).toEqual(["כבל USB"]);

    const shown = await stages.products;
    expect(shown.pending).toBe(true);
    expect(shown.response.results).toHaveLength(RESULTS_PER_PAGE);
    for (const r of shown.response.results) {
      // AliExpress's title and the line from the data until the product's own line arrives.
      expect(r.title_he).toBe(r.title_en);
      expect(r.why_he).toMatch(dataLine(r));
      // The card's /go link already works: its row is saved.
      expect(store.products.has(r.product_id)).toBe(true);
    }
    let done = false;
    void stages.final.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    // The explain call is running, and nothing is cached or final yet.
    expect(llm.explained).toHaveLength(1);
    expect(store.results.size).toBe(0);
    expect(done).toBe(false);

    release();
    const final = await stages.final;
    expect(ids(final)).toEqual(ids(shown.response));
    expect(final.results.every((r) => r.title_he === TITLE && LINES.includes(r.why_he))).toBe(true);
    // Cached once the lines were written, with them.
    const cached = store.results.get(final.filters_key!);
    expect(cached?.explanations[final.results[0].product_id]?.title_he).toBe(TITLE);
    const { log, response } = await stages.outcome;
    expect(response).toEqual(final);
    expect(log.searchUid).toBe(stages.searchUid);
    expect(store.products.get(final.results[0].product_id)?.titleHe).toBe(TITLE);
  });

  it("has the products seconds before their lines when the model is slow (fake timers)", async () => {
    vi.useFakeTimers();
    try {
      const { deps, llm } = setup();
      llm.delayMs = 3_000;
      const started = Date.now();
      const stages = startSearch(
        { q: Q },
        { ...deps, clockMs: () => Date.now(), now: () => new Date() },
      );
      const at: { products?: number; final?: number } = {};
      void stages.products.then(() => (at.products = Date.now() - started));
      void stages.final.then(() => (at.final = Date.now() - started));

      await vi.advanceTimersByTimeAsync(100);
      expect(at.products).toBeLessThan(100);
      expect(at.final).toBeUndefined();

      await vi.advanceTimersByTimeAsync(3_000);
      expect(at.final).toBeGreaterThanOrEqual(3_000);
      const { log } = await stages.outcome;
      expect(log.timings.products_ms).toBeLessThan(100);
      expect(log.timings.explain_ms).toBeGreaterThanOrEqual(3_000);
      expect(log.timings.total_ms).toBeGreaterThanOrEqual(3_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the lines from the data when the explain call fails, and says nothing is pending", async () => {
    const { deps, llm, store } = setup();
    llm.failing = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const stages = startSearch({ q: Q }, deps);
      const shown = await stages.products;
      expect(shown.pending).toBe(true);
      const final = await stages.final;
      expect(final.results.map((r) => r.why_he)).toEqual(
        shown.response.results.map((r) => r.why_he),
      );
      expect(store.results.get(final.filters_key!)?.degraded).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });

  it("serves a cached search in one go, with nothing pending", async () => {
    const { deps } = setup();
    await runSearch({ q: Q }, deps);
    const stages = startSearch({ q: Q }, deps);
    const shown = await stages.products;
    expect(shown.pending).toBe(false);
    expect(await stages.final).toEqual(shown.response);
    expect(shown.response.cached).toBe(true);
  });

  it("keeps the chips of a search that fails later, and rejects its products", async () => {
    const { deps, fetchMock } = setup();
    fetchMock.mockImplementation(async () => new Response("bad gateway", { status: 502 }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const stages = startSearch({ q: Q }, deps);
      expect((await stages.understood).chips).toHaveLength(1);
      await expect(stages.products).rejects.toMatchObject({ code: "upstream" });
      await expect(stages.final).rejects.toMatchObject({ code: "upstream" });
      await expect(stages.outcome).rejects.toBeInstanceOf(SearchError);
    } finally {
      errors.mockRestore();
    }
  });

  it("rejects every stage of a query it refuses", async () => {
    const { deps } = setup();
    const stages = startSearch({ q: "   " }, deps);
    await expect(stages.understood).rejects.toMatchObject({ code: "invalid_query" });
    await expect(stages.products).rejects.toMatchObject({ code: "invalid_query" });
  });
});

describe("views of a checked pool (plan item 13)", () => {
  it("ranks a sort change from the pool: no product.query call, what a fetch would show", async () => {
    const { deps, fetchMock, llm } = setup();
    const first = await runSearch({ q: Q }, deps);
    const fetches = queries(fetchMock);
    for (const sort of ["cheapest", "most_popular"] as const) {
      const view = await runSearch({ q: Q, sort }, deps);
      expect(queries(fetchMock)).toBe(fetches);
      expect(view.meta).toMatchObject({ cache: "results", derived: true, aliCalls: 0 });
      expect(view.log.diag).toMatchObject({ derived: true, fetch_stop: null });
      expect(view.response.fetched_at).toBe(first.response.fetched_at);
      // The same search fetched from scratch (the fixture answers every call alike).
      const fresh = await runSearch({ q: Q, sort }, setup().deps);
      expect(ids(view.response)).toEqual(ids(fresh.response));
      expect(view.response.passed_count).toBe(fresh.response.passed_count);
      expect(view.response.checked_count).toBe(fresh.response.checked_count);
    }
    expect(llm.parses).toBe(1);
  });

  it("explains only the products shown without a line, and reuses the lines written", async () => {
    const { deps, llm } = setup();
    const first = await runSearch({ q: Q }, deps);
    const lineOf = new Map(first.response.results.map((r) => [r.product_id, r.why_he]));
    let reusedSome = false;
    for (const sort of ["cheapest", "most_popular"] as const) {
      const calls = llm.explained.length;
      const view = await runSearch({ q: Q, sort }, deps);
      const fresh = view.response.results.filter((r) => !lineOf.has(r.product_id));
      const kept = view.response.results.filter((r) => lineOf.has(r.product_id));
      if (fresh.length) {
        expect(llm.explained.slice(calls)).toEqual([fresh.map((r) => r.title_en)]);
      } else {
        expect(llm.explained).toHaveLength(calls);
      }
      for (const r of kept) expect(r.why_he).toBe(lineOf.get(r.product_id));
      reusedSome ||= kept.length > 0;
      if (kept.length) expect(view.log.diag?.lines_reused).toBe(kept.length);
      for (const r of fresh) lineOf.set(r.product_id, r.why_he);
    }
    expect(reusedSome).toBe(true);
    // Back to the first sort: its own result set, nothing new to write.
    const calls = llm.explained.length;
    const back = await runSearch({ q: Q }, deps);
    expect(back.response).toMatchObject({ cached: true, results: first.response.results });
    expect(llm.explained).toHaveLength(calls);
  });

  it("never shows a comparison that is false for the products shown with it", async () => {
    const { deps, llm } = setup();
    llm.compare = true;
    const first = await runSearch({ q: Q }, deps);
    expect(first.response.results.some((r) => r.why_he.includes("הזול מבין"))).toBe(true);
    for (const sort of ["cheapest", "most_popular", "best_value"] as const) {
      for (const without of [[], ["x"]]) {
        const { response } = await runSearch({ q: Q, sort, without }, deps);
        const cheapest = Math.min(...response.results.map((r) => r.price_ils));
        const scope = SCOPES[response.results.length];
        for (const r of response.results) {
          if (!r.why_he.includes("הזול מבין")) continue;
          expect(r.price_ils).toBe(cheapest);
          expect(r.why_he).toContain(scope);
        }
      }
    }
  });

  it("writes a new line for a product whose earlier line compares it wrongly on this page", async () => {
    const { deps, llm, store } = setup();
    const first = await runSearch({ q: Q }, deps);
    const entry = store.results.get(first.response.filters_key!)!;
    const pool = poolOf(entry)!;
    const [cheapestId, secondId] = pool.views[viewKeyOf("cheapest", [])].ids;
    // Lines written for other pages: "the cheapest of the five" holds there, and on this page
    // only for the cheapest.
    const claim = "כבל שעבר את הסינון שלנו, והזול מבין החמישה.";
    pool.lines[cheapestId] = { title_he: TITLE, why_he: claim };
    pool.lines[secondId] = { title_he: TITLE, why_he: claim };
    const calls = llm.explained.length;
    const { response } = await runSearch({ q: Q, sort: "cheapest" }, deps);
    const byId = new Map(response.results.map((r) => [r.product_id, r]));
    expect(byId.get(cheapestId)?.why_he).toBe(claim);
    expect(byId.get(secondId)?.why_he).not.toBe(claim);
    expect(llm.explained.slice(calls).flat()).toContain(byId.get(secondId)?.title_en);
    expect(llm.explained.slice(calls).flat()).not.toContain(byId.get(cheapestId)?.title_en);
  });

  it("applies the safety net before the products show when every line of a view is reused", async () => {
    const { deps, llm, store } = setup();
    const first = await runSearch({ q: Q }, deps);
    const pool = poolOf(store.results.get(first.response.filters_key!)!)!;
    const page = pool.views[viewKeyOf("cheapest", [])].ids.slice(0, RESULTS_PER_PAGE);
    // Lines written earlier for these products; the lead's says it is not the searched product.
    const partial = "אביזר משלים, לא הכבל עצמו: מארגן שעבר את הסינון שלנו.";
    pool.lines[page[0]] = { title_he: TITLE, why_he: partial };
    page.slice(1).forEach((id, i) => (pool.lines[id] = { title_he: TITLE, why_he: LINES[5 + i] }));
    const calls = llm.explained.length;
    const stages = startSearch({ q: Q, sort: "cheapest" }, deps);
    const shown = await stages.products;
    const final = await stages.final;
    const { meta } = await stages.outcome;
    expect(meta).toMatchObject({
      derived: true,
      linesReused: RESULTS_PER_PAGE,
      demoted: [page[0]],
    });
    expect(llm.explained).toHaveLength(calls);
    // Nothing pending, so the page never swaps: what shows first is the order that is kept.
    expect(shown.pending).toBe(false);
    expect(shown.response).toEqual(final);
    expect(ids(shown.response)).not.toContain(page[0]);
    expect(ids(shown.response).slice(0, RESULTS_PER_PAGE - 1)).toEqual(page.slice(1));
    // The product that moved up shows the line from the data, and its /go row is saved.
    const up = shown.response.results[RESULTS_PER_PAGE - 1];
    expect(up.why_he).toMatch(dataLine(up));
    for (const id of ids(shown.response)) expect(store.products.has(id)).toBe(true);
  });

  it("keeps a line already on screen when a new line of the page repeats it", async () => {
    const { deps, llm, store } = setup();
    const first = await runSearch({ q: Q }, deps);
    const entry = store.results.get(first.response.filters_key!)!;
    const pool = poolOf(entry)!;
    const page = pool.views[viewKeyOf("most_popular", [])].ids.slice(0, RESULTS_PER_PAGE);
    // The first card has no line yet; the others show lines written earlier.
    delete entry.explanations[page[0]];
    delete pool.lines[page[0]];
    const earlier = page.slice(1).map((_, i) => LINES[5 + i]);
    page.slice(1).forEach((id, i) => (pool.lines[id] = { title_he: TITLE, why_he: earlier[i] }));
    // The model's new line for the first card repeats the last card's, which is on screen.
    const last = earlier.at(-1)!;
    llm.nextLines = [last];
    const stages = startSearch({ q: Q, sort: "most_popular" }, deps);
    const shown = await stages.products;
    expect(shown.pending).toBe(true);
    expect(shown.response.results.map((r) => r.why_he).slice(1)).toEqual(earlier);
    const final = await stages.final;
    expect(ids(final)).toEqual(page);
    // The line read already stays; the new one falls back to the data sentence.
    expect(final.results[RESULTS_PER_PAGE - 1].why_he).toBe(last);
    expect(final.results[0].why_he).toMatch(dataLine(final.results[0]));
    expect(llm.explained.at(-1)).toHaveLength(1);
  });

  const PARSE_100W: ParsedQueryRaw = {
    ...PARSE,
    keywords_en: "100w usb cable",
    requirements: [{ en: "100w", alt: [], he: "100W" }],
  };

  it("serves a removed requirement from the pool, showing only products every other filter passes", async () => {
    const { deps, fetchMock, store } = setup(PARSE_100W);
    const first = await runSearch({ q: "כבל 100W" }, deps);
    const fetches = queries(fetchMock);
    const view = await runSearch({ q: "כבל 100W", without: ["req:100w"] }, deps);
    expect(queries(fetchMock)).toBe(fetches);
    expect(view.meta.derived).toBe(true);
    expect(view.response.chips.map((c) => c.id)).toEqual(["product"]);
    expect(view.response.passed_count).toBeGreaterThan(first.response.passed_count);
    // Products the requirement kept out came back, and every product kept passes the rest.
    const kept = store.results.get(view.response.filters_key!)!.products;
    expect(kept.some((p) => !/100w/i.test(p.title))).toBe(true);
    const filters = viewFilters(PARSE_100W, ["req:100w"]);
    for (const p of kept) expect(passesAnyTier(p, filters)).toBe(true);
    // The same as fetching without it (the fixture answers any keywords alike).
    const fresh = await runSearch({ q: "כבל 100W", without: ["req:100w"] }, setup(PARSE_100W).deps);
    expect(ids(view.response)).toEqual(ids(fresh.response));
    expect(view.response.passed_count).toBe(fresh.response.passed_count);
  });

  it("fetches again when a removed requirement leaves fewer than a page, or a price goes", async () => {
    const parse: ParsedQueryRaw = {
      ...PARSE,
      keywords_en: "magnetic braided usb cable",
      requirements: [
        { en: "magnetic", alt: [], he: "מגנטי" },
        { en: "braided", alt: [], he: "קלוע" },
      ],
      max_price_ils: 40,
    };
    const { deps, fetchMock } = setup(parse);
    const q = "כבל מגנטי קלוע עד 40";
    const first = await runSearch({ q }, deps);
    expect(first.response.results).toEqual([]);
    let fetches = queries(fetchMock);
    // Without both, a page passes: ranked from the pool.
    const both = await runSearch({ q, without: ["req:magnetic", "req:braided"] }, deps);
    expect(both.meta.derived).toBe(true);
    expect(both.response.results.length).toBe(RESULTS_PER_PAGE);
    expect(queries(fetchMock)).toBe(fetches);
    // Without one, fewer than a page: searched again without its words.
    const one = await runSearch({ q, without: ["req:magnetic"] }, deps);
    expect(one.meta.derived).toBeUndefined();
    expect(queries(fetchMock)).toBeGreaterThan(fetches);
    fetches = queries(fetchMock);
    // Without the price bound: AliExpress was asked within it, so it is asked again.
    const price = await runSearch({ q, without: ["max"] }, deps);
    expect(price.meta.derived).toBeUndefined();
    expect(queries(fetchMock)).toBeGreaterThan(fetches);
  });

  it("keeps the pool on the result set of the fetch; the views it serves are result sets of their own", async () => {
    const { deps, store } = setup(PARSE_100W);
    const first = await runSearch({ q: "כבל 100W" }, deps);
    const cheap = await runSearch({ q: "כבל 100W", sort: "cheapest" }, deps);
    const without = await runSearch({ q: "כבל 100W", without: ["req:100w"] }, deps);
    const entry = (r: SearchResponse) => store.results.get(r.filters_key!)!;
    const pool = poolOf(entry(first.response));
    // 3 sorts, with and without the one requirement.
    expect(Object.keys(pool?.views ?? {})).toHaveLength(6);
    expect(poolOf(entry(cheap.response))).toBeNull();
    expect(poolOf(entry(without.response))).toBeNull();
    expect(store.results.size).toBe(3);
    // A pool with real 1,000-character affiliate links stays well under 150 KB.
    const kb = Buffer.byteLength(JSON.stringify(entry(first.response))) / 1024;
    expect(kb).toBeLessThan(150);
  });

  it("explains the parse's own sort when it is first shown after a fetch made for another sort", async () => {
    const { deps, llm, store } = setup();
    const cheap = await runSearch({ q: Q, sort: "cheapest" }, deps);
    // Nothing was cached: fetched for "cheapest", with the parse's own sort kept alongside.
    expect(cheap.meta.derived).toBeUndefined();
    expect(store.results.size).toBe(2);
    const calls = llm.explained.length;
    const best = await runSearch({ q: Q }, deps);
    expect(best.meta.cache).toBe("results");
    const cheapIds = ids(cheap.response);
    const fresh = best.response.results.filter((r) => !cheapIds.includes(r.product_id));
    expect(llm.explained.slice(calls)).toEqual(fresh.length ? [fresh.map((r) => r.title_en)] : []);
    for (const r of best.response.results) {
      expect(r.title_he).toBe(TITLE);
      expect(store.products.has(r.product_id)).toBe(true);
    }
    // Explained once: now a plain cache hit.
    const again = await runSearch({ q: Q }, deps);
    expect(again.response).toMatchObject({ cached: true, results: best.response.results });
    expect(llm.explained).toHaveLength(calls + (fresh.length ? 1 : 0));
  });

  it("shows lines from the data, without failing, when the daily budget is out for a view", async () => {
    const { deps, llm } = setup();
    const first = await runSearch({ q: Q }, deps);
    const refuse = vi.fn(async () => {
      throw new SearchError("capacity", "daily LLM budget is used up");
    });
    const calls = llm.explained.length;
    const view = await runSearch(
      { q: Q, sort: "most_popular" },
      { ...deps, beforeLlmWork: refuse },
    );
    const firstIds = ids(first.response);
    const fresh = view.response.results.filter((r) => !firstIds.includes(r.product_id));
    expect(fresh.length).toBeGreaterThan(0);
    for (const r of fresh) expect(r.why_he).toMatch(dataLine(r));
    expect(llm.explained).toHaveLength(calls);
    expect(view.meta.explainFailed).toBe(true);
  });

  it("serves 'עוד N' of a view ranked from the pool", async () => {
    const { deps, fetchMock } = setup();
    await runSearch({ q: Q }, deps);
    const fetches = queries(fetchMock);
    const view = await runSearch({ q: Q, sort: "most_popular" }, deps);
    expect(view.response.more_available).toBe(true);
    const more = await loadMore(view.response.filters_key!, 1, deps);
    expect(more?.results).toHaveLength(RESULTS_PER_PAGE);
    expect(more!.results.some((r) => ids(view.response).includes(r.product_id))).toBe(false);
    expect(queries(fetchMock)).toBe(fetches);
  });
});
