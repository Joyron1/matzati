// Persistence used by the search pipeline. Supabase in production (lib/search/supabase-store.ts),
// in memory for the eval script and tests.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { LlmUsageRecord } from "@/lib/stats/usage";
import type { ParsedQuery } from "./filters";
import { isFresh, isFreshResults } from "./cache-key";

/** What the 14-day cache saved: nothing, the parse call, or everything (CLAUDE.md §6.2). */
export type CacheLevel = "none" | "parse" | "results";

/**
 * Who asked: a visitor's search (including chip removals and sort changes), examplePreview (the
 * SEO landing pages; older rows also the home page example), or "עוד 3 אפשרויות". Only "search"
 * rows count as searches in the stats.
 */
export type SearchSource = "search" | "preview" | "more";

/** One search_log row. No IP and no user data (CLAUDE.md §6.9). */
export interface SearchLogEntry {
  query: string;
  /** normalizeQuery(query), so trivially different spellings count as one query in the stats. */
  queryNorm: string;
  parsed: ParsedQuery;
  /** Every product kept for the search (up to RESULTS_KEPT), or the page shown for "more". */
  resultIds: string[];
  cache: CacheLevel;
  /** Results in this response (0-3). 0 is a zero-result search. */
  resultsCount: number;
  source: SearchSource;
  /** First-level AliExpress category of the first product shown; null when none was shown. */
  categoryId: string | null;
  /**
   * May appear on the public recent-searches page (/searches): a query the visitor typed, with no
   * chips removed and no sort override, that showed results and passes lib/recent/privacy.ts. See
   * isListableSearch in ./pipeline.ts.
   */
  listable: boolean;
}

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
  logSearch(entry: SearchLogEntry): Promise<void>;
  /** One llm_usage row per LLM call, with its token usage and cost. */
  logUsage(records: LlmUsageRecord[]): Promise<void>;
  /** Upserts products and appends a price_history row for each. */
  saveProducts(products: AliProduct[], titlesHe: Record<string, string | null>): Promise<void>;
}

export class MemoryStore implements SearchStore {
  parses = new Map<string, { parsed: ParsedQuery; at: Date }>();
  results = new Map<string, CachedResults>();
  logs: SearchLogEntry[] = [];
  usage: LlmUsageRecord[] = [];
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
    return hit && isFreshResults(new Date(hit.createdAt), hit.products.length, now) ? hit : null;
  }
  async putResults(key: string, _query: string, results: CachedResults) {
    this.results.set(key, results);
  }
  async updateResults(key: string, results: CachedResults) {
    this.results.set(key, results);
  }
  async logSearch(entry: SearchLogEntry) {
    this.logs.push(entry);
  }
  async logUsage(records: LlmUsageRecord[]) {
    this.usage.push(...records);
  }
  async saveProducts(products: AliProduct[], titlesHe: Record<string, string | null>) {
    for (const p of products) {
      this.products.set(p.productId, { product: p, titleHe: titlesHe[p.productId] ?? null });
    }
  }
}
