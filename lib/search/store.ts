// Persistence used by the search pipeline. Supabase in production (lib/search/supabase-store.ts),
// in memory for the eval script and tests.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { RejectReason } from "@/lib/ranking/rank";
import type { LlmUsageRecord } from "@/lib/stats/usage";
import type { FilterBlocker } from "@/lib/types";
import type { ParsedQuery, SortPreference } from "./filters";
import { isFresh, isFreshResults } from "./cache-key";

/** What the 14-day cache saved: nothing, the parse call, or everything (CLAUDE.md §6.2). */
export type CacheLevel = "none" | "parse" | "results";

/**
 * Who asked: a visitor's search (including chip removals and sort changes), examplePreview (the
 * SEO landing pages; older rows also the home page example), or "עוד 3 אפשרויות". Only "search"
 * rows count as searches in the stats.
 */
export type SearchSource = "search" | "preview" | "more";

/**
 * How the search was asked for (search_log.origin, logOrigin in ./pipeline.ts): typed by the
 * visitor, one of our example queries or recent-search cards, a chip removal or a sort change on
 * the results page, "עוד 3 אפשרויות", an SEO landing page (preview), or a landing from an ad or
 * campaign link (utm_source / gclid on the URL).
 */
export const SEARCH_ORIGINS = [
  "typed",
  "example",
  "recent",
  "chip",
  "sort",
  "more",
  "preview",
  "ad",
] as const;
export type SearchOriginKind = (typeof SEARCH_ORIGINS)[number];

/**
 * Wall time of each step in whole milliseconds (search_log.timings). A step that did not run is
 * null: the parse on a cached parse, fetch and explain on a full cache hit. total_ms runs from the
 * start of the search to the log write (to the failure, for a failed one).
 */
export interface SearchTimings {
  parse_ms: number | null;
  /** AliExpress calls, filtering, ranking and link.generate. */
  fetch_ms: number | null;
  explain_ms: number | null;
  total_ms: number;
}

/** One search_log row. No IP and no user data (CLAUDE.md §6.9). */
export interface SearchLogEntry {
  query: string;
  /** normalizeQuery(query), so trivially different spellings count as one query in the stats. */
  queryNorm: string;
  /** The filters the search ran with; null for a search that failed before they were known. */
  parsed: ParsedQuery | null;
  /** Every product kept for the search (up to RESULTS_KEPT), or the page shown for "more". */
  resultIds: string[];
  cache: CacheLevel;
  /** Results in this response (0-3). 0 is a zero-result search; always 0 for a failed one. */
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
  origin: SearchOriginKind;
  /** Chip ids the visitor removed ([] for none). */
  without: string[];
  /** The sort chosen with the refine buttons, or null for the parsed one. */
  sortOverride: SortPreference | null;
  timings: SearchTimings;
  /** AliExpress calls this request made (product.query plus link.generate); 0 from the cache. */
  aliCalls: number;
  /** Rejections per reason over every product checked (rejectionCounts); null when none fetched. */
  rejected: Record<RejectReason, number> | null;
  /** Null for a search that returned a response; otherwise its SearchFailure code (server.ts). */
  failure: string | null;
  /**
   * Made for this row (crypto.randomUUID), before it is written: the /go links of the results it
   * showed carry it (?s=), so a click joins its search without waiting for the insert.
   */
  searchUid: string;
  /** A request that joined an identical search already running (no work of its own). */
  shared: boolean;
  /**
   * Made while a signed-in admin (the owner) browsed: logged, never counted in the stats and never
   * listed on /searches (search_log.owner). Absent means false.
   */
  owner?: boolean;
  /** How a search that did its own work went, beyond the counts (search_log.diag). */
  diag?: SearchDiag | null;
}

/**
 * search_log.diag (docs/search-quality-plan.md A10): why fetching stopped (FetchStop, "time",
 * "failed"), the keyword steps tried, the first-page products the safety net moved down, whether
 * the explain call failed, and how many explain lines fell back to the data sentence. For evals of
 * the live site; never shown.
 */
export interface SearchDiag {
  fetch_stop: string | null;
  keywords_tried: string[];
  demoted: string[];
  explain_failed: boolean;
  explain_rejected: number;
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
  /**
   * A search that showed fewer than a page: the filters whose removal lets more of the checked
   * products through, most useful first (lib/ranking/blockers.ts). Absent on older entries.
   */
  blockers?: FilterBlocker[];
  /**
   * The explain call failed and the first page shows lines built from the data: the entry is
   * reused for EMPTY_RESULTS_TTL_HOURS only (isFreshResults), then explained again.
   */
  degraded?: boolean;
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
  /**
   * Upserts products and appends a price_history row for each. `checkedAt` is when the data was
   * fetched from AliExpress when that was earlier than now (a cached result set): the rows get that
   * time, and a row stored with newer data keeps it (SupabaseStore.saveProducts).
   */
  saveProducts(
    products: AliProduct[],
    titlesHe: Record<string, string | null>,
    checkedAt?: Date,
  ): Promise<void>;
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
    return hit && isFreshResults(new Date(hit.createdAt), hit.products.length, now, hit.degraded)
      ? hit
      : null;
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
  /** Save times of the calls, for tests: null for "now", otherwise the given checkedAt. */
  savedAt: (string | null)[] = [];

  async saveProducts(
    products: AliProduct[],
    titlesHe: Record<string, string | null>,
    checkedAt?: Date,
  ) {
    this.savedAt.push(checkedAt?.toISOString() ?? null);
    for (const p of products) {
      this.products.set(p.productId, { product: p, titleHe: titlesHe[p.productId] ?? null });
    }
  }
}
