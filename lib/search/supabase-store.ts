// SearchStore backed by the Supabase tables in supabase/migrations (service-role client).
// A store problem must never fail a user's search: reads that fail are cache misses (null) and
// writes that fail are logged and skipped.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { isFresh } from "./cache-key";
import type { ParsedQuery } from "./filters";
import type { CachedResults, SearchStore } from "./store";

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
    if (!row || !looksLikeResults(row.response) || !isFresh(new Date(row.created_at), now)) {
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

  async logSearch(entry: {
    query: string;
    parsed: ParsedQuery;
    resultIds: string[];
  }): Promise<void> {
    await this.write("logSearch", () =>
      this.db.from("search_log").insert({
        query: entry.query,
        parsed: entry.parsed,
        result_ids: entry.resultIds,
      }),
    );
  }

  async saveProducts(
    products: AliProduct[],
    titlesHe: Record<string, string | null>,
  ): Promise<void> {
    const unique = [...new Map(products.map((p) => [p.productId, p])).values()];
    if (!unique.length) return;
    const updatedAt = new Date().toISOString();
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
            this.db.from("products").upsert(rows, { onConflict: "product_id" }),
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
