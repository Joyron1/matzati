import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { parseProductPage, type AliProduct } from "@/lib/aliexpress/schemas";
import type { ParsedQuery } from "./filters";
import type { CachedResults } from "./store";
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
    const matches = (r: Row) => this.filters.every(([c, v]) => r[c] === v);
    const payload = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
    if (op === "select") {
      const found = rows.filter(matches).map((r) => structuredClone(r));
      return { data: this.single ? (found[0] ?? null) : found, error: null };
    }
    if (op === "update") {
      rows.filter(matches).forEach((r) => Object.assign(r, structuredClone(this.payload as Row)));
    } else {
      const pk = PRIMARY_KEY[table];
      for (const p of payload) {
        const copy = structuredClone(p);
        const existing = op === "upsert" ? rows.find((r) => r[pk] === p[pk]) : undefined;
        if (existing) Object.assign(existing, copy);
        else rows.push({ ...DEFAULTS[table], ...copy });
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

    it("treats entries older than 48h as a miss and refreshes them on write", async () => {
      const db = new FakeDb();
      db.rows("parse_cache").push({
        query_key: "qk",
        query_norm: "old",
        parsed: PARSED,
        hits: 7,
        created_at: "2026-09-20T10:00:00.000Z",
      });
      const store = new SupabaseStore(db.client());
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
      await store.putResults("old", "q", results("2026-09-20T10:00:00.000Z"));
      expect(await store.getResults("old", new Date("2026-09-27T10:00:00Z"))).toBeNull();
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
    await new SupabaseStore(db.client()).logSearch({
      query: "כבל",
      parsed: PARSED,
      resultIds: ["1", "2"],
    });
    expect(db.rows("search_log")).toEqual([
      { query: "כבל", parsed: PARSED, result_ids: ["1", "2"] },
    ]);
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
          store.logSearch({ query: "q", parsed: PARSED, resultIds: [] }),
          store.saveProducts(PRODUCTS.slice(0, 2), {}),
          store.logClick("1", "search"),
        ]),
      ).resolves.toBeDefined();
      expect(errors.mock.calls.every(([m]) => /^\[supabase-store\] \w/.test(String(m)))).toBe(true);
    });

    it("write errors are logged, not thrown", async () => {
      const db = new FakeDb();
      ["parse_cache:upsert", "search_cache:upsert", "search_log:insert", "clicks:insert"].forEach(
        (f) => db.failing.add(f),
      );
      const store = new SupabaseStore(db.client());
      await store.putParse("qk", "q", PARSED);
      await store.putResults("fk", "q", results(new Date().toISOString()));
      await store.logSearch({ query: "q", parsed: PARSED, resultIds: [] });
      await store.logClick("1", "search");
      expect(errors).toHaveBeenCalledTimes(4);
    });
  });
});
