// SearchStore backed by the Supabase tables in supabase/migrations (service-role client).
// A store problem must never fail a user's search: reads that fail are cache misses (null) and
// writes that fail are logged and skipped.
//
// Dev and production share one database (owner decision 2026-09-28), so every search_log,
// llm_usage and clicks row carries the env it came from (deployEnv in lib/env.ts), and outside
// production the two caches live under their own keys: a dev run can never write a parse or a
// result set that production then serves. Production keys are the bare hashes, as before.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { deployEnv, type DeployEnv } from "@/lib/env";
import { withoutSharedMark } from "@/lib/ranking/shared-numbers";
import type { ClickRef } from "@/lib/search-url";
import { usageRow, type LlmUsageRecord } from "@/lib/stats/usage";
import { isFresh, isFreshResults } from "./cache-key";
import type { ParsedQuery } from "./filters";
import type { CachedResults, SearchLogEntry, SearchStore } from "./store";

export interface StoredProduct {
  product: AliProduct;
  titleHe: string | null;
  updatedAt: string;
}

type DbResult = { data: unknown; error: { message: string } | null };

function logFailure(op: string, err: unknown) {
  const message =
    err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
  console.error(`[supabase-store] ${op} failed: ${message}`);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Light shape checks: a malformed row must be a cache miss, not a crash in the pipeline.
function looksLikeParse(v: unknown): v is ParsedQuery {
  return (
    isObject(v) &&
    typeof v.keywords_en === "string" &&
    Array.isArray(v.product_terms) &&
    Array.isArray(v.requirements) &&
    typeof v.sort_preference === "string"
  );
}

function looksLikeResults(v: unknown): v is CachedResults {
  return (
    isObject(v) &&
    looksLikeParse(v.filters) &&
    Array.isArray(v.products) &&
    isObject(v.explanations) &&
    typeof v.checked === "number" &&
    typeof v.passed === "number" &&
    typeof v.createdAt === "string"
  );
}

const CACHE_KEY = { parse_cache: "query_key", search_cache: "filters_key" } as const;

/** Prefix of parse_cache and search_cache keys per env; production keeps the bare hashes. */
export const CACHE_KEY_PREFIX: Record<DeployEnv, string> = {
  production: "",
  preview: "preview:",
  development: "dev:",
};

export interface SupabaseStoreOptions {
  /** The env its rows are tagged with and its cache keys belong to. Default deployEnv(). */
  env?: DeployEnv;
}

export class SupabaseStore implements SearchStore {
  readonly env: DeployEnv;
  private readonly prefix: string;
  /**
   * Result sets this instance read from production's key (see readCached), with the query their
   * row was made for, so updateResults can save added explanations under this env's own key.
   */
  private readonly borrowed = new Map<string, string>();
  /**
   * Outside production: the products rows this instance inserted, with the updated_at it wrote
   * them with. A streamed search saves its cards' rows before their Hebrew titles exist; the titles
   * then reach only rows this instance made (same product and time), never a row production serves.
   */
  private readonly inserted = new Map<string, string>();

  constructor(
    private readonly db: SupabaseClient,
    { env = deployEnv() }: SupabaseStoreOptions = {},
  ) {
    this.env = env;
    this.prefix = CACHE_KEY_PREFIX[env];
  }

  /** Runs a read; any error or exception is logged and becomes null (a cache miss). */
  private async read<T>(op: string, run: () => PromiseLike<DbResult>): Promise<T | null> {
    try {
      const { data, error } = await run();
      if (error) throw error;
      return (data as T | null) ?? null;
    } catch (err) {
      logFailure(op, err);
      return null;
    }
  }

  /** Runs a write; any error or exception is logged. Returns whether it succeeded. */
  private async write(op: string, run: () => PromiseLike<DbResult>): Promise<boolean> {
    try {
      const { error } = await run();
      if (error) throw error;
      return true;
    } catch (err) {
      logFailure(op, err);
      return false;
    }
  }

  // Popularity counter only. Read-then-write can lose a count under concurrency, which is fine,
  // and it is not awaited so a cache hit never waits on it.
  private bumpHits(table: keyof typeof CACHE_KEY, key: string, hits: number) {
    void this.write(`${table} hits`, () =>
      this.db
        .from(table)
        .update({ hits: hits + 1 })
        .eq(CACHE_KEY[table], key),
    );
  }

  /** The key a cache row of this env is stored under. */
  private own(key: string): string {
    return this.prefix + key;
  }

  /**
   * The first usable row (`usable`: well formed and fresh) under this env's key or, outside
   * production, under production's bare key. Dev may read what production cached (reading changes
   * nothing, and it saves paid calls), but it writes, and counts hits, under its own keys only.
   * `borrowed` is true for a row read from production's key. `countHit` false (peekParse,
   * peekResults) leaves the hits counter alone: the read writes nothing.
   */
  private async readCached<R extends { hits: number }>(
    op: string,
    table: keyof typeof CACHE_KEY,
    columns: string,
    key: string,
    usable: (row: R) => boolean,
    countHit = true,
  ): Promise<{ row: R; borrowed: boolean } | null> {
    const keys = this.prefix ? [this.own(key), key] : [key];
    for (const k of keys) {
      const row = await this.read<R>(op, () =>
        this.db.from(table).select(columns).eq(CACHE_KEY[table], k).maybeSingle(),
      );
      if (!row || !usable(row)) continue;
      const borrowed = k !== this.own(key);
      if (!borrowed && countHit) this.bumpHits(table, k, row.hits ?? 0);
      return { row, borrowed };
    }
    return null;
  }

  private findParse(queryKey: string, now: Date, countHit: boolean) {
    type Row = { parsed: unknown; created_at: string; hits: number };
    return this.readCached<Row>(
      "getParse",
      "parse_cache",
      "parsed, created_at, hits",
      queryKey,
      (row) => looksLikeParse(row.parsed) && isFresh(new Date(row.created_at), now),
      countHit,
    );
  }

  async getParse(queryKey: string, now: Date): Promise<ParsedQuery | null> {
    const found = await this.findParse(queryKey, now, true);
    return found ? (found.row.parsed as ParsedQuery) : null;
  }

  /**
   * The cached parse, exactly as getParse finds it, for a reader that only looks (/p's similar
   * products, lib/similar/load.ts): no hit is counted, so it writes nothing.
   */
  async peekParse(queryKey: string, now: Date): Promise<ParsedQuery | null> {
    const found = await this.findParse(queryKey, now, false);
    return found ? (found.row.parsed as ParsedQuery) : null;
  }

  async putParse(
    queryKey: string,
    queryNorm: string,
    parsed: ParsedQuery,
    createdAt = new Date(),
  ): Promise<void> {
    // created_at is set explicitly so a stale row that gets replaced is fresh again.
    await this.write("putParse", () =>
      this.db.from("parse_cache").upsert(
        {
          query_key: this.own(queryKey),
          query_norm: queryNorm,
          parsed,
          created_at: createdAt.toISOString(),
        },
        { onConflict: "query_key" },
      ),
    );
  }

  private findResults(filtersKey: string, now: Date, countHit: boolean) {
    type Row = { response: unknown; created_at: string; hits: number; query: string };
    return this.readCached<Row>(
      "getResults",
      "search_cache",
      "response, created_at, hits, query",
      filtersKey,
      (row) =>
        looksLikeResults(row.response) &&
        isFreshResults(
          new Date(row.created_at),
          row.response.products.length,
          now,
          row.response.degraded === true,
        ),
      countHit,
    );
  }

  async getResults(filtersKey: string, now: Date): Promise<CachedResults | null> {
    const found = await this.findResults(filtersKey, now, true);
    if (!found) return null;
    if (found.borrowed) this.borrowed.set(filtersKey, found.row.query ?? "");
    return found.row.response as CachedResults;
  }

  /**
   * The cached result set, exactly as getResults finds it, for a reader that only looks: no hit is
   * counted, and nothing is kept for updateResults. Writes nothing.
   */
  async peekResults(filtersKey: string, now: Date): Promise<CachedResults | null> {
    const found = await this.findResults(filtersKey, now, false);
    return found ? (found.row.response as CachedResults) : null;
  }

  async putResults(filtersKey: string, query: string, results: CachedResults): Promise<void> {
    await this.write("putResults", () =>
      this.db.from("search_cache").upsert(
        {
          filters_key: this.own(filtersKey),
          query,
          parsed: results.filters,
          response: results,
          created_at: results.createdAt,
        },
        { onConflict: "filters_key" },
      ),
    );
  }

  /**
   * Saves added explanations. A result set this instance read from production's key is copied to
   * this env's key instead (with the query and time of production's row), never written back.
   * Only onto the entry `results` was read from (the same createdAt): when the result set was
   * fetched again in the meantime, the newer entry stays, and the added lines are simply written
   * again when next needed. The older one would otherwise come back under the new row's time.
   */
  async updateResults(filtersKey: string, results: CachedResults): Promise<void> {
    const borrowedQuery = this.borrowed.get(filtersKey);
    if (borrowedQuery !== undefined) {
      await this.putResults(filtersKey, borrowedQuery, results);
      this.borrowed.delete(filtersKey);
      return;
    }
    await this.write("updateResults", () =>
      this.db
        .from("search_cache")
        .update({ response: results })
        .eq("filters_key", this.own(filtersKey))
        .eq("response->>createdAt", results.createdAt),
    );
  }

  async logSearch(entry: SearchLogEntry): Promise<void> {
    await this.write("logSearch", () =>
      this.db.from("search_log").insert({
        query: entry.query,
        query_norm: entry.queryNorm,
        parsed: entry.parsed,
        result_ids: entry.resultIds,
        cache: entry.cache,
        results_count: entry.resultsCount,
        source: entry.source,
        category_id: entry.categoryId,
        listable: entry.listable,
        env: this.env,
        origin: entry.origin,
        without: entry.without,
        sort_override: entry.sortOverride,
        timings: entry.timings,
        ali_calls: entry.aliCalls,
        rejected: entry.rejected,
        failure: entry.failure,
        search_uid: entry.searchUid,
        shared: entry.shared,
        owner: entry.owner === true,
        diag: entry.diag ?? null,
      }),
    );
  }

  /** One llm_usage row per call, in a single insert. Token counts and cost only. */
  async logUsage(records: LlmUsageRecord[]): Promise<void> {
    if (!records.length) return;
    await this.write("logUsage", () =>
      this.db.from("llm_usage").insert(records.map((r) => ({ ...usageRow(r), env: this.env }))),
    );
  }

  /**
   * Of the stored products among `ids`: those whose updated_at is at or after `checkedAt` (their
   * data is at least as new as data checked then), and those with a Hebrew title of ours. Null
   * when the read failed.
   */
  private async storedState(
    ids: string[],
    checkedAt: string,
  ): Promise<{ newer: Set<string>; titled: Set<string> } | null> {
    type Row = { product_id: string; updated_at: string; title_he: string | null };
    const rows = await this.read<Row[]>("saveProducts newer", () =>
      this.db.from("products").select("product_id, updated_at, title_he").in("product_id", ids),
    );
    if (rows === null) return null;
    const since = Date.parse(checkedAt);
    const idsWhere = (keep: (r: Row) => boolean) =>
      new Set(rows.filter(keep).map((r) => r.product_id));
    return {
      newer: idsWhere((r) => Date.parse(r.updated_at) >= since),
      titled: idsWhere((r) => Boolean(r.title_he)),
    };
  }

  /**
   * `checkedAt` is when the data was fetched from AliExpress, for products from a cached result set
   * ("עוד N אפשרויות" serves results cached up to 14 days) or a hot list. The rows and their
   * price_history get that time, never the time of the save, since /p, /coupons and /go read
   * updated_at as when the price, the promo code and the link were checked. A row already stored
   * with data as new or newer (a /p refresh, a newer search) keeps it; only its Hebrew title is
   * written.
   *
   * `keepTitledRows` (hot lists, with `checkedAt`): a row with a Hebrew title of ours is not
   * touched at all. Its data came from a search in English, and a hot list's AliExpress Hebrew
   * title would replace the English original /p shows under our title; /p refreshes its price
   * after a day anyway. When the rows cannot be read, only new rows are written.
   *
   * Outside production (dev and preview share production's table) only rows production does not
   * have yet are written, and no price_history: a dev run with another explain prompt must never
   * change the Hebrew title, data or link /p, /go and /coupons serve; its own /go still finds the
   * rows it added, and a title saved later reaches a row this instance inserted (`inserted`).
   */
  async saveProducts(
    products: AliProduct[],
    titlesHe: Record<string, string | null>,
    checkedAt?: Date,
    { keepTitledRows = false }: { keepTitledRows?: boolean } = {},
  ): Promise<void> {
    // The row holds the product as AliExpress described it: a shared-numbers mark belongs to the
    // pool it was ranked in (lib/ranking/shared-numbers.ts), never to the product.
    let unique = [...new Map(products.map((p) => [p.productId, withoutSharedMark(p)])).values()];
    if (!unique.length) return;
    const updatedAt = (checkedAt ?? new Date()).toISOString();
    const production = this.env === "production";
    if (!production) {
      const own = (p: AliProduct) => this.inserted.has(p.productId);
      await Promise.all([
        this.insertNewProducts(
          unique.filter((p) => !own(p)),
          titlesHe,
          updatedAt,
        ),
        ...unique
          .filter((p) => own(p) && titlesHe[p.productId])
          .map((p) =>
            this.write("saveProducts title (own row)", () =>
              this.db
                .from("products")
                .update({ title_he: titlesHe[p.productId] })
                .eq("product_id", p.productId)
                .eq("updated_at", this.inserted.get(p.productId)!),
            ),
          ),
      ]);
      return;
    }
    let insertOnly = false;
    if (checkedAt) {
      // A failed read saves everything (with keepTitledRows: every new row); the rows then carry
      // the older time, which is still true.
      const stored = await this.storedState(
        unique.map((p) => p.productId),
        updatedAt,
      );
      if (keepTitledRows) {
        if (stored === null) insertOnly = true;
        else unique = unique.filter((p) => !stored.titled.has(p.productId));
        if (!unique.length) return;
      }
      const newer = stored?.newer;
      if (newer?.size) {
        await Promise.all(
          unique
            .filter((p) => newer.has(p.productId) && titlesHe[p.productId])
            .map((p) =>
              this.write("saveProducts title", () =>
                this.db
                  .from("products")
                  .update({ title_he: titlesHe[p.productId] })
                  .eq("product_id", p.productId),
              ),
            ),
        );
        unique = unique.filter((p) => !newer.has(p.productId));
        if (!unique.length) return;
      }
    }
    const row = (p: AliProduct) => ({ product_id: p.productId, data: p, updated_at: updatedAt });
    // PostgREST's upsert overwrites every column in the payload, so rows without a Hebrew title
    // go in a separate upsert that leaves title_he out and keeps a title saved earlier.
    const titled = unique.filter((p) => titlesHe[p.productId]);
    const untitled = unique.filter((p) => !titlesHe[p.productId]);
    const saved: AliProduct[] = [];
    const batches: [AliProduct[], Record<string, unknown>[]][] = [
      [titled, titled.map((p) => ({ ...row(p), title_he: titlesHe[p.productId] }))],
      [untitled, untitled.map(row)],
    ];
    await Promise.all(
      batches
        .filter(([group]) => group.length)
        .map(async ([group, rows]) => {
          const ok = await this.write("saveProducts", () =>
            this.db
              .from("products")
              .upsert(rows, { onConflict: "product_id", ignoreDuplicates: insertOnly }),
          );
          if (ok) saved.push(...group);
        }),
    );

    // Prices are never mixed across currencies (CLAUDE.md §6.5).
    const history = saved
      .map((p) => ({
        product_id: p.productId,
        price_ils: p.currency === "ILS" ? p.price : null,
        price_usd: p.currency === "USD" ? p.price : null,
        captured_at: updatedAt,
      }))
      .filter((h) => h.price_ils !== null || h.price_usd !== null);
    if (history.length) {
      await this.write("price_history", () => this.db.from("price_history").insert(history));
    }
  }

  /** Outside production: new rows only, never an update, and no price_history (saveProducts). */
  private async insertNewProducts(
    products: AliProduct[],
    titlesHe: Record<string, string | null>,
    updatedAt: string,
  ): Promise<void> {
    if (!products.length) return;
    // An insert production's row wins keeps that row's time, so a later title never matches it.
    for (const p of products) this.inserted.set(p.productId, updatedAt);
    const rows = products.map((p) => ({
      product_id: p.productId,
      data: p,
      updated_at: updatedAt,
      title_he: titlesHe[p.productId] || null,
    }));
    await this.write("saveProducts (insert only)", () =>
      this.db.from("products").upsert(rows, { onConflict: "product_id", ignoreDuplicates: true }),
    );
  }

  /**
   * Writes our Hebrew titles onto rows that exist, touching nothing else (not updated_at, no
   * price_history): an SEO page's continuation (lib/search/seo-run.ts) explains products saved by
   * an earlier run. Production only: outside it the rows belong to production (saveProducts).
   */
  async saveTitles(titles: Record<string, string>): Promise<void> {
    if (this.env !== "production") return;
    await Promise.all(
      Object.entries(titles)
        .filter(([, title]) => title.trim())
        .map(([id, title]) =>
          this.write("saveTitles", () =>
            this.db.from("products").update({ title_he: title }).eq("product_id", id),
          ),
        ),
    );
  }

  /** Product saved by a search (for /p and /go). Null when unknown. */
  async getProduct(productId: string): Promise<StoredProduct | null> {
    const row = await this.read<{ data: unknown; title_he: string | null; updated_at: string }>(
      "getProduct",
      () =>
        this.db
          .from("products")
          .select("data, title_he, updated_at")
          .eq("product_id", productId)
          .maybeSingle(),
    );
    if (!row || !isObject(row.data) || row.data.productId !== productId) return null;
    return {
      product: row.data as unknown as AliProduct,
      titleHe: row.title_he ?? null,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Of `ids`, the products that have a row (so /p/<id> works), each with its Hebrew title of ours
   * or null. Null when the read failed. One read, nothing written.
   */
  async storedTitles(ids: string[]): Promise<Map<string, string | null> | null> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    type Row = { product_id: string; title_he: string | null };
    const rows = await this.read<Row[]>("storedTitles", () =>
      this.db.from("products").select("product_id, title_he").in("product_id", unique),
    );
    if (rows === null) return null;
    return new Map(rows.map((r) => [r.product_id, r.title_he?.trim() || null]));
  }

  /**
   * Click-out log: product, button (src), env, whether a signed-in admin clicked (`owner`, left
   * out of the stats) and, for a result card of a logged search, that search's uid and the card's
   * position (already validated, clickRefFrom in ./server.ts). No IP, no user data.
   */
  async logClick(
    productId: string,
    src: string,
    ref: ClickRef = { searchUid: null, position: null },
    owner = false,
  ): Promise<void> {
    await this.write("logClick", () =>
      this.db.from("clicks").insert({
        product_id: productId,
        src,
        env: this.env,
        search_uid: ref.searchUid,
        position: ref.position,
        owner,
      }),
    );
  }
}
