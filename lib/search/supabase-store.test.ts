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
    const matches = (r: Row) =>
      this.filters.every(([c, v]) => r[c] === v) &&
      this.inFilters.every(([c, vs]) => vs.includes(r[c]));
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
});
afterEach(() => errors.mockRestore());

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
  });

  it("logs a search without any IP or user data", async () => {
    const db = new FakeDb();
    const store = new SupabaseStore(db.client());
    await store.logSearch({ ...LOG, resultIds: ["1", "2"] });
    await store.logSearch({ ...LOG, source: "more", categoryId: null, listable: false });
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
      },
    ]);
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
        },
        {
          kind: "explain_more",
          model: "some-unknown-model",
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 2,
          cache_write_tokens: 1,
          cost_usd: null, // never a guessed price
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

  it("logs a click with product id and source only", async () => {
    const db = new FakeDb();
    await new SupabaseStore(db.client()).logClick("100500", "search");
    expect(db.rows("clicks")).toEqual([{ product_id: "100500", src: "search" }]);
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
