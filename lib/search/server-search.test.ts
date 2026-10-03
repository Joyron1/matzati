// startSearchForRequest and searchForRequest (lib/search/server.ts): a request's search in stages,
// shared with an identical request that arrives while it runs, kept alive with after() until it is
// cached and logged. The database, the model and AliExpress are fakes; the products are a real
// product.query response.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { EXPLAIN_SYSTEM } from "@/lib/llm/explain";
import { TITLES_SYSTEM } from "@/lib/llm/titles";
import type { ParsedQueryRaw } from "@/lib/llm/parse";
import type { StructuredRequest } from "@/lib/llm/provider";
import { MemoryStore } from "./store";

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
// One line per card of a page (RESULTS_PER_PAGE), all different.
const WHYS = [
  "עבר את הסינון עם משוב חיובי גבוה ומכירות רבות בחודש האחרון.",
  "מתאים לחיפוש ונמכר הרבה בחודש האחרון, עם משוב חיובי גבוה.",
  "בחירה פופולרית שעברה את הסינון, עם משוב חיובי גבוה.",
  "כבל שעבר את הסינון שלנו, עם משוב חיובי גבוה מקונים.",
  "מתאים למה שחיפשתם, עם הרבה מכירות ומשוב חיובי גבוה.",
];

const m = vi.hoisted(() => ({
  store: null as unknown as MemoryStore,
  after: vi.fn<(job: () => unknown) => void>(),
  /** Holds explain calls until released. */
  gate: null as Promise<void> | null,
  explainCalls: 0,
  titlesCalls: 0,
  parseCalls: 0,
  shopCapMode: vi.fn(async (): Promise<"none" | "max2"> => "none"),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({}) }));
vi.mock("./supabase-store", () => ({
  // Every request of a test writes to the same store, as they would to one database.
  SupabaseStore: class {
    constructor() {
      return m.store;
    }
  },
}));
vi.mock("@/lib/guard/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/guard/rate-limit")>()),
  checkSearchRate: vi.fn(async () => ({ ok: true })),
  consumeDailyLlmBudget: vi.fn(async () => true),
}));
vi.mock("@/lib/admin/auth", () => ({ getAdminUser: vi.fn(async () => null) }));
// The admin's shop cap setting (lib/settings/queries.ts), read once per request.
vi.mock("@/lib/settings/queries", () => ({ shopCapMode: m.shopCapMode }));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  aliexpressConfig: () => ({
    appKey: "k",
    appSecret: "s",
    trackingId: "trk",
    gateway: "https://g.test/sync",
  }),
  llmConfig: () => ({ provider: "anthropic", apiKey: "x", model: "claude-haiku-4-5" }),
}));
vi.mock("@/lib/llm/anthropic", () => ({
  AnthropicProvider: class {
    readonly name = "anthropic";
    readonly model = "claude-haiku-4-5";
    async generateStructured<T extends z.ZodType>(req: StructuredRequest<T>) {
      const usage = {
        inputTokens: 900,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      if (req.system === TITLES_SYSTEM) {
        m.titlesCalls++;
        const { products } = JSON.parse(req.user) as { products: { id: string }[] };
        const items = products.map((p) => ({ id: p.id, title_he: "כבל USB לטעינה" }));
        return { data: { items } as z.infer<T>, usage, model: this.model };
      }
      if (req.system !== EXPLAIN_SYSTEM) {
        m.parseCalls++;
        return { data: PARSE as z.infer<T>, usage, model: this.model };
      }
      m.explainCalls++;
      if (m.gate) await m.gate;
      const { products } = JSON.parse(req.user) as { products: { id: string }[] };
      const items = products.map((p, i) => ({
        id: p.id,
        title_he: "כבל טעינה מהיר",
        why_he: WHYS[i],
      }));
      return { data: { items } as z.infer<T>, usage, model: this.model };
    }
  },
}));

const PRODUCTS = readFileSync(
  "fixtures/aliexpress/aliexpress.affiliate.product.query.json",
  "utf8",
);
const fetchMock = vi.fn<typeof fetch>(async () => new Response(PRODUCTS));
const HEADERS = new Headers({ "x-forwarded-for": "203.0.113.7" });
const Q = { q: "כבל USB" };

const { searchForRequest, startSearchForRequest } = await import("./server");

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("IP_HASH_SALT", "salt");
  vi.stubEnv("DAILY_SEARCH_CAP", "2000");
  m.store = new MemoryStore();
  m.gate = null;
  m.explainCalls = 0;
  m.titlesCalls = 0;
  m.parseCalls = 0;
  m.shopCapMode.mockReset();
  m.shopCapMode.mockImplementation(async () => "none");
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => new Response(PRODUCTS));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  m.after.mockReset();
});

/** Runs every job handed to after(), as the platform does once the response is sent. */
async function afterJobs() {
  await Promise.all(m.after.mock.calls.map(([job]) => job()));
}

describe("startSearchForRequest", () => {
  it("streams the chips, then the products with this request's uid, then their lines", async () => {
    let release!: () => void;
    m.gate = new Promise<void>((r) => (release = r));
    const started = await startSearchForRequest(Q, HEADERS);
    if (!started.ok) throw new Error(started.error);
    const understood = await started.value.understood;
    expect(understood.ok && understood.value.chips.map((c) => c.id)).toEqual(["product"]);

    const products = await started.value.products;
    if (!products.ok) throw new Error(products.error);
    expect(products.value.pending).toBe(true);
    const uid = products.value.response.results[0].search_uid;
    expect(uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(products.value.response.results.every((r) => r.search_uid === uid)).toBe(true);
    expect(m.store.results.size).toBe(0);

    release();
    const final = await started.value.final;
    if (!final.ok) throw new Error(final.error);
    expect(final.value.results.map((r) => r.why_he)).toEqual(WHYS);
    expect(final.value.results.every((r) => r.search_uid === uid)).toBe(true);
    // The writes after the page are kept alive with after(), and the row carries the same uid.
    expect(m.after).toHaveBeenCalled();
    await afterJobs();
    expect(m.store.logs).toEqual([expect.objectContaining({ searchUid: uid, shared: false })]);
    expect(m.store.logs[0].timings.products_ms).toEqual(expect.any(Number));
  });

  it("lets a request that arrives while the search runs share its products and lines", async () => {
    let release!: () => void;
    m.gate = new Promise<void>((r) => (release = r));
    const first = await startSearchForRequest(Q, HEADERS);
    const second = await startSearchForRequest({ q: "  כבל usb " }, HEADERS);
    if (!first.ok || !second.ok) throw new Error("not started");
    const [a, b] = await Promise.all([first.value.products, second.value.products]);
    if (!a.ok || !b.ok) throw new Error("no products");
    expect(b.value.response.results.map((r) => r.product_id)).toEqual(
      a.value.response.results.map((r) => r.product_id),
    );
    const uidA = a.value.response.results[0].search_uid;
    const uidB = b.value.response.results[0].search_uid;
    expect(uidB).not.toBe(uidA);

    release();
    const [finalA, finalB] = await Promise.all([first.value.final, second.value.final]);
    expect(finalA.ok && finalB.ok).toBe(true);
    // One parse, one fetch, one explain and one titles call for both.
    expect(m.parseCalls).toBe(1);
    expect(m.explainCalls).toBe(1);
    expect(m.titlesCalls).toBe(1);
    await afterJobs();
    expect(m.store.logs.map((l) => [l.searchUid, l.shared])).toEqual(
      expect.arrayContaining([
        [uidA, false],
        [uidB, true],
      ]),
    );
    const joined = m.store.logs.find((l) => l.shared)!;
    expect(joined).toMatchObject({ query: "  כבל usb ".trim(), aliCalls: 0, cache: "results" });
    expect(joined.timings.products_ms).toEqual(expect.any(Number));
  });

  it("answers a failure after the chips as the failure of the products and of the lines", async () => {
    fetchMock.mockImplementation(async () => new Response("not json"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const started = await startSearchForRequest(Q, HEADERS);
      if (!started.ok) throw new Error(started.error);
      expect((await started.value.understood).ok).toBe(true);
      expect(await started.value.products).toEqual({ ok: false, error: "upstream" });
      expect(await started.value.final).toEqual({ ok: false, error: "upstream" });
      await afterJobs();
      expect(m.store.logs.map((l) => l.failure)).toEqual(["upstream"]);
    } finally {
      errors.mockRestore();
    }
  });

  it("refuses an empty query before any work", async () => {
    expect(await startSearchForRequest({ q: " " }, HEADERS)).toEqual({
      ok: false,
      error: "invalid_query",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("searchForRequest (the JSON API)", () => {
  it("waits for every line and tags the results with the request's uid", async () => {
    const result = await searchForRequest(Q, HEADERS);
    if (!result.ok) throw new Error(result.error);
    expect(result.response.results.map((r) => r.why_he)).toEqual(WHYS);
    const uid = result.response.results[0].search_uid;
    await afterJobs();
    expect(m.store.logs[0].searchUid).toBe(uid);
  });
});

describe("the admin's shop cap setting", () => {
  it("is read once per request and keys the results: a switch never serves the other mode's list", async () => {
    const none = await searchForRequest(Q, HEADERS);
    m.shopCapMode.mockResolvedValueOnce("max2");
    const max2 = await searchForRequest(Q, HEADERS);
    if (!none.ok || !max2.ok) throw new Error("search failed");
    // Another result set: fetched and explained again, the parse reused.
    expect(max2.response.filters_key).not.toBe(none.response.filters_key);
    expect(max2.response.cached).toBe(false);
    expect(m.parseCalls).toBe(1);
    expect(m.explainCalls).toBe(2);
    expect(m.titlesCalls).toBe(2);
    // Switched back: the list ranked under "none" is served from the cache again.
    const back = await searchForRequest(Q, HEADERS);
    if (!back.ok) throw new Error(back.error);
    expect(back.response).toMatchObject({ cached: true, filters_key: none.response.filters_key });
    expect(m.shopCapMode).toHaveBeenCalledTimes(3);
  });

  it("never lets a request join a run of the other mode", async () => {
    let release!: () => void;
    m.gate = new Promise<void>((r) => (release = r));
    const first = await startSearchForRequest(Q, HEADERS);
    m.shopCapMode.mockResolvedValueOnce("max2");
    const second = await startSearchForRequest(Q, HEADERS);
    if (!first.ok || !second.ok) throw new Error("not started");
    release();
    const [a, b] = await Promise.all([first.value.final, second.value.final]);
    if (!a.ok || !b.ok) throw new Error("search failed");
    expect(a.value.filters_key).not.toBe(b.value.filters_key);
    expect(m.explainCalls).toBe(2);
  });

  it("never lets a search limited to a category join the unrestricted run, or the other way", async () => {
    let release!: () => void;
    m.gate = new Promise<void>((r) => (release = r));
    const plain = await startSearchForRequest(Q, HEADERS);
    const scoped = await startSearchForRequest({ ...Q, category: "44" }, HEADERS);
    const scopedToo = await startSearchForRequest({ ...Q, category: "44" }, HEADERS);
    if (!plain.ok || !scoped.ok || !scopedToo.ok) throw new Error("not started");
    release();
    const [a, b, c] = await Promise.all([
      plain.value.final,
      scoped.value.final,
      scopedToo.value.final,
    ]);
    if (!a.ok || !b.ok || !c.ok) throw new Error("search failed");
    expect(a.value.filters_key).not.toBe(b.value.filters_key);
    // The second category request joined the first: one explain call each for two runs.
    expect(c.value.filters_key).toBe(b.value.filters_key);
    expect(m.explainCalls).toBe(2);
    const sentCategories = fetchMock.mock.calls
      .map(([, init]) => new URLSearchParams(String(init?.body)))
      .filter((p) => p.get("method") === "aliexpress.affiliate.product.query")
      .map((p) => p.get("category_ids"));
    expect(sentCategories).toContain("44");
    expect(sentCategories).toContain(null);
  });
});
