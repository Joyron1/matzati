// SearchStore backed by the Supabase tables in supabase/migrations (service-role client).
// A store problem must never fail a user's search: reads that fail are cache misses (null) and
// writes that fail are logged and skipped.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AliProduct } from "@/lib/aliexpress/schemas";
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

export class SupabaseStore implements SearchStore {
  constructor(private readonly db: SupabaseClient) {}

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

  async getParse(queryKey: string, now: Date): Promise<ParsedQuery | null> {
    const row = await this.read<{ parsed: unknown; created_at: string; hits: number }>(
      "getParse",
      () =>
        this.db
          .from("parse_cache")
          .select("parsed, created_at, hits")
          .eq("query_key", queryKey)
          .maybeSingle(),
    );
    if (!row || !looksLikeParse(row.parsed) || !isFresh(new Date(row.created_at), now)) {
      return null;
    }
    this.bumpHits("parse_cache", queryKey, row.hits ?? 0);
    return row.parsed;
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
          query_key: queryKey,
          query_norm: queryNorm,
          parsed,
          created_at: createdAt.toISOString(),
        },
        { onConflict: "query_key" },
      ),
    );
  }

  async getResults(filtersKey: string, now: Date): Promise<CachedResults | null> {
    const row = await this.read<{ response: unknown; created_at: string; hits: number }>(
      "getResults",
      () =>
        this.db
          .from("search_cache")
          .select("response, created_at, hits")
          .eq("filters_key", filtersKey)
          .maybeSingle(),
    );
    if (
      !row ||
      !looksLikeResults(row.response) ||
      !isFreshResults(new Date(row.created_at), row.response.products.length, now)
    ) {
      return null;
    }
    this.bumpHits("search_cache", filtersKey, row.hits ?? 0);
    return row.response;
  }

  async putResults(filtersKey: string, query: string, results: CachedResults): Promise<void> {
    await this.write("putResults", () =>
      this.db.from("search_cache").upsert(
        {
          filters_key: filtersKey,
          query,
          parsed: results.filters,
          response: results,
          created_at: results.createdAt,
        },
        { onConflict: "filters_key" },
      ),
    );
  }

  async updateResults(filtersKey: string, results: CachedResults): Promise<void> {
    await this.write("updateResults", () =>
      this.db.from("search_cache").update({ response: results }).eq("filters_key", filtersKey),
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
      }),
    );
  }

  /** One llm_usage row per call, in a single insert. Token counts and cost only. */
  async logUsage(records: LlmUsageRecord[]): Promise<void> {
    if (!records.length) return;
    await this.write("logUsage", () => this.db.from("llm_usage").insert(records.map(usageRow)));
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
   * ("עוד 3 אפשרויות" serves results cached up to 14 days) or a hot list. The rows and their
   * price_history get that time, never the time of the save, since /p, /coupons and /go read
   * updated_at as when the price, the promo code and the link were checked. A row already stored
   * with data as new or newer (a /p refresh, a newer search) keeps it; only its Hebrew title is
   * written.
   *
   * `keepTitledRows` (hot lists, with `checkedAt`): a row with a Hebrew title of ours is not
   * touched at all. Its data came from a search in English, and a hot list's AliExpress Hebrew
   * title would replace the English original /p shows under our title; /p refreshes its price
   * after a day anyway. When the rows cannot be read, only new rows are written.
   */
  async saveProducts(
    products: AliProduct[],
    titlesHe: Record<string, string | null>,
    checkedAt?: Date,
    { keepTitledRows = false }: { keepTitledRows?: boolean } = {},
  ): Promise<void> {
    let unique = [...new Map(products.map((p) => [p.productId, p])).values()];
    if (!unique.length) return;
    const updatedAt = (checkedAt ?? new Date()).toISOString();
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

  /** Click-out log: { product_id, src, created_at } only. No IP, no user data. */
  async logClick(productId: string, src: string): Promise<void> {
    await this.write("logClick", () =>
      this.db.from("clicks").insert({ product_id: productId, src }),
    );
  }
}
