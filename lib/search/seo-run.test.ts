// The SEO page run (./seo-run.ts) with a fake AliExpress, a fake LLM and a virtual clock: nothing
// here reaches AliExpress, an LLM or a database. The clock measures what a run would take with the
// latencies given, so the time rules (every call starts only with room before the deadline) are
// checked against the typical and the worst case, and so are the numbers of calls.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { RESULTS_PER_PAGE, SEO_MAX_PRODUCTS } from "@/lib/config/site";
import { EXPLAIN_SYSTEM } from "@/lib/llm/explain";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import { shownCount, type SeoResults } from "@/lib/seo/results";
import { SEO_FETCH } from "./fetch-policy";
import { SearchError } from "./pipeline";
import {
  collectSeoResults,
  continueSeoResults,
  reusableLines,
  SEO_RUN_LIMITS,
  SeoOutOfTimeError,
  type SeoRunDeps,
} from "./seo-run";
import { MemoryStore } from "./store";

const Q = "אוזניות אלחוטיות";
const T0 = Date.parse("2026-09-29T01:00:00.000Z");
const BUDGET_MS = 55_000;

const PARSE: ParsedQueryRaw = {
  product_he: "אוזניות אלחוטיות",
  product_terms: ["wireless earbuds", "earbuds"],
  requirements: [],
  keywords_en: "wireless earbuds",
  min_price_ils: null,
  max_price_ils: null,
  sort_preference: "best_value",
  category_hint: "bluetooth headphones",
};

/** A virtual clock: sleeps wait for it, and drive() moves it to the next wake-up. */
class Clock {
  t = T0;
  private queue: { at: number; resolve: () => void }[] = [];
  now = () => new Date(this.t);
  ms = () => this.t;
  sleep = (ms: number) =>
    new Promise<void>((resolve) => this.queue.push({ at: this.t + Math.max(0, ms), resolve }));
  async drive<T>(work: Promise<T>): Promise<T> {
    let done = false;
    work.then(
      () => (done = true),
      () => (done = true),
    );
    while (!done) {
      for (let i = 0; i < 20 && !done; i++) await new Promise((r) => setImmediate(r));
      if (done) break;
      this.queue.sort((a, b) => a.at - b.at);
      const next = this.queue.shift();
      if (!next) throw new Error("the run is waiting on nothing");
      this.t = Math.max(this.t, next.at);
      next.resolve();
    }
    return work;
  }
}

// Words for titles that differ enough not to be removed as near-duplicates.
const VOCAB = [
  "sport",
  "bass",
  "noise",
  "cancelling",
  "waterproof",
  "gaming",
  "stereo",
  "touch",
  "control",
  "mini",
  "battery",
  "hifi",
  "sound",
  "earhooks",
  "display",
  "pairing",
  "microphone",
  "deep",
  "ergonomic",
  "lightweight",
  "comfortable",
  "running",
  "workout",
  "clear",
];

/** The i-th set of 4 words of VOCAB (every i a different set). */
function words(i: number): string[] {
  const out: string[] = [];
  let rest = i;
  let from = 0;
  for (let k = 4; k > 0; k--) {
    // Combinatorial number system over VOCAB.
    for (let v = from; v < VOCAB.length; v++) {
      const c = choose(VOCAB.length - v - 1, k - 1);
      if (rest < c) {
        out.push(VOCAB[v]);
        from = v + 1;
        break;
      }
      rest -= c;
    }
  }
  return out;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

const FIXTURE = JSON.parse(
  readFileSync("fixtures/aliexpress/aliexpress.affiliate.product.query.json", "utf8"),
);
const TEMPLATE = FIXTURE.aliexpress_affiliate_product_query_response.resp_result.result.products
  .product[0] as Record<string, unknown>;

interface FakeProduct {
  i: number;
  feedback?: number;
  sales?: number;
  price?: number;
}

/** One product.query product (the real response's shape, made-up values). */
function aliProduct({
  i,
  feedback = 97.5,
  sales = 30_000 - i * 40,
  price = 40 + (i % 17),
}: FakeProduct) {
  const id = String(1005009000000000 + i);
  return {
    ...TEMPLATE,
    product_id: id,
    product_title: `Wireless Earbuds ${words(i).join(" ")}`,
    target_sale_price: price.toFixed(2),
    target_original_price: (price * 2).toFixed(2),
    discount: "50%",
    evaluate_rate: `${feedback}%`,
    lastest_volume: sales,
    shop_id: String(2000000 + i),
    shop_url: `https://www.aliexpress.com/store/${2000000 + i}`,
    product_detail_url: `https://www.aliexpress.com/item/${id}.html`,
    promotion_link: `https://s.click.aliexpress.com/e/_fake${i}`,
    first_level_category_id: "44",
  };
}

function page(products: FakeProduct[], total = 5000) {
  return JSON.stringify({
    aliexpress_affiliate_product_query_response: {
      resp_result: {
        resp_code: 200,
        resp_msg: "Call succeeds",
        result: {
          current_record_count: products.length,
          total_record_count: total,
          current_page_no: 1,
          products: { product: products.map(aliProduct) },
        },
      },
    },
  });
}

/** Lines that pass the explain checks, all different within a batch. */
const WHYS = [
  "אוזניות אלחוטיות שעברו את הסינון, עם משוב חיובי גבוה ומכירות רבות.",
  "מתאימות לחיפוש ונמכרות הרבה בחודש האחרון, עם משוב חיובי גבוה.",
  "בחירה פופולרית שעברה את הסינון, עם משוב חיובי גבוה מקונים.",
  "אוזניות שעברו את הסינון שלנו, עם הרבה מכירות בחודש האחרון.",
  "מתאימות למה שחיפשתם, עם הרבה מכירות ומשוב חיובי גבוה.",
];

class FakeLlm implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model = "claude-haiku-4-5";
  explains = 0;
  parses = 0;
  running = 0;
  maxRunning = 0;
  /** Batches explained, as the model saw them (their product count). */
  batches: number[] = [];
  /** The i-th explain call throws. */
  failCall?: number;
  /** why_he of a product by its title (default WHYS by position). */
  why?: (title: string, index: number) => string;
  constructor(
    private clock: Clock,
    private latency: { parse: number; explain: number },
  ) {}
  async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
    const usage = { inputTokens: 900, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 };
    if (req.system !== EXPLAIN_SYSTEM) {
      this.parses++;
      await this.clock.sleep(this.latency.parse);
      return { data: PARSE as z.infer<T>, usage, model: this.model };
    }
    const call = this.explains++;
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      await this.clock.sleep(this.latency.explain);
      if (call === this.failCall) throw new Error("explain: request timed out");
      const { products } = JSON.parse(req.user) as {
        products: { id: string; title_en: string }[];
      };
      this.batches.push(products.length);
      const items = products.map((p, i) => ({
        id: p.id,
        title_he: "אוזניות אלחוטיות",
        why_he: this.why ? this.why(p.title_en, i) : WHYS[i % WHYS.length],
      }));
      return { data: { items } as z.infer<T>, usage, model: this.model };
    } finally {
      this.running--;
    }
  }
}

interface Setup {
  /** Products of each product.query call, in order. */
  pages: FakeProduct[][];
  latency?: { query: number; parse: number; explain: number };
  budget?: number;
}

function setup({
  pages,
  latency = { query: 1_500, parse: 2_000, explain: 4_000 },
  budget = 1_000,
}: Setup) {
  const clock = new Clock();
  let calls = 0;
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const products = pages[Math.min(calls, pages.length - 1)] ?? [];
    calls++;
    await clock.sleep(latency.query);
    return new Response(page(products));
  });
  const ali = new AliExpressClient(
    { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
    { fetch: fetchMock, sleep: clock.sleep, now: clock.ms, retries: 1 },
  );
  const llm = new FakeLlm(clock, latency);
  const store = new MemoryStore();
  let units = 0;
  const chargeBudget = vi.fn(async () => {
    if (++units > budget) throw new SearchError("capacity", "used up");
  });
  const saveTitles = vi.fn<SeoRunDeps["saveTitles"]>(async () => {});
  const deps: SeoRunDeps = {
    llm,
    ali,
    store,
    shopCap: "none",
    chargeBudget,
    saveTitles,
    now: clock.now,
    sleep: clock.sleep,
    clockMs: clock.ms,
    newSearchUid: () => "00000000-0000-4000-8000-000000000001",
  };
  return { clock, deps, llm, store, fetchMock, chargeBudget, saveTitles };
}

const range = (from: number, count: number, over: Partial<FakeProduct> = {}): FakeProduct[] =>
  Array.from({ length: count }, (_, k) => ({ i: from + k, ...over }));

async function collect(s: ReturnType<typeof setup>, previous: SeoResults[] = []) {
  const deadline = s.clock.t + BUDGET_MS;
  const out = await s.clock.drive(collectSeoResults(Q, s.deps, { deadline, previous }));
  return { ...out, elapsed: s.clock.t - (deadline - BUDGET_MS), deadline };
}

describe("collectSeoResults (owner decision 2026-09-29)", () => {
  it("shows every passer up to 50, ranked, in groups of five, one explain call per group", async () => {
    const s = setup({ pages: [range(0, 50), range(50, 50)] });
    const { results, meta } = await collect(s);
    expect(results.results).toHaveLength(SEO_MAX_PRODUCTS);
    expect(results.groups).toHaveLength(SEO_MAX_PRODUCTS / RESULTS_PER_PAGE);
    expect(results.groups.every((g) => g.state === "model" && g.ids.length === 5)).toBe(true);
    expect(shownCount(results)).toBe(50);
    expect(results.full).toBe(true);
    expect(results.passed_count).toBeGreaterThanOrEqual(50);
    // One parse, then one call per group of five.
    expect(s.llm.parses).toBe(1);
    expect(s.llm.explains).toBe(10);
    expect(s.llm.batches.every((n) => n === RESULTS_PER_PAGE)).toBe(true);
    // At most three at a time.
    expect(s.llm.maxRunning).toBe(SEO_RUN_LIMITS.explainConcurrency);
    // Every call in llm_usage: the first group as "explain", the others as "explain_more".
    expect(s.store.usage.map((u) => u.kind)).toEqual([
      "parse",
      "explain",
      ...Array(9).fill("explain_more"),
    ]);
    expect(meta.explainCalls).toBe(10);
    // Every card has our title and line.
    for (const p of results.results) {
      expect(p.title_he).toBe("אוזניות אלחוטיות");
      expect(p.why_he).not.toBe("");
    }
    // Only the fields the page renders: one photo.
    expect(results.results.every((p) => p.image_urls.length <= 1)).toBe(true);
  });

  it("saves every product for /p and /go, with our titles", async () => {
    const s = setup({ pages: [range(0, 50)] });
    const { results } = await collect(s);
    expect(s.store.products.size).toBe(50);
    for (const p of results.results) {
      expect(s.store.products.get(p.product_id)?.titleHe).toBe("אוזניות אלחוטיות");
    }
  });

  it("logs one search_log row as a preview, never listed", async () => {
    const s = setup({ pages: [range(0, 50)] });
    await collect(s);
    expect(s.store.logs).toHaveLength(1);
    expect(s.store.logs[0]).toMatchObject({
      source: "preview",
      origin: "preview",
      listable: false,
      resultsCount: 50,
      failure: null,
    });
  });

  it("caches its first three groups for visitors' searches with the same filters", async () => {
    const s = setup({ pages: [range(0, 50)] });
    const { results } = await collect(s);
    const [entry] = [...s.store.results.values()];
    expect(entry.products.map((p) => p.productId)).toEqual(
      results.results.slice(0, 15).map((p) => p.product_id),
    );
    expect(Object.keys(entry.explanations)).toHaveLength(15);
  });

  it("makes more product.query calls than a search, up to five, until 50 pass", async () => {
    // A fifth of each page passes (the others' feedback is too low): five calls, never six.
    const fifth = (from: number) =>
      range(from, 50).map((p, k) => (k % 5 === 0 ? p : { ...p, feedback: 80 }));
    const s = setup({ pages: [0, 100, 200, 300, 400, 500].map(fifth) });
    const { results, meta } = await collect(s);
    expect(s.fetchMock).toHaveBeenCalledTimes(SEO_FETCH.maxCalls);
    expect(meta.aliCalls).toBe(5);
    expect(meta.fetchStop).toBe("calls");
    expect(results.results).toHaveLength(50);
    expect(results.checked_count).toBe(250);
    // A third of each page passes: it stops once 50 pass.
    const third = (from: number) =>
      range(from, 50).map((p, k) => (k % 3 === 0 ? p : { ...p, feedback: 80 }));
    const t = setup({ pages: [0, 100, 200, 300].map(third) });
    const enough = await collect(t);
    expect(t.fetchMock).toHaveBeenCalledTimes(3);
    expect(enough.meta.fetchStop).toBe("enough");
    expect(enough.results.results).toHaveLength(50);
    expect(enough.results.passed_count).toBe(51);
  });

  it("stops at the ladder's end, with fewer than 50 when no more pass", async () => {
    const s = setup({ pages: [range(0, 12), []] });
    const { results } = await collect(s);
    expect(results.results).toHaveLength(12);
    expect(results.groups.map((g) => g.ids.length)).toEqual([5, 5, 2]);
    expect(s.llm.batches).toEqual([5, 5, 2]);
  });

  it("keeps the lines of a group whose products and order are unchanged and still hold", async () => {
    const s = setup({ pages: [range(0, 50)] });
    const first = await collect(s);
    const again = setup({ pages: [range(0, 50)] });
    const second = await collect(again, [first.results]);
    expect(again.llm.explains).toBe(0);
    expect(second.meta.groupsReused).toBe(10);
    expect(second.results.results.map((p) => p.why_he)).toEqual(
      first.results.results.map((p) => p.why_he),
    );
    // A product gone from the list shifts every later group: those are explained again, the
    // groups before it keep their lines.
    const place = first.results.results.findIndex((p) => p.product_id.endsWith("000007"));
    const group = Math.floor(place / RESULTS_PER_PAGE);
    const gone = setup({ pages: [range(0, 50).filter((p) => p.i !== 7)] });
    const third = await collect(gone, [first.results]);
    expect(third.meta.groupsReused).toBe(group);
    expect(gone.llm.explains).toBe(10 - group);
  });

  it("explains a group again when a stored line no longer holds for the new numbers", async () => {
    const s = setup({ pages: [range(0, 5)] });
    s.llm.why = (_t, i) =>
      i === 0 ? "אוזניות שעברו את הסינון, עם 97.5% משוב חיובי מקונים." : WHYS[i];
    const first = await collect(s);
    const lower = setup({
      pages: [range(0, 5).map((p) => ({ ...p, feedback: p.i === 0 ? 96 : 97.5 }))],
    });
    await collect(lower, [first.results]);
    expect(lower.llm.explains).toBe(1);
  });

  it("moves a first-group product the line calls another product off the first group", async () => {
    const s = setup({ pages: [range(0, 12)] });
    s.llm.why = (title, i) =>
      title.includes(words(0).join(" "))
        ? "אביזר משלים, לא האוזניות עצמן: מתאים לאוזניות אלחוטיות."
        : WHYS[i];
    const { results, meta } = await collect(s);
    const flagged = String(1005009000000000);
    expect(meta.demoted).toEqual([flagged]);
    expect(results.groups[0].ids).not.toContain(flagged);
    expect(results.groups.at(-1)!.ids).toContain(flagged);
    // The product that moved up has the line built from the data (no extra call for it).
    const promoted = results.results.find((p) => p.product_id === results.groups[0].ids[4])!;
    expect(promoted.why_he).toMatch(/משוב חיובי/);
    expect(s.llm.explains).toBe(3);
  });

  it("charges the daily budget once per run and once per further call, and stops when it is used up", async () => {
    const s = setup({ pages: [range(0, 50)], budget: 4 });
    const { results, meta } = await collect(s);
    // The run's charge (parse, fetch and the first group) and three more groups.
    expect(s.chargeBudget).toHaveBeenCalledTimes(5);
    expect(meta.explainCalls).toBe(4);
    expect(results.groups.filter((g) => g.state === "model")).toHaveLength(4);
    expect(meta.groupsPending).toBe(6);
  });

  it("leaves a group whose call failed pending, and shows only the groups before it", async () => {
    const s = setup({ pages: [range(0, 50)] });
    s.llm.failCall = 2;
    const { results, meta } = await collect(s);
    expect(meta.explainFailed).toBe(true);
    const pending = results.groups.findIndex((g) => g.state === "pending");
    expect(pending).toBeGreaterThan(0);
    expect(shownCount(results)).toBe(pending * RESULTS_PER_PAGE);
    // A pending group carries no lines of ours.
    for (const id of results.groups[pending].ids) {
      const p = results.results.find((r) => r.product_id === id)!;
      expect(p.why_he).toBe("");
      expect(p.title_he).toBe(p.title_en);
    }
  });

  it("fails like a search when the first product.query fails, and logs the failure", async () => {
    const s = setup({ pages: [range(0, 50)] });
    s.fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    await expect(collect(s)).rejects.toMatchObject({ code: "upstream" });
    expect(s.store.logs[0]).toMatchObject({ failure: "upstream", source: "preview" });
    // The parse was paid for: it is in llm_usage.
    expect(s.store.usage.map((u) => u.kind)).toEqual(["parse"]);
  });

  it("does not start without room for its first AliExpress call", async () => {
    const s = setup({ pages: [range(0, 50)] });
    const deadline = s.clock.t + 20_000;
    await expect(s.clock.drive(collectSeoResults(Q, s.deps, { deadline }))).rejects.toBeInstanceOf(
      SeoOutOfTimeError,
    );
    expect(s.fetchMock).not.toHaveBeenCalled();
  });
});

describe("time (maxDuration 60 s; the callers pass 55 s)", () => {
  it("typical: 5 calls of 1.5 s and 10 explain calls of 4 s end in about 30 s, complete", async () => {
    const mixed = (from: number) =>
      range(from, 50).map((p, k) => (k % 5 === 0 ? p : { ...p, feedback: 80 }));
    const s = setup({
      pages: [0, 100, 200, 300, 400, 500].map(mixed),
      latency: { query: 1_500, parse: 2_000, explain: 4_000 },
    });
    const { results, elapsed } = await collect(s);
    expect(s.fetchMock).toHaveBeenCalledTimes(5);
    expect(results.groups.every((g) => g.state === "model")).toBe(true);
    // Parse 2 s, fetch 5 x 1.5 s + 4 x 1.1 s, 4 rounds of explain calls of 4 s.
    expect(elapsed).toBe(2_000 + 5 * 1_500 + 4 * 1_100 + 4 * 4_000);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("slow: 5 calls of 3 s and explain calls of 10 s split, and the rest continues later", async () => {
    const mixed = (from: number) =>
      range(from, 50).map((p, k) => (k % 5 === 0 ? p : { ...p, feedback: 80 }));
    const s = setup({
      pages: [0, 100, 200, 300, 400, 500].map(mixed),
      // The parse comes from the parse cache (a page's query was parsed before): no wait.
      latency: { query: 3_000, parse: 0, explain: 10_000 },
    });
    const run = await collect(s);
    const elapsed = run.elapsed;
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
    expect(s.fetchMock).toHaveBeenCalledTimes(5);
    const explained = run.results.groups.filter((g) => g.state === "model").length;
    // Group one alone, then two rounds of three: 7 of 10 groups, 3 left for the next run.
    expect(explained).toBe(7);
    expect(run.meta.groupsPending).toBe(3);

    const next = s.clock.t;
    const done = await s.clock.drive(
      continueSeoResults(run.results, s.deps, { deadline: next + BUDGET_MS }),
    );
    expect(done.results.groups.every((g) => g.state === "model")).toBe(true);
    expect(s.clock.t - next).toBe(10_000);
  });

  it("worst: calls at their limits never run past the deadline", async () => {
    // Each product.query takes its full 8 s timeout, the parse 10 s, each explain its 10 s limit.
    const s = setup({
      pages: [0, 100, 200, 300, 400].map((f) =>
        range(f, 50).map((p, k) => (k % 5 ? { ...p, feedback: 80 } : p)),
      ),
      latency: { query: 8_000, parse: 10_000, explain: 10_000 },
    });
    const { results, elapsed } = await collect(s);
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
    // Two product.query calls fit (parse 10 s, 8 s, 1.1 s, 8 s), then group one and one round.
    expect(s.fetchMock).toHaveBeenCalledTimes(2);
    expect(results.groups.filter((g) => g.state === "model")).toHaveLength(4);
    expect(shownCount(results)).toBe(20);
  });
});

describe("continueSeoResults", () => {
  it("explains only the groups still missing their lines, without fetching", async () => {
    const s = setup({ pages: [range(0, 50)], budget: 3 });
    const { results } = await collect(s);
    expect(results.groups.filter((g) => g.state === "model")).toHaveLength(3);
    const fetched = s.fetchMock.mock.calls.length;
    const before = s.llm.explains;
    const more = setup({ pages: [] });
    const done = await more.clock.drive(
      continueSeoResults(results, more.deps, { deadline: more.clock.t + BUDGET_MS }),
    );
    expect(done.results.groups.every((g) => g.state === "model")).toBe(true);
    expect(more.llm.explains).toBe(7);
    expect(more.fetchMock).not.toHaveBeenCalled();
    expect(s.fetchMock.mock.calls.length).toBe(fetched);
    expect(s.llm.explains).toBe(before);
    // Its titles go onto the stored rows; its calls into llm_usage.
    expect(Object.keys(more.saveTitles.mock.calls[0][0])).toHaveLength(35);
    expect(more.store.usage.every((u) => u.kind === "explain_more")).toBe(true);
    // The groups written before keep their lines.
    expect(done.results.results.slice(0, 15)).toEqual(results.results.slice(0, 15));
    // Every call is charged.
    expect(more.chargeBudget).toHaveBeenCalledTimes(7);
  });
});

describe("reusableLines", () => {
  const context = {
    product_he: "אוזניות אלחוטיות",
    requirements_he: [],
    sort_preference: "best_value" as const,
  };

  it("needs the same search: another context writes new lines", async () => {
    const s = setup({ pages: [range(0, 5)] });
    const { results } = await collect(s);
    const ids = results.groups[0].ids;
    const inputs = new Map(
      results.results.map((p) => [
        p.product_id,
        {
          product_id: p.product_id,
          title_en: p.title_en,
          price_ils: p.price_ils,
          original_price_ils: p.original_price_ils,
          discount_pct: p.discount_pct,
          positive_feedback_pct: p.positive_feedback_pct,
          units_sold_30d: p.units_sold,
        },
      ]),
    );
    expect(reusableLines(ids, inputs, [results], context)).not.toBeNull();
    expect(reusableLines(ids, inputs, [results], { ...context, product_he: "אוזניות" })).toBeNull();
    expect(reusableLines([...ids].reverse(), inputs, [results], context)).toBeNull();
    expect(reusableLines(ids, inputs, [{ ...results, explain_version: 0 }], context)).toBeNull();
  });
});
