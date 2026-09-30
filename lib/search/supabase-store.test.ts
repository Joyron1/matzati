import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { parseProductPage, type AliProduct } from "@/lib/aliexpress/schemas";
import type { LlmUsageRecord } from "@/lib/stats/usage";
import type { ParsedQuery } from "./filters";
import type { CachedResults, SearchLogEntry } from "./store";
import { SupabaseStore } from "./supabase-store";

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "upsert" | "update";

const PRIMARY_KEY: Record<string, string> = {
  parse_cache: "query_key",
  search_cache: "filters_key",
  products: "product_id",
};
const DEFAULTS: Record<string, Row> = {
  parse_cache: { hits: 0 },
  search_cache: { hits: 0 },
  products: { title_he: null },
};

/**
 * Just enough of the PostgREST query builder for SupabaseStore: from().select().eq().maybeSingle(),
 * insert(), upsert(rows, { onConflict }) and update().eq(), with upsert overwriting only the
 * columns present in the payload (as PostgREST does).
 */
class FakeDb {
  tables = new Map<string, Row[]>();
  calls: { table: string; op: Op; payload?: unknown; options?: unknown }[] = [];
  /** "table:op" pairs that answer with an error; "throw" makes from() throw instead. */
  failing = new Set<string>();

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  from(table: string) {
    if (this.failing.has("throw")) throw new TypeError("fetch failed");
    return new FakeQuery(this, table);
  }

  client() {
    return this as unknown as SupabaseClient;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private op: Op = "select";
  private payload: unknown;
  private options: unknown;
  private filters: [string, unknown][] = [];
  private inFilters: [string, unknown[]][] = [];
  private single = false;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select() {
    return this;
  }
  insert(payload: unknown) {
    return this.set("insert", payload);
  }
  upsert(payload: unknown, options?: unknown) {
    this.options = options;
    return this.set("upsert", payload);
  }
  update(payload: unknown) {
    return this.set("update", payload);
  }
  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.inFilters.push([column, values]);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  private set(op: Op, payload: unknown) {
    this.op = op;
    this.payload = payload;
    return this;
  }

  private run() {
    const { db, table, op } = this;
    db.calls.push({ table, op, payload: this.payload, options: this.options });
    if (db.failing.has(`${table}:${op}`)) return { data: null, error: { message: `${op} denied` } };
    const rows = db.rows(table);
    // "column" or a JSON field as text ("response->>createdAt"), as PostgREST filters them.
    const value = (r: Row, c: string) => {
      const [column, field] = c.split("->>");
      if (field === undefined) return r[column];
      const json = r[column] as Row | null | undefined;
      const v = json?.[field];
      return v === undefined || v === null ? null : String(v);
    };
    const matches = (r: Row) =>
      this.filters.every(([c, v]) => value(r, c) === v) &&
      this.inFilters.every(([c, vs]) => vs.includes(value(r, c)));
    const payload = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
    if (op === "select") {
      const found = rows.filter(matches).map((r) => structuredClone(r));
      return { data: this.single ? (found[0] ?? null) : found, error: null };
    }
    if (op === "update") {
      rows.filter(matches).forEach((r) => Object.assign(r, structuredClone(this.payload as Row)));
    } else {
      const pk = PRIMARY_KEY[table];
      const ignoreDuplicates = (this.options as { ignoreDuplicates?: boolean } | undefined)
        ?.ignoreDuplicates;
      for (const p of payload) {
        const copy = structuredClone(p);
        const existing = op === "upsert" ? rows.find((r) => r[pk] === p[pk]) : undefined;
        if (existing && !ignoreDuplicates) Object.assign(existing, copy);
        else if (!existing) rows.push({ ...DEFAULTS[table], ...copy });
      }
    }
    return { data: null, error: null };
  }

  then<A = { data: unknown; error: { message: string } | null }, B = never>(
    onfulfilled?:
      ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }
}

const PRODUCTS: AliProduct[] = parseProductPage(
  JSON.parse(readFileSync("fixtures/aliexpress/aliexpress.affiliate.product.query.json", "utf8"))
    .aliexpress_affiliate_product_query_response?.resp_result?.result,
).products;

const PARSED: ParsedQuery = {
  keywords_en: "usb cable",
  product_terms: ["cable"],
  product_he: "כבל USB",
  requirements: [],
  max_price_ils: 40,
  sort_preference: "best_value",
};

function results(createdAt: string, products = PRODUCTS.slice(0, 4)): CachedResults {
  return {
    filters: PARSED,
    checked: 50,
    passed: products.length,
    products,
    explanations: {
      [products[0].productId]: { title_he: "כבל טעינה", why_he: "נבחר לפי הנתונים." },
    },
    createdAt,
  };
}

const LOG: SearchLogEntry = {
  query: "כבל USB",
  queryNorm: "כבל usb",
  parsed: PARSED,
  resultIds: [],
  cache: "results",
  resultsCount: 3,
  source: "search",
  categoryId: "44",
  listable: true,
  origin: "typed",
  without: [],
  sortOverride: null,
  timings: { parse_ms: null, fetch_ms: null, explain_ms: null, total_ms: 42 },
  aliCalls: 0,
  rejected: null,
  failure: null,
  searchUid: "0b7e6f55-2f0c-4a53-9d7c-3f7c1d1e2a10",
  shared: false,
};

const USAGE: LlmUsageRecord = {
  kind: "parse",
  model: "claude-haiku-4-5",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
};

const flush = () => new Promise((r) => setTimeout(r, 0));

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  // A store built without an env reads VERCEL_ENV (deployEnv): most tests are about production.
  vi.stubEnv("VERCEL_ENV", "production");
});
afterEach(() => {
  errors.mockRestore();
  vi.unstubAllEnvs();
});

describe("SupabaseStore", () => {
  it("has real products from the fixture", () => {
    expect(PRODUCTS.length).toBeGreaterThan(4);
  });

  describe("parse cache", () => {
    it("round-trips a parse and counts hits", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client());
      await store.putParse("qk", "כבל usb עד ₪40", PARSED);
      expect(await store.getParse("qk", new Date())).toEqual(PARSED);
      await flush();
      expect(db.rows("parse_cache")[0]).toMatchObject({ query_norm: "כבל usb עד ₪40", hits: 1 });
      expect(await store.getParse("other", new Date())).toBeNull();
    });

    it("treats entries 14 days old as a miss and refreshes them on write", async () => {
      const db = new FakeDb();
      db.rows("parse_cache").push({
        query_key: "qk",
        query_norm: "old",
        parsed: PARSED,
        hits: 7,
        created_at: "2026-09-13T10:00:00.000Z",
      });
      const store = new SupabaseStore(db.client());
      expect(await store.getParse("qk", new Date("2026-09-27T09:59:00Z"))).toEqual(PARSED);
      const now = new Date("2026-09-27T10:00:00Z");
      expect(await store.getParse("qk", now)).toBeNull();
      await store.putParse("qk", "new", PARSED);
      expect(db.rows("parse_cache")).toHaveLength(1);
      expect(await store.getParse("qk", new Date())).toEqual(PARSED);
      expect(db.calls.find((c) => c.op === "upsert")?.options).toEqual({ onConflict: "query_key" });
    });

    it("treats a malformed parse as a miss", async () => {
      const db = new FakeDb();
      db.rows("parse_cache").push({
        query_key: "bad",
        query_norm: "x",
        parsed: { keywords_en: "usb cable", sort_preference: "best_value" },
        hits: 0,
        created_at: new Date().toISOString(),
      });
      expect(await new SupabaseStore(db.client()).getParse("bad", new Date())).toBeNull();
    });
  });

  describe("results cache", () => {
    it("round-trips results, stores the filters and counts hits", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client());
      const r = results(new Date().toISOString());
      await store.putResults("fk", "כבל usb עד 40", r);
      expect(db.rows("search_cache")[0]).toMatchObject({
        filters_key: "fk",
        query: "כבל usb עד 40",
        parsed: PARSED,
        created_at: r.createdAt,
      });
      expect(await store.getResults("fk", new Date())).toEqual(r);
      await flush();
      expect(db.rows("search_cache")[0].hits).toBe(1);
    });

    it("misses when stale or malformed", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client());
      await store.putResults("week", "q", results("2026-09-20T10:00:00.000Z"));
      expect(await store.getResults("week", new Date("2026-09-27T10:00:00Z"))).not.toBeNull();
      await store.putResults("old", "q", results("2026-09-13T10:00:00.000Z"));
      expect(await store.getResults("old", new Date("2026-09-27T10:00:00Z"))).toBeNull();
      // Nothing passed: reused for 48h only.
      const empty = (at: string) => ({ ...results(at), products: [], passed: 0, explanations: {} });
      await store.putResults("empty-day", "q", empty("2026-09-26T10:00:00.000Z"));
      expect(await store.getResults("empty-day", new Date("2026-09-27T10:00:00Z"))).not.toBeNull();
      await store.putResults("empty-3d", "q", empty("2026-09-24T10:00:00.000Z"));
      expect(await store.getResults("empty-3d", new Date("2026-09-27T10:00:00Z"))).toBeNull();
      // English titles and lines from the data after a failed explain call: an hour only.
      const degraded = (at: string) => ({ ...results(at), degraded: true });
      await store.putResults("degraded-now", "q", degraded("2026-09-27T09:30:00.000Z"));
      expect(
        await store.getResults("degraded-now", new Date("2026-09-27T10:00:00Z")),
      ).not.toBeNull();
      await store.putResults("degraded-2h", "q", degraded("2026-09-27T08:00:00.000Z"));
      expect(await store.getResults("degraded-2h", new Date("2026-09-27T10:00:00Z"))).toBeNull();
      db.rows("search_cache").push({
        filters_key: "bad",
        response: { nope: true },
        created_at: new Date().toISOString(),
        hits: 0,
      });
      expect(await store.getResults("bad", new Date())).toBeNull();
      // The shown counts ("בדקנו X מוצרים. Y עברו") must come from the row, never be undefined.
      const noCounts: Partial<CachedResults> = results(new Date().toISOString());
      delete noCounts.checked;
      db.rows("search_cache").push({
        filters_key: "no-counts",
        response: noCounts,
        created_at: new Date().toISOString(),
        hits: 0,
      });
      expect(await store.getResults("no-counts", new Date())).toBeNull();
    });

    it("updateResults replaces the response only, keeping the first query", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client());
      const r = results(new Date().toISOString());
      await store.putResults("fk", "first query", r);
      const more = {
        ...r,
        explanations: {
          ...r.explanations,
          [PRODUCTS[3].productId]: { title_he: null, why_he: "x" },
        },
      };
      await store.updateResults("fk", more);
      const update = db.calls.find((c) => c.op === "update");
      expect(update?.payload).toEqual({ response: more });
      expect(db.rows("search_cache")[0]).toMatchObject({ query: "first query", response: more });
    });

    it("updateResults never writes an entry back over a newer fetch of the same filters", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client());
      const old = results("2026-09-20T10:00:00.000Z");
      await store.putResults("fk", "q", old);
      // Read by a request, then fetched again by another before the first adds its lines.
      const refetched = results("2026-09-28T10:00:00.000Z");
      await store.putResults("fk", "q", refetched);
      await store.updateResults("fk", {
        ...old,
        explanations: { [PRODUCTS[3].productId]: { title_he: null, why_he: "x" } },
      });
      expect(db.rows("search_cache")).toEqual([
        expect.objectContaining({ response: refetched, created_at: refetched.createdAt }),
      ]);
    });
  });

  describe("reads that only look (/p's similar products)", () => {
    it("peekParse and peekResults find what getParse and getResults find, and write nothing", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client());
      const r = results(new Date().toISOString());
      await store.putParse("qk", "כבל usb", PARSED);
      await store.putResults("fk", "q", r);
      const writes = db.calls.length;
      expect(await store.peekParse("qk", new Date())).toEqual(PARSED);
      expect(await store.peekResults("fk", new Date())).toEqual(r);
      expect(await store.peekParse("other", new Date())).toBeNull();
      expect(await store.peekResults("other", new Date())).toBeNull();
      await flush();
      expect(db.calls.slice(writes).every((c) => c.op === "select")).toBe(true);
      expect(db.rows("parse_cache")[0].hits).toBe(0);
      expect(db.rows("search_cache")[0].hits).toBe(0);
    });

    it("peekResults misses a stale entry like getResults", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client());
      await store.putResults("old", "q", results("2026-09-01T10:00:00.000Z"));
      expect(await store.peekResults("old", new Date("2026-09-27T10:00:00Z"))).toBeNull();
    });

    it("outside production reads its own key, then production's, and writes to neither", async () => {
      const db = new FakeDb();
      await new SupabaseStore(db.client(), { env: "production" }).putParse("qk", "q", PARSED);
      const dev = new SupabaseStore(db.client(), { env: "development" });
      const writes = db.calls.length;
      expect(await dev.peekParse("qk", new Date())).toEqual(PARSED);
      await flush();
      expect(db.calls.slice(writes).map((c) => c.op)).toEqual(["select", "select"]);
    });

    it("storedTitles names the products that have a row, with our Hebrew title or null", async () => {
      const db = new FakeDb();
      db.rows("products").push(
        { product_id: "1", title_he: "כבל טעינה" },
        { product_id: "2", title_he: null },
        { product_id: "3", title_he: "  " },
      );
      const store = new SupabaseStore(db.client());
      const stored = await store.storedTitles(["1", "2", "3", "4", "1"]);
      expect(stored).toEqual(
        new Map<string, string | null>([
          ["1", "כבל טעינה"],
          ["2", null],
          ["3", null],
        ]),
      );
      expect(await store.storedTitles([])).toEqual(new Map());
      db.failing.add("products:select");
      expect(await store.storedTitles(["1"])).toBeNull();
      expect(db.calls.every((c) => c.op === "select")).toBe(true);
    });
  });

  it("logs a search without any IP or user data", async () => {
    const db = new FakeDb();
    const store = new SupabaseStore(db.client());
    await store.logSearch({ ...LOG, resultIds: ["1", "2"] });
    await store.logSearch({ ...LOG, source: "more", categoryId: null, listable: false });
    const telemetry = {
      env: "production",
      origin: "typed",
      without: [],
      sort_override: null,
      timings: { parse_ms: null, fetch_ms: null, explain_ms: null, total_ms: 42 },
      ali_calls: 0,
      rejected: null,
      failure: null,
      search_uid: "0b7e6f55-2f0c-4a53-9d7c-3f7c1d1e2a10",
      shared: false,
      owner: false,
      diag: null,
    };
    expect(db.rows("search_log")).toEqual([
      {
        query: "כבל USB",
        query_norm: "כבל usb",
        parsed: PARSED,
        result_ids: ["1", "2"],
        cache: "results",
        results_count: 3,
        source: "search",
        category_id: "44",
        listable: true,
        ...telemetry,
      },
      {
        query: "כבל USB",
        query_norm: "כבל usb",
        parsed: PARSED,
        result_ids: [],
        cache: "results",
        results_count: 3,
        source: "more",
        category_id: null,
        listable: false,
        ...telemetry,
      },
    ]);
  });

  it("logs the new telemetry columns of a failed, refined request as given", async () => {
    const db = new FakeDb();
    const rejected = { feedback: 3, volume: 10, currency: 0, price: 0, type: 20, requirement: 17 };
    await new SupabaseStore(db.client(), { env: "preview" }).logSearch({
      ...LOG,
      parsed: null,
      resultsCount: 0,
      categoryId: null,
      listable: false,
      origin: "chip",
      without: ["max"],
      sortOverride: "cheapest",
      timings: { parse_ms: null, fetch_ms: 2310, explain_ms: null, total_ms: 2400 },
      aliCalls: 2,
      rejected,
      failure: "upstream",
      shared: true,
      owner: true,
      diag: {
        fetch_stop: "failed",
        keywords_tried: ["usb cable", "usb cable (p2)"],
        demoted: [],
        explain_failed: false,
        explain_rejected: 0,
      },
    });
    expect(db.rows("search_log")[0]).toMatchObject({
      env: "preview",
      parsed: null,
      results_count: 0,
      origin: "chip",
      without: ["max"],
      sort_override: "cheapest",
      timings: { parse_ms: null, fetch_ms: 2310, explain_ms: null, total_ms: 2400 },
      ali_calls: 2,
      rejected,
      failure: "upstream",
      shared: true,
      owner: true,
      diag: { fetch_stop: "failed", keywords_tried: ["usb cable", "usb cable (p2)"] },
    });
  });

  describe("llm usage", () => {
    it("writes one row per call with tokens and cost, in a single insert", async () => {
      const db = new FakeDb();
      await new SupabaseStore(db.client()).logUsage([
        {
          kind: "parse",
          model: "claude-haiku-4-5-20251001",
          usage: { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
        {
          kind: "explain_more",
          model: "some-unknown-model",
          usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 },
        },
      ]);
      expect(db.calls.filter((c) => c.table === "llm_usage")).toHaveLength(1);
      expect(db.rows("llm_usage")).toEqual([
        {
          kind: "parse",
          model: "claude-haiku-4-5-20251001",
          input_tokens: 900,
          output_tokens: 100,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          cost_usd: 0.0014, // (900 * $1 + 100 * $5) per million tokens
          env: "production",
        },
        {
          kind: "explain_more",
          model: "some-unknown-model",
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 2,
          cache_write_tokens: 1,
          cost_usd: null, // never a guessed price
          env: "production",
        },
      ]);
    });

    it("does nothing for an empty list", async () => {
      const db = new FakeDb();
      await new SupabaseStore(db.client()).logUsage([]);
      expect(db.calls).toHaveLength(0);
    });
  });

  describe("products", () => {
    it("upserts products with price history, and a later null title keeps the saved one", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client());
      const [a, b] = PRODUCTS;
      await store.saveProducts([a, b, a], { [a.productId]: "כבל טעינה מהיר", [b.productId]: null });
      expect(db.rows("products")).toHaveLength(2);
      await store.saveProducts([a], { [a.productId]: null });

      const saved = await store.getProduct(a.productId);
      expect(saved).toMatchObject({ product: a, titleHe: "כבל טעינה מהיר" });
      expect(Date.parse(saved!.updatedAt)).not.toBeNaN();
      expect((await store.getProduct(b.productId))?.titleHe).toBeNull();
      expect(await store.getProduct("missing")).toBeNull();

      // The null-title upsert never carries a title_he column.
      const upserts = db.calls.filter((c) => c.table === "products" && c.op === "upsert");
      const untitled = upserts
        .map((c) => c.payload as Row[])
        .filter((rows) => !("title_he" in rows[0]));
      expect(untitled).toHaveLength(2);
      expect(upserts.every((c) => (c.options as Row).onConflict === "product_id")).toBe(true);

      const history = db.rows("price_history");
      expect(history).toHaveLength(3);
      expect(history[history.length - 1]).toMatchObject({
        product_id: a.productId,
        price_ils: a.price,
        price_usd: null,
      });
    });

    it("records a USD price only as price_usd", async () => {
      const db = new FakeDb();
      const usd = { ...PRODUCTS[0], currency: "USD", price: 4.2 };
      await new SupabaseStore(db.client()).saveProducts([usd], {});
      expect(db.rows("price_history")[0]).toMatchObject({ price_ils: null, price_usd: 4.2 });
    });

    it("skips price history when the product upsert failed", async () => {
      const db = new FakeDb();
      db.failing.add("products:upsert");
      await new SupabaseStore(db.client()).saveProducts(PRODUCTS.slice(0, 2), {});
      expect(db.rows("price_history")).toHaveLength(0);
      expect(errors).toHaveBeenCalled();
    });

    it("does nothing for an empty list", async () => {
      const db = new FakeDb();
      await new SupabaseStore(db.client()).saveProducts([], {});
      expect(db.calls).toHaveLength(0);
    });

    describe("from a cached result set (checkedAt)", () => {
      const checkedAt = new Date(Date.now() - 5 * 86_400_000);
      const [a, b] = PRODUCTS;
      const storedRow = (p: AliProduct, updatedAt: Date) => ({
        product_id: p.productId,
        data: { ...p, price: 1 },
        title_he: null,
        updated_at: updatedAt.toISOString(),
      });

      it("stamps the rows and their price history with the time the data was checked", async () => {
        const db = new FakeDb();
        const store = new SupabaseStore(db.client());
        await store.saveProducts([a], { [a.productId]: "כבל" }, checkedAt);
        expect(await store.getProduct(a.productId)).toEqual({
          product: a,
          titleHe: "כבל",
          updatedAt: checkedAt.toISOString(),
        });
        expect(db.rows("price_history")).toEqual([
          expect.objectContaining({
            product_id: a.productId,
            captured_at: checkedAt.toISOString(),
          }),
        ]);
      });

      it("keeps a row stored with newer data and writes only its Hebrew title", async () => {
        const db = new FakeDb();
        const store = new SupabaseStore(db.client());
        const refreshed = new Date();
        db.rows("products").push(storedRow(b, refreshed), storedRow(a, new Date(0)));
        await store.saveProducts(
          [a, b],
          { [a.productId]: "כבל", [b.productId]: "מטען" },
          checkedAt,
        );
        // b was refreshed after the cache was made (a /p visit): its data and time stay.
        expect(await store.getProduct(b.productId)).toEqual({
          product: { ...b, price: 1 },
          titleHe: "מטען",
          updatedAt: refreshed.toISOString(),
        });
        // a was older than the cache: replaced, with the cache's time.
        expect(await store.getProduct(a.productId)).toMatchObject({
          product: a,
          updatedAt: checkedAt.toISOString(),
        });
        expect(db.rows("price_history").map((h) => h.product_id)).toEqual([a.productId]);
      });

      it("saves every product with the older time when the stored rows cannot be read", async () => {
        const db = new FakeDb();
        db.failing.add("products:select");
        db.rows("products").push(storedRow(b, new Date()));
        await new SupabaseStore(db.client()).saveProducts([b], {}, checkedAt);
        expect(db.rows("products")[0]).toMatchObject({
          data: b,
          updated_at: checkedAt.toISOString(),
        });
      });
    });

    describe("from a hot list (keepTitledRows)", () => {
      const fetchedAt = new Date(Date.now() - 60_000);
      const [a, b, c] = PRODUCTS;
      // A hot list's data: AliExpress's Hebrew title (lib/hot/loader.ts).
      const hot = (p: AliProduct): AliProduct => ({
        ...p,
        title: `כותרת ${p.productId}`,
        source: "hot",
      });
      const searchedAt = new Date(Date.now() - 5 * 86_400_000).toISOString();

      it("leaves a row a search titled untouched, and saves the others", async () => {
        const db = new FakeDb();
        db.rows("products").push(
          { product_id: a.productId, data: a, title_he: "כבל טעינה", updated_at: searchedAt },
          { product_id: b.productId, data: b, title_he: null, updated_at: searchedAt },
        );
        const store = new SupabaseStore(db.client());
        await store.saveProducts([hot(a), hot(b), hot(c)], {}, fetchedAt, { keepTitledRows: true });
        // a: our title over English data, as the search saved it.
        expect(await store.getProduct(a.productId)).toEqual({
          product: a,
          titleHe: "כבל טעינה",
          updatedAt: searchedAt,
        });
        // b (untitled, older) and c (new) take the hot list's data and time.
        for (const p of [b, c]) {
          expect(await store.getProduct(p.productId)).toEqual({
            product: hot(p),
            titleHe: null,
            updatedAt: fetchedAt.toISOString(),
          });
        }
        expect(db.rows("price_history").map((h) => h.product_id)).toEqual([
          b.productId,
          c.productId,
        ]);
      });

      it("stores a hot link's type and time in data, and a later list's own link clears them", async () => {
        const db = new FakeDb();
        const store = new SupabaseStore(db.client());
        const linked: AliProduct = {
          ...hot(a),
          promotionLink: "https://s.click.aliexpress.com/e/_hot",
          promotionLinkType: 2,
          promotionLinkAt: fetchedAt.toISOString(),
          hotCommissionRatePct: 9,
        };
        await store.saveProducts([linked], {}, fetchedAt, { keepTitledRows: true });
        expect((await store.getProduct(a.productId))?.product).toEqual(linked);
        // The next list (its hot links call failed): the row takes that list's link, no type.
        const later = new Date(fetchedAt.getTime() + 12 * 3_600_000);
        await store.saveProducts([hot(a)], {}, later, { keepTitledRows: true });
        const row = await store.getProduct(a.productId);
        expect(row?.product).toEqual(hot(a));
        expect(row?.product.promotionLinkType).toBeUndefined();
      });

      it("writes only new rows when the stored rows cannot be read", async () => {
        const db = new FakeDb();
        db.rows("products").push({
          product_id: a.productId,
          data: a,
          title_he: "כבל טעינה",
          updated_at: searchedAt,
        });
        db.failing.add("products:select");
        await new SupabaseStore(db.client()).saveProducts([hot(a), hot(b)], {}, fetchedAt, {
          keepTitledRows: true,
        });
        expect(db.rows("products")).toEqual([
          { product_id: a.productId, data: a, title_he: "כבל טעינה", updated_at: searchedAt },
          {
            product_id: b.productId,
            data: hot(b),
            title_he: null,
            updated_at: fetchedAt.toISOString(),
          },
        ]);
      });
    });
  });

  it("logs a click with product id, source, env and the result card it came from", async () => {
    const db = new FakeDb();
    const store = new SupabaseStore(db.client());
    await store.logClick("100500", "product");
    await store.logClick(
      "100500",
      "search_featured",
      { searchUid: "0b7e6f55-2f0c-4a53-9d7c-3f7c1d1e2a10", position: 1 },
      true,
    );
    expect(db.rows("clicks")).toEqual([
      {
        product_id: "100500",
        src: "product",
        env: "production",
        search_uid: null,
        position: null,
        owner: false,
      },
      {
        product_id: "100500",
        src: "search_featured",
        env: "production",
        search_uid: "0b7e6f55-2f0c-4a53-9d7c-3f7c1d1e2a10",
        position: 1,
        owner: true,
      },
    ]);
  });

  it("outside production adds only products production does not have, and no price history", async () => {
    // The finding on dev writes: a dev explain prompt must never change the title /p serves.
    const db = new FakeDb();
    const [a, b] = PRODUCTS;
    db.rows("products").push({
      product_id: a.productId,
      data: a,
      title_he: "שם של האתר החי",
      updated_at: "2026-09-20T00:00:00.000Z",
    });
    const dev = new SupabaseStore(db.client(), { env: "development" });
    await dev.saveProducts([{ ...a, price: 1 }, b], {
      [a.productId]: "שם מסביבת פיתוח",
      [b.productId]: "כבל חדש",
    });
    const rows = db.rows("products");
    expect(rows.find((r) => r.product_id === a.productId)).toMatchObject({
      title_he: "שם של האתר החי",
      data: a,
      updated_at: "2026-09-20T00:00:00.000Z",
    });
    expect(rows.find((r) => r.product_id === b.productId)).toMatchObject({ title_he: "כבל חדש" });
    expect(db.rows("price_history")).toEqual([]);
  });

  it("outside production writes a title saved after the row only into a row it inserted", async () => {
    // A streamed search saves its cards' rows first and their Hebrew titles once written.
    const db = new FakeDb();
    const [a, b] = PRODUCTS;
    db.rows("products").push({
      product_id: a.productId,
      data: a,
      title_he: null,
      updated_at: "2026-09-20T00:00:00.000Z",
    });
    const dev = new SupabaseStore(db.client(), { env: "development" });
    const at = new Date("2026-09-28T10:00:00.000Z");
    await dev.saveProducts([a, b], {}, at);
    await dev.saveProducts([a, b], { [a.productId]: "שם מסביבת פיתוח", [b.productId]: "כבל" }, at);
    const rows = db.rows("products");
    // Production's row keeps its (missing) title; the row dev inserted gets its own.
    expect(rows.find((r) => r.product_id === a.productId)).toMatchObject({ title_he: null });
    expect(rows.find((r) => r.product_id === b.productId)).toMatchObject({
      title_he: "כבל",
      updated_at: at.toISOString(),
    });
    expect(db.calls.filter((c) => c.op === "upsert")).toHaveLength(1);
  });

  describe("environments (one database for production, preview and dev)", () => {
    const fresh = () => new Date().toISOString();

    it("reads its env from VERCEL_ENV, and anything else is development", () => {
      const db = new FakeDb();
      expect(new SupabaseStore(db.client()).env).toBe("production");
      vi.stubEnv("VERCEL_ENV", "preview");
      expect(new SupabaseStore(db.client()).env).toBe("preview");
      vi.stubEnv("VERCEL_ENV", "");
      expect(new SupabaseStore(db.client()).env).toBe("development");
      vi.stubEnv("VERCEL_ENV", "staging");
      expect(new SupabaseStore(db.client()).env).toBe("development");
    });

    it("tags every search_log, llm_usage and clicks row with the env", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client(), { env: "development" });
      await store.logSearch(LOG);
      await store.logUsage([USAGE]);
      await store.logClick("1", "search");
      for (const table of ["search_log", "llm_usage", "clicks"]) {
        expect(db.rows(table)[0].env).toBe("development");
      }
    });

    it("keeps production keys bare, so a deploy starts with the cache production wrote", async () => {
      const db = new FakeDb();
      const store = new SupabaseStore(db.client(), { env: "production" });
      await store.putParse("qk", "q", PARSED);
      await store.putResults("fk", "q", results(fresh()));
      expect(db.rows("parse_cache")[0].query_key).toBe("qk");
      expect(db.rows("search_cache")[0].filters_key).toBe("fk");
    });

    it("writes dev and preview entries under their own keys, which production never reads", async () => {
      const db = new FakeDb();
      const dev = new SupabaseStore(db.client(), { env: "development" });
      const preview = new SupabaseStore(db.client(), { env: "preview" });
      await dev.putParse("qk", "q", PARSED);
      await dev.putResults("fk", "q", results(fresh()));
      await preview.putParse("qk", "q", PARSED);
      expect(db.rows("parse_cache").map((r) => r.query_key)).toEqual(["dev:qk", "preview:qk"]);
      expect(db.rows("search_cache").map((r) => r.filters_key)).toEqual(["dev:fk"]);
      // Dev reads its own entries back.
      expect(await dev.getParse("qk", new Date())).toEqual(PARSED);
      expect(await dev.getResults("fk", new Date())).not.toBeNull();
      // Production never sees them.
      const prod = new SupabaseStore(db.client(), { env: "production" });
      expect(await prod.getParse("qk", new Date())).toBeNull();
      expect(await prod.getResults("fk", new Date())).toBeNull();
    });

    it("lets dev read production entries without writing to them or counting their hits", async () => {
      const db = new FakeDb();
      const prod = new SupabaseStore(db.client(), { env: "production" });
      const r = results(fresh());
      await prod.putParse("qk", "q", PARSED);
      await prod.putResults("fk", "the first query", r);
      const dev = new SupabaseStore(db.client(), { env: "development" });
      expect(await dev.getParse("qk", new Date())).toEqual(PARSED);
      expect(await dev.getResults("fk", new Date())).toEqual(r);
      await flush();
      expect(db.rows("parse_cache")).toEqual([
        expect.objectContaining({ query_key: "qk", hits: 0 }),
      ]);
      expect(db.rows("search_cache")).toEqual([
        expect.objectContaining({ filters_key: "fk", hits: 0 }),
      ]);
      // Its own fresh entry wins over production's, which stays as it was.
      const mine = { ...PARSED, keywords_en: "usb c cable" };
      await dev.putParse("qk", "q", mine);
      expect(await dev.getParse("qk", new Date())).toEqual(mine);
      expect(await prod.getParse("qk", new Date())).toEqual(PARSED);
    });

    it("copies explanations added to a production entry into its own key", async () => {
      const db = new FakeDb();
      const prod = new SupabaseStore(db.client(), { env: "production" });
      const r = results(fresh());
      await prod.putResults("fk", "the first query", r);
      const dev = new SupabaseStore(db.client(), { env: "development" });
      const read = (await dev.getResults("fk", new Date()))!;
      const more: CachedResults = {
        ...read,
        explanations: {
          ...read.explanations,
          [PRODUCTS[3].productId]: { title_he: null, why_he: "x" },
        },
      };
      await dev.updateResults("fk", more);
      expect(db.rows("search_cache")).toEqual([
        expect.objectContaining({ filters_key: "fk", response: r }),
        expect.objectContaining({
          filters_key: "dev:fk",
          query: "the first query",
          response: more,
          created_at: r.createdAt,
        }),
      ]);
      // From then on it updates its own row only.
      const again = { ...more, explanations: {} };
      await dev.updateResults("fk", again);
      expect(db.rows("search_cache").map((row) => row.response)).toEqual([r, again]);
    });
  });

  describe("failures never break a search", () => {
    it("reads become cache misses on an error response", async () => {
      const db = new FakeDb();
      ["parse_cache:select", "search_cache:select", "products:select"].forEach((f) =>
        db.failing.add(f),
      );
      const store = new SupabaseStore(db.client());
      expect(await store.getParse("qk", new Date())).toBeNull();
      expect(await store.getResults("fk", new Date())).toBeNull();
      expect(await store.getProduct("1")).toBeNull();
      expect(errors).toHaveBeenCalledTimes(3);
    });

    it("reads and writes survive a thrown network error", async () => {
      const db = new FakeDb();
      db.failing.add("throw");
      const store = new SupabaseStore(db.client());
      const r = results(new Date().toISOString());
      expect(await store.getParse("qk", new Date())).toBeNull();
      expect(await store.getResults("fk", new Date())).toBeNull();
      await expect(
        Promise.all([
          store.putParse("qk", "q", PARSED),
          store.putResults("fk", "q", r),
          store.updateResults("fk", r),
          store.logSearch(LOG),
          store.logUsage([USAGE]),
          store.saveProducts(PRODUCTS.slice(0, 2), {}),
          store.logClick("1", "search"),
        ]),
      ).resolves.toBeDefined();
      expect(errors.mock.calls.every(([m]) => /^\[supabase-store\] \w/.test(String(m)))).toBe(true);
    });

    it("write errors are logged, not thrown", async () => {
      const db = new FakeDb();
      [
        "parse_cache:upsert",
        "search_cache:upsert",
        "search_log:insert",
        "llm_usage:insert",
        "clicks:insert",
      ].forEach((f) => db.failing.add(f));
      const store = new SupabaseStore(db.client());
      await store.putParse("qk", "q", PARSED);
      await store.putResults("fk", "q", results(new Date().toISOString()));
      await store.logSearch(LOG);
      await store.logUsage([USAGE]);
      await store.logClick("1", "search");
      expect(errors).toHaveBeenCalledTimes(5);
    });
  });
});
