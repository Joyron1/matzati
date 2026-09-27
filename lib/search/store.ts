// Persistence used by the search pipeline. Supabase in production (lib/search/supabase-store.ts),
// in memory for the eval script and tests.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { ParsedQuery } from "./filters";
import { isFresh } from "./cache-key";

export interface Explanation {
  title_he: string | null;
  why_he: string;
}

export interface CachedResults {
  /** Filters with their Hebrew labels (generic, never the raw query), for later explain calls. */
  filters: ParsedQuery;
  checked: number;
  passed: number;
  /** Ranked products that passed every filter (up to RESULTS_KEPT). */
  products: AliProduct[];
  /** Explanations by product id; the first 3 are written up front, the next 3 on "show more". */
  explanations: Record<string, Explanation>;
  createdAt: string;
}

export interface SearchStore {
  getParse(queryKey: string, now: Date): Promise<ParsedQuery | null>;
  /** createdAt defaults to now; the pipeline passes its own clock so freshness is testable. */
  putParse(
    queryKey: string,
    queryNorm: string,
    parsed: ParsedQuery,
    createdAt?: Date,
  ): Promise<void>;
  getResults(filtersKey: string, now: Date): Promise<CachedResults | null>;
  putResults(filtersKey: string, query: string, results: CachedResults): Promise<void>;
  /** Saves added explanations without touching the query that created the entry. */
  updateResults(filtersKey: string, results: CachedResults): Promise<void>;
  /** No IP and no user data (CLAUDE.md §6.9). */
  logSearch(entry: { query: string; parsed: ParsedQuery; resultIds: string[] }): Promise<void>;
  /** Upserts products and appends a price_history row for each. */
  saveProducts(products: AliProduct[], titlesHe: Record<string, string | null>): Promise<void>;
}

export class MemoryStore implements SearchStore {
  parses = new Map<string, { parsed: ParsedQuery; at: Date }>();
  results = new Map<string, CachedResults>();
  logs: { query: string; parsed: ParsedQuery; resultIds: string[] }[] = [];
  products = new Map<string, { product: AliProduct; titleHe: string | null }>();

  async getParse(key: string, now: Date) {
    const hit = this.parses.get(key);
    return hit && isFresh(hit.at, now) ? hit.parsed : null;
  }
  async putParse(key: string, _norm: string, parsed: ParsedQuery, createdAt = new Date()) {
    this.parses.set(key, { parsed, at: createdAt });
  }
  async getResults(key: string, now: Date) {
    const hit = this.results.get(key);
    return hit && isFresh(new Date(hit.createdAt), now) ? hit : null;
  }
  async putResults(key: string, _query: string, results: CachedResults) {
    this.results.set(key, results);
  }
  async updateResults(key: string, results: CachedResults) {
    this.results.set(key, results);
  }
  async logSearch(entry: { query: string; parsed: ParsedQuery; resultIds: string[] }) {
    this.logs.push(entry);
  }
  async saveProducts(products: AliProduct[], titlesHe: Record<string, string | null>) {
    for (const p of products) {
      this.products.set(p.productId, { product: p, titleHe: titlesHe[p.productId] ?? null });
    }
  }
}
