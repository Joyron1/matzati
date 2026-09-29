// The search pipeline (CLAUDE.md §6). The LLM parses and explains; code fetches, filters, ranks
// and links. Rate limiting and the daily kill switch live in the API layer, not here.
// A search runs in stages (startSearch, docs/search-quality-plan.md item 15): the chips once the
// query is understood, the products once they are ranked, linked and saved, then their lines. A
// fetch keeps its checked pool with its result set (./pool.ts, item 13): a sort change or a removed
// requirement is ranked from it with no product.query call, and only the products shown without a
// line that still holds for them are explained.
import { generateLinks, queryProducts, type ProductSort } from "@/lib/aliexpress/affiliate";
import type { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import {
  checkExplanation,
  explainContextFrom,
  explainProducts,
  whyFromData,
  withoutRepeatedLines,
  type ExplainContext,
  type ExplainInput,
} from "@/lib/llm/explain";
import { parseQuery } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import { usefulRelaxations } from "@/lib/ranking/blockers";
import { demoteFlaggedLeads } from "@/lib/ranking/featured-guard";
import {
  rankWithFill,
  rejectionCounts,
  sharedMarkOf,
  trustTierOf,
  type RejectReason,
} from "@/lib/ranking/rank";
import { RESULTS_KEPT, RESULTS_PER_PAGE } from "@/lib/config/site";
import { DEFAULT_SHOP_CAP_MODE, type ShopCapMode } from "@/lib/ranking/config";
import { isListableQuery } from "@/lib/recent/privacy";
import { fixTransliterations } from "@/lib/transliterations";
import type { SearchArrival } from "@/lib/search-url";
import type { LlmCallKind, LlmUsageRecord } from "@/lib/stats/usage";
import type { FilterBlocker, FilterChip, ResultProduct, SearchResponse } from "@/lib/types";
import {
  CACHE_TTL_HOURS,
  EMPTY_RESULTS_TTL_HOURS,
  filtersKey,
  isFreshResults,
  normalizeQuery,
  queryKey,
} from "./cache-key";
import { applyOverrides, buildChips } from "./chips";
import {
  lowestUnitsSold,
  nextFetch,
  type FetchedPage,
  type FetchLimits,
  type FetchStop,
} from "./fetch-policy";
import type { ParsedQuery, SortPreference } from "./filters";
import {
  poolFrom,
  poolOf,
  poolView,
  rankView,
  removedPrices,
  removedRequirements,
  viewKeyOf,
  viewSpecs,
  type RankedView,
} from "./pool";
import type {
  CachedResults,
  CacheLevel,
  Explanation,
  SearchDiag,
  SearchLogEntry,
  SearchOriginKind,
  SearchSource,
  SearchStore,
  SearchTimings,
} from "./store";

export { keywordLadder } from "./fetch-policy";

export const MAX_QUERY_LENGTH = 200;
/** How many ranked products we keep per search: three pages (lib/config/site.ts). */
export { RESULTS_KEPT };

/**
 * Limits per LLM step (docs/search-quality-plan.md item 7), so a slow or failing model cannot hold
 * a visitor for a minute: the parse gets one retry and then fails the search with "llm"; explain
 * gets none and falls back to lines built from the data.
 */
export const LLM_STAGE_LIMITS = {
  parse: { timeoutMs: 10_000, maxRetries: 1 },
  explain: { timeoutMs: 10_000, maxRetries: 0 },
} as const;

/**
 * No AliExpress call after the first starts once the fetch step has run this long: what was found
 * is ranked instead (a call that retries can take over 20 s).
 */
export const FETCH_BUDGET_MS = 12_000;

export type SearchErrorCode =
  | "invalid_query"
  | "parse_failed"
  | "upstream"
  /** The LLM could not be reached or did not answer in time (not AliExpress, not the query). */
  | "llm"
  /** The daily LLM budget (DAILY_SEARCH_CAP) is used up; cached results are still served. */
  | "capacity";

export class SearchError extends Error {
  constructor(
    public readonly code: SearchErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SearchError";
  }
}

/** The provider with a step's limits on every call it makes (LLM_STAGE_LIMITS). */
export function withLimits(
  llm: LlmProvider,
  limits: Pick<StructuredRequest<never>, "timeoutMs" | "maxRetries">,
): LlmProvider {
  return {
    name: llm.name,
    model: llm.model,
    generateStructured: (req) => llm.generateStructured({ ...req, ...limits }),
  };
}

export interface SearchDeps {
  llm: LlmProvider;
  ali: AliExpressClient;
  store: SearchStore;
  now?: () => Date;
  /** Spacing between AliExpress calls inside one search (their frequency ban lasts ~1 s). */
  sleep?: (ms: number) => Promise<void>;
  aliSpacingMs?: number;
  /**
   * Called once, right before the first paid step of a search (a parse or a fresh fetch+explain).
   * Throw SearchError("capacity") to refuse new LLM work. Fully cached searches never call it.
   */
  beforeLlmWork?: () => Promise<void>;
  /** Milliseconds for the step timings in search_log (default performance.now). */
  clockMs?: () => number;
  /** A new search_log.search_uid (default crypto.randomUUID). */
  newSearchUid?: () => string;
  /**
   * The failure code logged for an error that ends a search (search_log.failure), or null to log
   * no row for it. The server passes the mapping it answers with (lib/search/server.ts); default
   * searchFailureCode.
   */
  failureOf?: (err: unknown) => string | null;
  /**
   * The admin's shop cap setting (lib/settings), read once per request by lib/search/server.ts;
   * default DEFAULT_SHOP_CAP_MODE. The ranking runs under it and the results cache key holds it
   * (filtersKey), so a list ranked under one mode is never served under the other.
   */
  shopCap?: ShopCapMode;
}

export interface SearchInput {
  q: string;
  /** Chip ids the user removed; the cached parse is reused, so no LLM call. */
  without?: string[];
  /** Sort chosen with the refine buttons; overrides the parsed preference without a new parse. */
  sort?: SortPreference;
  /** Written to search_log (default "search"); "preview" is examplePreview (SEO landing pages). */
  source?: Exclude<SearchSource, "more">;
  /**
   * The visitor typed the query. Defaults to true unless `arrival` is set. False when it came from
   * one of our own links (a recent-search card, an example query) or an ad: logged as usual, never
   * listed on /searches.
   */
  typed?: boolean;
  /** How the visitor reached this URL when they did not type the query (search_log.origin). */
  arrival?: SearchArrival;
  /**
   * A signed-in admin (the owner) asked: logged with owner true, so the stats leave it out. A
   * typed one is still listed on /searches (isListableSearch).
   */
  owner?: boolean;
}

/** An LLM call recorded by the pipeline; K narrows the jobs one entry point can make. */
export type UsageOf<K extends LlmCallKind> = Omit<LlmUsageRecord, "kind"> & { kind: K };

/** A search makes parse and explain calls; "show more" (loadMore) makes explain_more calls. */
export interface SearchMeta<K extends LlmCallKind = "parse" | "explain"> {
  cache: CacheLevel;
  /** Every LLM call made, also written to llm_usage (SearchStore.logUsage). */
  llmUsage: UsageOf<K>[];
  /** product.query calls (the MAX_ALI_CALLS budget). */
  aliCalls: number;
  /** link.generate calls for products without a promotion_link (not part of MAX_ALI_CALLS). */
  linkCalls: number;
  rejected: Record<RejectReason, number> | null;
  keywordsTried: string[];
  /** Explain lines that failed a check and fell back (for evals and logs, never shown). */
  explainRejected: { product_id: string; rejected: unknown }[];
  /** Step times so far (search_log.timings adds total_ms when the row is written). */
  timings: Omit<SearchTimings, "total_ms">;
  /**
   * Why fetching stopped (fetch-policy.ts), "time" after FETCH_BUDGET_MS, or "failed" when a call
   * after the first failed and the search went on with what it had. Null before a fetch.
   */
  fetchStop?: FetchStop | "time" | "failed" | null;
  /** The explain call failed: the lines were built from the data, and the results kept 48 h. */
  explainFailed?: boolean;
  /** First-page products the safety net moved down (demoteFlaggedLeads), for evals and tests. */
  demoted?: string[];
  /** Ranked from a pool already checked (a sort change, a removed requirement): no fetch. */
  derived?: boolean;
  /** Lines written for other results of the same pool that still held for this page. */
  linesReused?: number;
}

export interface SearchOutcome {
  response: SearchResponse;
  meta: SearchMeta;
  /** The search_log row written for this search. */
  log: SearchLogEntry;
}

const newMeta = <K extends LlmCallKind>(cache: CacheLevel): SearchMeta<K> => ({
  cache,
  llmUsage: [],
  aliCalls: 0,
  linkCalls: 0,
  rejected: null,
  keywordsTried: [],
  explainRejected: [],
  timings: { parse_ms: null, fetch_ms: null, explain_ms: null, products_ms: null },
  fetchStop: null,
  explainFailed: false,
});

/** One logged request: its search_log uid and its clock (for search_log.timings). */
interface RunClock {
  uid: string;
  clock: () => number;
  started: number;
}

function startRun(deps: Pick<SearchDeps, "clockMs" | "newSearchUid">): RunClock {
  const clock = deps.clockMs ?? (() => performance.now());
  return { uid: (deps.newSearchUid ?? (() => crypto.randomUUID()))(), clock, started: clock() };
}

/** Runs one step and records its wall time in meta.timings, also when it throws. */
async function timed<T>(
  run: RunClock,
  meta: Pick<SearchMeta, "timings">,
  step: keyof SearchMeta["timings"],
  work: () => Promise<T>,
): Promise<T> {
  const start = run.clock();
  try {
    return await work();
  } finally {
    meta.timings[step] = Math.round(run.clock() - start);
  }
}

/**
 * The failure code for an error that ends a search, as the server answers it (SearchFailure in
 * lib/search/server.ts) for the errors the pipeline knows; anything else is "unavailable".
 */
export function searchFailureCode(err: unknown): string {
  if (err instanceof SearchError) return err.code;
  if (err instanceof AliExpressError) return "upstream";
  return "unavailable";
}

/** Logging and stats writes must never fail a search: errors are logged and swallowed. */
async function quietly(op: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[search] ${op} failed: ${text.slice(0, 300)}`);
  }
}

/** Writes the LLM usage recorded since the last call, so every call is stored exactly once. */
function usageWriter(
  store: SearchStore,
  meta: { llmUsage: readonly LlmUsageRecord[] },
): () => Promise<void> {
  let written = 0;
  return () => {
    const pending = meta.llmUsage.slice(written);
    written = meta.llmUsage.length;
    return pending.length ? quietly("logUsage", () => store.logUsage(pending)) : Promise.resolve();
  };
}

// Always fetch established products; "cheapest" is applied by our own ranking.
const FETCH_SORT: ProductSort = "LAST_VOLUME_DESC";

/** Name and message only, never a stack trace; our errors name keys, never their values. */
export function errorText(err: unknown): string {
  return (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
}

export function toExplainInput(p: AliProduct): ExplainInput {
  const shared = sharedMarkOf(p);
  return {
    product_id: p.productId,
    title_en: p.title,
    price_ils: p.price,
    original_price_ils: p.originalPrice,
    discount_pct: p.discountPct,
    positive_feedback_pct: p.positiveFeedbackPct,
    units_sold_30d: p.unitsSold,
    // Marked by the ranking (lib/ranking/shared-numbers.ts): explain leaves the shared numbers out.
    ...(shared ? { shared_numbers: shared } : {}),
  };
}

export function toResultProduct(p: AliProduct, e: Explanation | undefined): ResultProduct {
  const shared = sharedMarkOf(p);
  return {
    product_id: p.productId,
    // A cached title of ours is read with the known transliterations fixed (lib/transliterations).
    title_he: e?.title_he != null ? fixTransliterations(e.title_he, p.title) : p.title,
    title_en: p.title,
    why_he: fixTransliterations(e?.why_he ?? "", p.title),
    price_ils: p.price,
    original_price_ils: p.originalPrice,
    price_is_approx: p.currency !== "ILS",
    discount_pct: p.discountPct,
    positive_feedback_pct: p.positiveFeedbackPct,
    units_sold: p.unitsSold,
    passed_tier: trustTierOf(p),
    ...(shared ? { shared_numbers: shared } : {}),
    image_urls: p.imageUrls,
    category_id: p.category.firstId,
  };
}

export interface Fetched {
  ranked: AliProduct[];
  passed: number;
  checked: number;
  /** Every distinct product checked (for the blockers of a search with too few results). */
  pool: AliProduct[];
}

/** How far fetchAndRank goes: a visitor's search by default (SEARCH_FETCH, FETCH_BUDGET_MS). */
export interface FetchOptions {
  limits?: Partial<FetchLimits>;
  /** No call after the first starts once the fetch has run this long. */
  budgetMs?: number;
  /** Ranked products kept (RESULTS_KEPT for a search). */
  kept?: number;
  /** Asked before each call after the first: false stops the fetch ("time"). */
  mayCall?: () => boolean;
}

/**
 * Fetches by the fetch policy (./fetch-policy.ts), then filters and ranks everything found. Only
 * the first call can fail the search: a later call that fails (AliExpress's quota is shared by
 * every visitor) keeps what was found so far, and no call after the first starts once the step
 * has run FETCH_BUDGET_MS. An SEO page's refresh passes its own limits (SEO_FETCH, lib/search/
 * seo-run.ts); the ranking is the same.
 */
export async function fetchAndRank(
  parsed: ParsedQuery,
  deps: Required<Pick<SearchDeps, "ali" | "sleep" | "aliSpacingMs" | "now" | "shopCap">>,
  meta: Pick<SearchMeta, "fetchStop" | "aliCalls" | "keywordsTried" | "rejected">,
  { limits, budgetMs = FETCH_BUDGET_MS, kept = RESULTS_KEPT, mayCall }: FetchOptions = {},
): Promise<Fetched> {
  const seen = new Map<string, AliProduct>();
  const calls: FetchedPage[] = [];
  const started = deps.now().getTime();
  for (;;) {
    const decision = nextFetch({ filters: parsed, calls, pool: [...seen.values()] }, limits);
    if ("stop" in decision) {
      meta.fetchStop = decision.stop;
      break;
    }
    if (calls.length && (deps.now().getTime() - started >= budgetMs || (mayCall && !mayCall()))) {
      meta.fetchStop = "time";
      break;
    }
    const { keywords, pageNo } = decision.step;
    if (meta.aliCalls > 0) await deps.sleep(deps.aliSpacingMs);
    meta.aliCalls++;
    meta.keywordsTried.push(pageNo > 1 ? `${keywords} (p${pageNo})` : keywords);
    let products: AliProduct[];
    let totalRecords: number | null;
    try {
      ({ products, totalRecords } = await queryProducts(deps.ali, {
        keywords,
        pageNo,
        minPriceIls: parsed.min_price_ils,
        maxPriceIls: parsed.max_price_ils,
        sort: FETCH_SORT,
      }));
    } catch (err) {
      if (!calls.length || !(err instanceof AliExpressError)) throw err;
      console.error(`[search] product.query ${calls.length + 1} failed: ${errorText(err)}`);
      meta.fetchStop = "failed";
      break;
    }
    for (const p of products) if (!seen.has(p.productId)) seen.set(p.productId, p);
    calls.push({
      keywords,
      pageNo,
      count: products.length,
      totalRecords,
      lowestUnitsSold: lowestUnitsSold(products),
    });
  }
  const pool = [...seen.values()];
  meta.rejected = rejectionCounts(pool, parsed);
  // Too few met FILTERS: top up to one page from the second trust tier (FILL_TIER).
  const final = rankWithFill(pool, parsed, RESULTS_PER_PAGE, deps.shopCap);
  // passed counts every distinct product that met the filters, not just the ones we keep.
  return {
    ranked: final.ranked.slice(0, kept),
    passed: final.ranked.length,
    checked: pool.length,
    pool,
  };
}

/**
 * Makes sure every product we may show has an affiliate link (§6.7). When link.generate fails,
 * the products that already have a link go on (the others are never shown); only when none has
 * one does the failure end the search. `space` waits out the gap AliExpress needs after the
 * search's product.query calls (their frequency ban is shared by every visitor).
 */
export async function ensureLinks(
  ali: AliExpressClient,
  products: AliProduct[],
  meta: Pick<SearchMeta, "linkCalls" | "aliCalls">,
  space: (ms: number) => Promise<void>,
  spacingMs: number,
): Promise<AliProduct[]> {
  const missing = products.filter((p) => !p.promotionLink);
  if (!missing.length) return products;
  if (meta.aliCalls > 0) await space(spacingMs);
  meta.linkCalls++;
  let links: Awaited<ReturnType<typeof generateLinks>> = [];
  try {
    links = await generateLinks(
      ali,
      missing.map((p) => `https://www.aliexpress.com/item/${p.productId}.html`),
    );
  } catch (err) {
    if (!(err instanceof AliExpressError) || missing.length === products.length) throw err;
    console.error(`[search] link.generate failed: ${errorText(err)}`);
  }
  const byId = new Map(
    links
      .filter((l) => l.promotionLink)
      .map((l) => [l.sourceValue.match(/item\/(\d+)\.html/)?.[1] ?? "", l.promotionLink!]),
  );
  return products
    .map((p) => (p.promotionLink ? p : { ...p, promotionLink: byId.get(p.productId) ?? null }))
    .filter((p) => p.promotionLink); // never show a product we cannot link to
}

/** Explains `products` with one LLM call, which it passes to `recordCall`. */
async function explainRange(
  llm: LlmProvider,
  parsed: ParsedQuery,
  products: AliProduct[],
  meta: Pick<SearchMeta, "explainRejected">,
  recordCall: (call: Omit<LlmUsageRecord, "kind">) => void,
): Promise<Record<string, Explanation>> {
  if (!products.length) return {};
  const res = await explainProducts(
    withLimits(llm, LLM_STAGE_LIMITS.explain),
    explainContextFrom(parsed),
    products.map(toExplainInput),
  );
  recordCall({ usage: res.usage, model: res.model });
  for (const i of res.items) {
    if (i.rejected) meta.explainRejected.push({ product_id: i.product_id, rejected: i.rejected });
  }
  return Object.fromEntries(
    res.items.map((i) => [i.product_id, { title_he: i.title_he, why_he: i.why_he }]),
  );
}

/**
 * The lines shown when the explain call fails (docs/search-quality-plan.md item 7): no Hebrew
 * title (the card shows AliExpress's own) and the sentence built from the data (whyFromData).
 */
export function explanationsFromData(products: AliProduct[]): Record<string, Explanation> {
  return Object.fromEntries(
    products.map((p) => [p.productId, { title_he: null, why_he: whyFromData(toExplainInput(p)) }]),
  );
}

/**
 * explainRange, or the lines from the data when the call fails (meta.explainFailed). A refusal of
 * ours (SearchError) is never swallowed.
 */
async function explainOrFallback(
  llm: LlmProvider,
  parsed: ParsedQuery,
  products: AliProduct[],
  meta: Pick<SearchMeta, "explainRejected" | "explainFailed">,
  recordCall: (call: Omit<LlmUsageRecord, "kind">) => void,
): Promise<Record<string, Explanation>> {
  try {
    return await explainRange(llm, parsed, products, meta, recordCall);
  } catch (err) {
    if (err instanceof SearchError) throw err;
    console.error(`[search] explain failed, lines from the data: ${errorText(err)}`);
    meta.explainFailed = true;
    return explanationsFromData(products);
  }
}

/**
 * The filters that kept products out of a search that shows fewer than a page, as its results
 * page offers them (lib/ranking/blockers.ts): only those whose removal lets more of the checked
 * products through, most useful first.
 */
function blockersOf(pool: AliProduct[], filters: ParsedQuery, passed: number): FilterBlocker[] {
  return usefulRelaxations(pool, filters, passed).map((r) => ({
    chip_id: r.chipId,
    would_pass: r.wouldPass,
    title_matches: r.titleMatches,
    ...(r.sizeCap ? { size_cap: true as const } : {}),
  }));
}

/** What the results page can show once the query is understood: the chips row and its notes. */
export interface UnderstoodSearch {
  query: string;
  chips: FilterChip[];
  sort: SortPreference;
  /** SearchResponse.not_filtered. */
  not_filtered?: string[];
}

function understoodOf(q: string, filters: ParsedQuery): UnderstoodSearch {
  return {
    query: q,
    chips: buildChips(filters),
    sort: filters.sort_preference,
    // From this request's parse, like the chips: a need we could not check is never hidden.
    ...(filters.preferences?.length ? { not_filtered: filters.preferences.map((p) => p.he) } : {}),
  };
}

function respond(
  q: string,
  filters: ParsedQuery,
  cached: CachedResults,
  key: string,
  fromCache: boolean,
): SearchResponse {
  const { not_filtered, ...understood } = understoodOf(q, filters);
  const shown = cached.products.slice(0, RESULTS_PER_PAGE);
  return {
    ...understood,
    checked_count: cached.checked,
    passed_count: cached.passed,
    results: shown.map((p) => toResultProduct(p, cached.explanations[p.productId])),
    more_available: cached.products.length > RESULTS_PER_PAGE,
    filters_key: key,
    cached: fromCache,
    fetched_at: cached.createdAt,
    ...(cached.blockers ? { blockers: cached.blockers } : {}),
    ...(not_filtered ? { not_filtered } : {}),
  };
}

/** How a search was asked for: what decides whether /searches may list it (isListableSearch). */
export interface SearchOrigin {
  source: SearchSource;
  /** Chip ids removed. */
  without: readonly string[];
  /** Sort chosen with the refine buttons, if any. */
  sort?: SortPreference;
  /** False for a query from one of our own links or an ad (SearchInput.typed). */
  typed: boolean;
  /** How the visitor reached the URL when they did not type the query (SearchInput.arrival). */
  arrival?: SearchArrival;
  /** A signed-in admin asked (SearchInput.owner). */
  owner?: boolean;
}

function searchOrigin(input: SearchInput): SearchOrigin {
  return {
    source: input.source ?? "search",
    without: input.without ?? [],
    sort: input.sort,
    typed: input.typed ?? input.arrival === undefined,
    ...(input.arrival ? { arrival: input.arrival } : {}),
    ...(input.owner ? { owner: true } : {}),
  };
}

/**
 * search_log.origin. "more" and "preview" by their source; a visitor's search by where they came
 * from (an ad, a recent-search card, an example), else by what they changed on the results page
 * (a removed chip before a sort change: the chip link keeps the sort), else "typed".
 */
export function logOrigin(origin: SearchOrigin): SearchOriginKind {
  if (origin.source !== "search") return origin.source;
  if (origin.arrival) return origin.arrival;
  if (origin.without.length) return "chip";
  if (origin.sort !== undefined) return "sort";
  return "typed";
}

type Telemetry = Pick<
  SearchLogEntry,
  | "origin"
  | "without"
  | "sortOverride"
  | "timings"
  | "aliCalls"
  | "rejected"
  | "failure"
  | "searchUid"
  | "shared"
  | "owner"
  | "diag"
>;

type DiagMeta = Pick<
  SearchMeta<LlmCallKind>,
  | "fetchStop"
  | "keywordsTried"
  | "demoted"
  | "explainFailed"
  | "explainRejected"
  | "derived"
  | "linesReused"
>;

/**
 * search_log.diag for a request that fetched, explained or ranked something itself (SearchDiag),
 * null for a full cache hit or a failure before any of it.
 */
export function diagOf(meta: DiagMeta): SearchDiag | null {
  const fetched = meta.fetchStop !== null && meta.fetchStop !== undefined;
  const explained = meta.explainFailed === true || meta.explainRejected.length > 0;
  if (!fetched && !explained && !meta.demoted?.length && !meta.derived) return null;
  return {
    fetch_stop: meta.fetchStop ?? null,
    keywords_tried: [...meta.keywordsTried],
    demoted: [...(meta.demoted ?? [])],
    explain_failed: meta.explainFailed === true,
    explain_rejected: meta.explainRejected.length,
    ...(meta.derived ? { derived: true as const } : {}),
    ...(meta.linesReused ? { lines_reused: meta.linesReused } : {}),
  };
}

/** The search_log fields on how a request was asked for, what it cost and how long it took. */
function telemetry(
  origin: SearchOrigin,
  meta: Pick<SearchMeta<LlmCallKind>, "aliCalls" | "linkCalls" | "rejected" | "timings"> & DiagMeta,
  run: RunClock,
  failure: string | null = null,
): Telemetry {
  return {
    origin: logOrigin(origin),
    without: [...origin.without],
    sortOverride: origin.source === "search" ? (origin.sort ?? null) : null,
    timings: { ...meta.timings, total_ms: Math.round(run.clock() - run.started) },
    aliCalls: meta.aliCalls + meta.linkCalls,
    rejected: meta.rejected,
    failure,
    searchUid: run.uid,
    shared: false,
    owner: origin.owner === true,
    diag: diagOf(meta),
  };
}

/**
 * Writes the row of a request that ended in an error, with the failure code `failureOf` gives it
 * (null: not logged). Never throws, and never replaces the error the caller rethrows.
 */
async function logFailure(
  store: SearchStore,
  failureOf: SearchDeps["failureOf"],
  err: unknown,
  row: (failure: string) => SearchLogEntry,
): Promise<void> {
  await quietly("logSearch", async () => {
    const failure = (failureOf ?? searchFailureCode)(err);
    if (failure !== null) await store.logSearch(row(failure));
  });
}

/**
 * Whether a search may appear on the public recent-searches page (/searches): only a query a
 * visitor typed (source "search", not from one of our links, no chips removed, no sort override,
 * so the card's link rebuilds exactly these filters) that showed results, and only when the query
 * passes the privacy check (no phone or ID numbers, emails, links or handles). The owner's own
 * typed searches are real searches and are listed too (owner decision 2026-09-29); owner only
 * keeps a row out of the stats.
 */
export function isListableSearch(q: string, origin: SearchOrigin, resultsCount: number): boolean {
  return (
    origin.source === "search" &&
    origin.typed &&
    origin.without.length === 0 &&
    origin.sort === undefined &&
    resultsCount > 0 &&
    isListableQuery(q)
  );
}

/** The state of one search, shared by its steps and its failure row. */
interface SearchRun {
  deps: SearchDeps;
  meta: SearchMeta;
  run: RunClock;
  origin: SearchOrigin;
  /** The filters once known (null while parsing), for the failure row. */
  filters: ParsedQuery | null;
  writeUsage: () => Promise<void>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** deps.beforeLlmWork, at most once per search: before its first paid step. */
  chargeOnce: () => Promise<void>;
  /** deps.shopCap or the default: the mode this search ranks under and keys its results by. */
  shopCap: ShopCapMode;
}

function searchLogEntry(
  q: string,
  filters: ParsedQuery,
  products: AliProduct[],
  response: SearchResponse,
  { meta, origin, run }: SearchRun,
): SearchLogEntry {
  return {
    query: q,
    queryNorm: normalizeQuery(q),
    parsed: filters,
    resultIds: products.map((p) => p.productId),
    cache: meta.cache,
    resultsCount: response.results.length,
    source: origin.source,
    categoryId: response.results[0]?.category_id ?? null,
    listable: isListableSearch(q, origin, response.results.length),
    ...telemetry(origin, meta, run),
  };
}

/** The row of a search that ended in an error: no results, never listed. */
function failedLogEntry(
  q: string,
  { meta, origin, run, filters }: SearchRun,
  failure: string,
): SearchLogEntry {
  return {
    query: q,
    queryNorm: normalizeQuery(q),
    parsed: filters,
    resultIds: [],
    cache: meta.cache,
    resultsCount: 0,
    source: origin.source,
    categoryId: null,
    listable: false,
    ...telemetry(origin, meta, run, failure),
  };
}

/**
 * The products of a search, ranked, linked and saved (so their /go links work), before the lines
 * that are still missing are written (docs/search-quality-plan.md item 15). A product without its
 * line yet shows AliExpress's title and the line built from the data until `final` brings its own.
 */
export interface ProductsReady {
  response: SearchResponse;
  /** Lines are still being written for some of the products shown. */
  pending: boolean;
}

/**
 * One search in stages, for a results page that streams: the chips once the query is understood,
 * the products once they are ranked, and the finished response once their lines are written and
 * the result set is cached. A stage rejects with the search's error when the search fails before
 * it; a stage that resolved stays resolved.
 */
export interface SearchStages {
  /** The uid of the search_log row this search writes (search_log.search_uid), known up front. */
  searchUid: string;
  understood: Promise<UnderstoodSearch>;
  products: Promise<ProductsReady>;
  /** The response with every line, once the result set is cached; the logs are written after. */
  final: Promise<SearchResponse>;
  /** The whole search, logs included: what runSearch returns. */
  outcome: Promise<SearchOutcome>;
}

interface Stage<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function stage<T>(): Stage<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A stage nobody waits for (the API route reads the final response only) is still handled.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

interface Stages {
  understood: Stage<UnderstoodSearch>;
  products: Stage<ProductsReady>;
  final: Stage<SearchResponse>;
}

function failStages(stages: Stages, err: unknown) {
  stages.understood.reject(err);
  stages.products.reject(err);
  stages.final.reject(err);
}

/**
 * Starts one search and returns its stages. Every search writes a search_log row: one that returns
 * a response (cached or not, with or without results), and one that fails after the query was
 * accepted (failure set to its code, see SearchDeps.failureOf). Every LLM call writes an llm_usage
 * row, also when the search then fails. Neither write can fail the search.
 */
export function startSearch(input: SearchInput, deps: SearchDeps): SearchStages {
  const run = startRun(deps);
  const stages: Stages = { understood: stage(), products: stage(), final: stage() };
  const outcome = runStages(input, deps, run, stages);
  outcome.catch((err: unknown) => failStages(stages, err));
  return {
    searchUid: run.uid,
    understood: stages.understood.promise,
    products: stages.products.promise,
    final: stages.final.promise,
    outcome,
  };
}

/** Runs one search to its end: startSearch without the stages (the API, previews, scripts). */
export function runSearch(input: SearchInput, deps: SearchDeps): Promise<SearchOutcome> {
  return startSearch(input, deps).outcome;
}

async function runStages(
  input: SearchInput,
  deps: SearchDeps,
  run: RunClock,
  stages: Stages,
): Promise<SearchOutcome> {
  const q = input.q.trim();
  if (!q || q.length > MAX_QUERY_LENGTH) {
    throw new SearchError("invalid_query", `query must be 1-${MAX_QUERY_LENGTH} characters`);
  }
  const meta = newMeta<"parse" | "explain">("none");
  let charged = false;
  const state: SearchRun = {
    deps,
    meta,
    run,
    origin: searchOrigin(input),
    filters: null,
    writeUsage: usageWriter(deps.store, meta),
    now: deps.now ?? (() => new Date()),
    sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    chargeOnce: async () => {
      if (charged) return;
      charged = true;
      await deps.beforeLlmWork?.();
    },
    shopCap: deps.shopCap ?? DEFAULT_SHOP_CAP_MODE,
  };
  try {
    return await search(q, input, state, stages);
  } catch (err) {
    // The page shows the failure at once; its row is written after.
    failStages(stages, err);
    await logFailure(deps.store, deps.failureOf, err, (f) => failedLogEntry(q, state, f));
    throw err;
  } finally {
    // A parse that failed twice, or an upstream error after the parse, was still paid for.
    await state.writeUsage();
  }
}

/** A result set to show, however it was found, and what finishing it needs. */
interface ViewPlan {
  source: "hit" | "derived" | "fetched";
  /** Its filters key (SearchResponse.filters_key). */
  key: string;
  filters: ParsedQuery;
  /** Ranked and linked, up to RESULTS_KEPT. A hit's order went through the safety net already. */
  products: AliProduct[];
  checked: number;
  passed: number;
  blockers?: FilterBlocker[];
  /** When the products were fetched from AliExpress (ISO). */
  createdAt: string;
  /** Lines written for these products as this result set shows them (a hit's own). */
  known: Record<string, Explanation>;
  /** Lines written for other results of the same pool: reused only where they hold. */
  reusable: Record<string, unknown>;
  /** A hit: the cached entry itself. */
  hit?: CachedResults;
  /** A view ranked from a pool: the result set that holds the pool. */
  base?: { key: string; entry: CachedResults };
  /** A fetch: what the pool of its result set is ranked from. */
  fetch?: { parsed: ParsedQuery; without: string[]; pool: AliProduct[] };
}

/** What finish() needs of the request beyond its plan. */
interface SearchContext {
  parsed: ParsedQuery;
  qk: string;
  without: string[];
}

async function search(
  q: string,
  input: SearchInput,
  state: SearchRun,
  stages: Stages,
): Promise<SearchOutcome> {
  const { deps, meta, run, now } = state;
  const without = input.without ?? [];

  // 1. Parse, from the 14-day parse cache when possible.
  const qk = queryKey(q);
  let parsed = await deps.store.getParse(qk, now());
  if (parsed) {
    meta.cache = "parse";
  } else {
    await state.chargeOnce();
    const res = await timed(run, meta, "parse_ms", async () => {
      try {
        return await parseQuery(withLimits(deps.llm, LLM_STAGE_LIMITS.parse), q);
      } catch (err) {
        // The model was not reached or did not answer in time: not the visitor's query, and not
        // AliExpress (item 7: the page says so instead of "AliExpress is not answering").
        throw new SearchError("llm", `parse call failed: ${errorText(err)}`, { cause: err });
      }
    });
    res.usage.forEach((u) => meta.llmUsage.push({ kind: "parse", usage: u, model: res.model }));
    if (!res.parsed) throw new SearchError("parse_failed", "could not understand the query");
    parsed = res.parsed;
    await deps.store.putParse(qk, normalizeQuery(q), parsed, now());
  }
  const filters: ParsedQuery = {
    ...applyOverrides(parsed, without),
    ...(input.sort ? { sort_preference: input.sort } : {}),
  };
  state.filters = filters;
  stages.understood.resolve(understoodOf(q, filters));

  // 2. The results: cached for exactly these filters (under this shop cap mode), ranked again from
  // a pool a fetch already checked (a sort change, a removed requirement; item 13), or fetched.
  const fk = filtersKey(filters, state.shopCap);
  const hit = await deps.store.getResults(fk, now());
  let plan: ViewPlan | null = null;
  if (hit) {
    meta.cache = "results";
    plan = hitPlan(hit, fk, filters);
  } else {
    plan = await derivedPlan(parsed, without, filters, fk, state);
    if (plan) {
      meta.cache = "results";
      meta.derived = true;
    } else {
      plan = await fetchedPlan(parsed, without, filters, fk, state);
    }
  }
  return finish(q, plan, state, stages, { parsed, qk, without });
}

function hitPlan(hit: CachedResults, key: string, filters: ParsedQuery): ViewPlan {
  return {
    source: "hit",
    key,
    filters,
    products: hit.products,
    checked: hit.checked,
    passed: hit.passed,
    ...(hit.blockers ? { blockers: hit.blockers } : {}),
    createdAt: hit.createdAt,
    known: hit.explanations,
    reusable: poolOf(hit)?.lines ?? {},
    hit,
  };
}

/**
 * The requested sort or removed requirements as a view of a pool a fetch already checked
 * (./pool.ts): first the result set fetched for exactly these chips, then the one fetched before
 * the requirements were removed. Null when neither holds the view, or the view would not be fresh
 * as a result set of its own (isFreshResults): the search then fetches, as it always did.
 */
async function derivedPlan(
  parsed: ParsedQuery,
  without: string[],
  filters: ParsedQuery,
  key: string,
  state: SearchRun,
): Promise<ViewPlan | null> {
  const { deps, meta, now } = state;
  const viewKey = viewKeyOf(filters.sort_preference, removedRequirements(parsed, without));
  const bases = [
    filtersKey(applyOverrides(parsed, without), state.shopCap),
    filtersKey(applyOverrides(parsed, removedPrices(parsed, without)), state.shopCap),
  ].filter((k, i, all) => k !== key && all.indexOf(k) === i);
  for (const baseKey of bases) {
    const base = await deps.store.getResults(baseKey, now());
    const found = base ? poolView(base, viewKey) : null;
    if (!base || !found) continue;
    if (!isFreshResults(new Date(base.createdAt), found.products.length, now())) continue;
    let products: AliProduct[];
    try {
      products = await ensureLinks(
        deps.ali,
        found.products,
        meta,
        state.sleep,
        deps.aliSpacingMs ?? 1_100,
      );
    } catch (err) {
      console.error(`[search] link.generate for a ranked view failed: ${errorText(err)}`);
      continue;
    }
    // None of them can be linked: a fetch fails as upstream then, never as "none passed".
    if (found.products.length && !products.length) continue;
    return {
      source: "derived",
      key,
      filters,
      products,
      checked: base.checked,
      passed: found.view.passed,
      ...(found.view.blockers ? { blockers: found.view.blockers } : {}),
      createdAt: base.createdAt,
      known: {},
      reusable: { ...base.explanations, ...poolOf(base)?.lines },
      base: { key: baseKey, entry: base },
    };
  }
  return null;
}

/** Fetch, filter, rank and link (charged first: the explain call follows). */
async function fetchedPlan(
  parsed: ParsedQuery,
  without: string[],
  filters: ParsedQuery,
  key: string,
  state: SearchRun,
): Promise<ViewPlan> {
  const { deps, meta, run, now, sleep } = state;
  await state.chargeOnce();
  let fetched: Fetched;
  try {
    fetched = await timed(run, meta, "fetch_ms", async () => {
      const aliSpacingMs = deps.aliSpacingMs ?? 1_100;
      const found = await fetchAndRank(
        filters,
        { ali: deps.ali, sleep, aliSpacingMs, now, shopCap: state.shopCap },
        meta,
      );
      const linked = await ensureLinks(deps.ali, found.ranked, meta, sleep, aliSpacingMs);
      // Products passed but none can be linked (link.generate answered without links): not "none
      // passed", which the page would then say; the search fails like any AliExpress failure.
      if (found.ranked.length && !linked.length) {
        throw new SearchError("upstream", "no product that passed could be linked");
      }
      return { ...found, ranked: linked };
    });
  } catch (err) {
    if (err instanceof AliExpressError) throw new SearchError("upstream", err.message);
    throw err;
  }
  const { ranked, passed, checked, pool } = fetched;
  return {
    source: "fetched",
    key,
    filters,
    products: ranked,
    checked,
    passed,
    // Fewer than a page: what kept the checked products out, for the results page (item 12).
    ...(ranked.length < RESULTS_PER_PAGE ? { blockers: blockersOf(pool, filters, passed) } : {}),
    createdAt: now().toISOString(),
    known: {},
    reusable: {},
    fetch: { parsed, without, pool },
  };
}

/** The result set of a plan with these products (in this order) and lines. */
function entryOf(
  plan: ViewPlan,
  products: AliProduct[],
  explanations: Record<string, Explanation>,
): CachedResults {
  return {
    filters: plan.filters,
    checked: plan.checked,
    passed: plan.passed,
    products,
    explanations,
    createdAt: plan.createdAt,
    ...(plan.blockers ? { blockers: plan.blockers } : {}),
  };
}

const titlesOf = (lines: Record<string, Explanation>) =>
  Object.fromEntries(Object.entries(lines).map(([id, e]) => [id, e.title_he]));

/** A result set's order after the first-page safety net (guardFirstPage). */
interface Guarded {
  ranked: AliProduct[];
  /** First-page products moved down. */
  demoted: string[];
  /** Products moved onto the first page, which had no line: they get the one from the data. */
  promoted: AliProduct[];
  /** Every line of the first page after the move. */
  explanations: Record<string, Explanation>;
}

/**
 * Safety net (plan item 2, lib/ranking/featured-guard.ts): a first-page product whose line says it
 * is not the searched product moves down; the model only marks, the code decides. A product that
 * moves up gets the sentence from the data (no extra call).
 */
function guardFirstPage(
  plan: ViewPlan,
  explained: Record<string, Explanation>,
  shopCap: ShopCapMode,
): Guarded {
  const guarded = demoteFlaggedLeads(
    plan.products,
    explained,
    plan.filters.product_he,
    RESULTS_PER_PAGE,
    shopCap,
  );
  const promoted = guarded.ranked.slice(0, RESULTS_PER_PAGE).filter((p) => !explained[p.productId]);
  return {
    ranked: guarded.ranked,
    demoted: guarded.demoted,
    promoted,
    explanations: { ...explained, ...explanationsFromData(promoted) },
  };
}

/**
 * Shows the products as soon as they are known, then writes the lines still missing (one explain
 * call for those only), applies the first-page safety net, caches the result set and logs it. A
 * result set whose first page needs no new line (a view whose lines all held) goes through the
 * safety net before its products show, so the page never shows an order it then takes back.
 */
async function finish(
  q: string,
  plan: ViewPlan,
  state: SearchRun,
  stages: Stages,
  ctx: SearchContext,
): Promise<SearchOutcome> {
  const { deps, meta, run, writeUsage } = state;
  const page = plan.products.slice(0, RESULTS_PER_PAGE);
  const { lines, reused } = linesForPage(page, plan);
  if (reused) meta.linesReused = reused;
  const missing = page.filter((p) => !lines[p.productId]);
  const fresh = plan.source === "fetched";
  // Every line is known: the final order is known too (a hit's went through the net when cached).
  const settled = !plan.hit && !missing.length ? guardFirstPage(plan, lines, state.shopCap) : null;

  // The rows the cards' /go links read, saved before the cards show, in one batch: every product a
  // fetch kept (RESULTS_KEPT, all linked: its later pages and /p's similar products need the rows
  // too, and the data is the fetch's own, so no call is added), the page of a ranked view (with a
  // product the safety net moved onto it), and a hit's products that were never shown. Titles only
  // where a line was written. Data from a pool keeps the time it was fetched (saveProducts'
  // checkedAt); titles written later are saved under the same time.
  const checkedAt = fresh ? undefined : new Date(plan.createdAt);
  const titledAt = checkedAt ?? state.now();
  const unsaved = plan.hit
    ? missing
    : fresh
      ? plan.products
      : [...page, ...(settled?.promoted ?? [])];
  if (unsaved.length) await deps.store.saveProducts(unsaved, titlesOf(lines), checkedAt);

  meta.timings.products_ms = Math.round(run.clock() - run.started);
  // SearchResponse.cached: no product.query call and no explain call for this response.
  const cached = !fresh && !missing.length;
  const shown = respond(
    q,
    plan.filters,
    settled
      ? entryOf(plan, settled.ranked, settled.explanations)
      : entryOf(plan, plan.products, { ...lines, ...explanationsFromData(missing) }),
    plan.key,
    cached,
  );
  stages.products.resolve({ response: shown, pending: missing.length > 0 });

  // A hit whose page was explained before: nothing else to do.
  if (plan.hit && !missing.length) {
    stages.final.resolve(shown);
    const log = searchLogEntry(q, plan.filters, plan.hit.products, shown, state);
    await Promise.all([quietly("logSearch", () => deps.store.logSearch(log)), writeUsage()]);
    return { response: shown, meta, log };
  }

  // The missing lines, while a fetch ranks the other views of its pool.
  const [added, pooled] = await Promise.all([
    missing.length ? explainMissing(plan, page, missing, state) : null,
    plan.fetch ? poolOfFetch(plan, plan.fetch, state) : null,
  ]);
  const written = added?.written ?? {};
  let guarded = settled;
  if (!guarded) {
    let explained = { ...lines, ...added?.lines };
    // Lines of different calls side by side: the same line twice says nothing about either. The
    // lines already on screen (reused) stay; a new one that repeats one of them falls back.
    if (!fresh) explained = withoutRepeats(page, explained, new Set(Object.keys(lines)));
    guarded = guardFirstPage(plan, explained, state.shopCap);
  }
  meta.demoted = guarded.demoted;
  const { ranked, promoted, explanations } = guarded;

  // Lines from the data after a failed explain call: kept 48 h only, then explained again.
  const degraded = meta.explainFailed || plan.hit?.degraded === true;
  const results: CachedResults = {
    ...(plan.hit ?? {}),
    ...entryOf(plan, ranked, { ...plan.hit?.explanations, ...explanations }),
    ...(degraded ? { degraded: true } : {}),
  };
  const response = respond(q, plan.filters, results, plan.key, cached);
  await Promise.all([
    cacheResults(q, plan, results, written, pooled, state, ctx),
    // A product the safety net moved onto the first page shows a card too (saved already when the
    // order was settled before the products showed, or with every product a fetch kept).
    promoted.length && !settled && !fresh ? deps.store.saveProducts(promoted, {}, checkedAt) : null,
  ]);
  stages.final.resolve(response);

  const log = searchLogEntry(q, plan.filters, ranked, response, state);
  const titled = missing.filter((p) => explanations[p.productId]?.title_he);
  await Promise.all([
    quietly("logSearch", () => deps.store.logSearch(log)),
    writeUsage(),
    titled.length
      ? quietly("saveProducts", () =>
          deps.store.saveProducts(titled, titlesOf(explanations), titledAt),
        )
      : null,
    // A parse whose own filters found nothing is kept as long as that empty result set (48 h), not
    // 14 days: the next search after that parses again. Chips removed are the visitor's choice.
    fresh && !ranked.length && !ctx.without.length
      ? quietly("putParse", () =>
          deps.store.putParse(
            ctx.qk,
            normalizeQuery(q),
            ctx.parsed,
            emptyParseCreatedAt(state.now()),
          ),
        )
      : null,
  ]);
  return { response, meta, log };
}

/**
 * The result sets a finished search writes. A fetch: its own, with the pool of every view it can
 * serve (./pool.ts), on the result set fetched for the parse's own sort (a fetch for another sort
 * writes that one too, its first page to be explained when it is first shown). A ranked view: its
 * own, and its new lines into the pool it came from. A hit: its added lines (not after a failed
 * explain call: the next request explains them, as "עוד N" does).
 */
async function cacheResults(
  q: string,
  plan: ViewPlan,
  results: CachedResults,
  written: Record<string, Explanation>,
  pooled: PooledFetch | null,
  { deps, meta, shopCap }: SearchRun,
  ctx: SearchContext,
): Promise<void> {
  const store = deps.store;
  const hasLines = Object.keys(written).length > 0;
  if (plan.hit) {
    if (meta.explainFailed) return;
    const pool = poolOf(plan.hit);
    await store.updateResults(plan.key, {
      ...results,
      ...(pool ? { pool: { ...pool, lines: { ...pool.lines, ...written } } } : {}),
    });
    return;
  }
  if (plan.base) {
    const pool = poolOf(plan.base.entry);
    await Promise.all([
      store.putResults(plan.key, q, results),
      pool && hasLines
        ? store.updateResults(plan.base.key, {
            ...plan.base.entry,
            pool: { ...pool, lines: { ...pool.lines, ...written } },
          })
        : null,
    ]);
    return;
  }
  if (!pooled) {
    await store.putResults(plan.key, q, results);
    return;
  }
  const baseKey = filtersKey(applyOverrides(ctx.parsed, ctx.without), shopCap);
  if (baseKey === plan.key) {
    await store.putResults(plan.key, q, {
      ...results,
      pool: poolFrom(pooled.views, results.products, plan.products, written),
    });
    return;
  }
  await Promise.all([
    store.putResults(plan.key, q, results),
    pooled.base
      ? store.putResults(baseKey, q, {
          ...pooled.base,
          pool: poolFrom(pooled.views, pooled.base.products, plan.products, written),
        })
      : null,
  ]);
}

/** A fetch's pool: every view it can serve, and the result set for the parse's own sort. */
interface PooledFetch {
  views: Map<string, RankedView>;
  /** Set when the fetch was made for another sort: the parse's own, linked, not explained yet. */
  base: CachedResults | null;
}

/** Lets the explain call and other requests run between two views being ranked. */
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Ranks every view of a fetch's pool (./pool.ts) one at a time, between turns of the event loop,
 * so the explain call started just before is not held up. The requested view is the one the search
 * ranked already. When the fetch was made for another sort than the parse's own, the result set
 * for the parse's sort is made too, its products linked like any shown product.
 */
async function poolOfFetch(
  plan: ViewPlan,
  fetch: NonNullable<ViewPlan["fetch"]>,
  state: SearchRun,
): Promise<PooledFetch> {
  const removed = removedRequirements(fetch.parsed, fetch.without);
  const own = viewKeyOf(plan.filters.sort_preference, removed);
  const views = new Map<string, RankedView>();
  for (const spec of viewSpecs(fetch.parsed, fetch.without)) {
    if (spec.key === own) {
      const ids = plan.products.map((p) => p.productId);
      const blockers = plan.blockers ? { blockers: plan.blockers } : {};
      views.set(own, { view: { ids, passed: plan.passed, ...blockers }, products: plan.products });
      continue;
    }
    await nextTurn();
    const ranked = rankView(fetch.pool, spec, RESULTS_KEPT, blockersOf, state.shopCap);
    if (ranked) views.set(spec.key, ranked);
  }
  const baseView = views.get(viewKeyOf(fetch.parsed.sort_preference, removed));
  if (fetch.parsed.sort_preference === plan.filters.sort_preference || !baseView) {
    return { views, base: null };
  }
  const linked = new Map(plan.products.map((p) => [p.productId, p]));
  let products: AliProduct[];
  try {
    products = await ensureLinks(
      state.deps.ali,
      baseView.products.map((p) => linked.get(p.productId) ?? p),
      state.meta,
      state.sleep,
      state.deps.aliSpacingMs ?? 1_100,
    );
  } catch (err) {
    console.error(`[search] link.generate for the parse's own sort failed: ${errorText(err)}`);
    return { views, base: null };
  }
  if (baseView.products.length && !products.length) return { views, base: null };
  return {
    views,
    base: {
      filters: applyOverrides(fetch.parsed, fetch.without),
      checked: plan.checked,
      passed: baseView.view.passed,
      products,
      explanations: {},
      createdAt: plan.createdAt,
      ...(baseView.view.blockers ? { blockers: baseView.view.blockers } : {}),
    },
  };
}

const isExplanation = (v: unknown): v is Explanation =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Explanation).why_he === "string" &&
  ((v as Explanation).title_he === null || typeof (v as Explanation).title_he === "string");

/**
 * A line written with other products, checked again for the ones it would be shown with: its
 * comparisons ("הזול מבין החמישה" holds only if it is the cheapest of these five), a caveat about a
 * requirement that was removed, and every other check of explain (checkExplanation). Null when it
 * fails, or when it is the line built from the data: that product is explained instead.
 */
export function lineThatHolds(
  line: unknown,
  p: ExplainInput,
  batch: readonly ExplainInput[],
  context: ExplainContext,
): Explanation | null {
  if (!isExplanation(line) || line.why_he === whyFromData(p)) return null;
  const checked = checkExplanation(
    { title_he: line.title_he ?? "", why_he: line.why_he },
    p,
    batch,
    context,
  );
  return checked.why_he === null ? null : { title_he: line.title_he, why_he: checked.why_he };
}

/**
 * The same line under two products of one page falls back to data (withoutRepeatedLines in
 * lib/llm/explain.ts), also when the two were written by different calls. The first one in page
 * order is kept, except that a line of `shown` (already on the visitor's screen) is never the one
 * that falls back.
 */
function withoutRepeats(
  page: AliProduct[],
  lines: Record<string, Explanation>,
  shown: ReadonlySet<string> = new Set(),
): Record<string, Explanation> {
  const inputs = page.map(toExplainInput);
  const items = page.flatMap((p, i) => {
    const e = lines[p.productId];
    if (!e) return [];
    const fromModel = e.why_he !== whyFromData(inputs[i]);
    return [{ product_id: p.productId, ...e, why_from_model: fromModel }];
  });
  const first = (item: { product_id: string }) => (shown.has(item.product_id) ? 0 : 1);
  const ordered = [...items].sort((a, b) => first(a) - first(b));
  const out = { ...lines };
  for (const item of withoutRepeatedLines(ordered, inputs)) {
    out[item.product_id] = { title_he: item.title_he, why_he: item.why_he };
  }
  return out;
}

/**
 * The lines the page can show at once: its own (a hit's), then lines written for other results of
 * the same pool that hold for this page (lineThatHolds) and repeat none of the others. A product
 * left without one is explained.
 */
function linesForPage(
  page: AliProduct[],
  plan: ViewPlan,
): { lines: Record<string, Explanation>; reused: number } {
  const batch = page.map(toExplainInput);
  const context = explainContextFrom(plan.filters);
  const lines: Record<string, Explanation> = {};
  const reused = new Set<string>();
  page.forEach((p, i) => {
    const own = plan.known[p.productId];
    if (own) {
      lines[p.productId] = own;
      return;
    }
    const earlier = lineThatHolds(plan.reusable[p.productId], batch[i], batch, context);
    if (earlier) {
      lines[p.productId] = earlier;
      reused.add(p.productId);
    }
  });
  if (!reused.size) return { lines, reused: 0 };
  const distinct = withoutRepeats(page, lines);
  for (const id of reused) {
    if (distinct[id].why_he !== lines[id].why_he) {
      delete lines[id];
      reused.delete(id);
    }
  }
  return { lines, reused: reused.size };
}

/**
 * One explain call for the page's products without a line. Out of budget, a result set that needed
 * no fetch shows the lines from the data instead of failing (a fetch was charged before it ran).
 * The call compares its products only with each other, so when the page also shows lines written
 * earlier, each new line is checked again with the whole page. `written` holds the call's own
 * lines (not the ones built from the data), for the pool.
 */
async function explainMissing(
  plan: ViewPlan,
  page: AliProduct[],
  missing: AliProduct[],
  state: SearchRun,
): Promise<{ lines: Record<string, Explanation>; written: Record<string, Explanation> }> {
  const { deps, meta, run } = state;
  try {
    await state.chargeOnce();
  } catch (err) {
    if (plan.source === "fetched") throw err;
    if (!(err instanceof SearchError && err.code === "capacity")) {
      console.error(`[search] budget check failed, lines from the data: ${errorText(err)}`);
    }
    meta.explainFailed = true;
    return { lines: explanationsFromData(missing), written: {} };
  }
  const added = await timed(run, meta, "explain_ms", () =>
    explainOrFallback(deps.llm, plan.filters, missing, meta, (call) =>
      meta.llmUsage.push({ kind: "explain", ...call }),
    ),
  );
  if (meta.explainFailed) return { lines: added, written: {} };
  const written = Object.fromEntries(
    missing.flatMap((p) => {
      const e = added[p.productId];
      return e && e.why_he !== whyFromData(toExplainInput(p)) ? [[p.productId, e]] : [];
    }),
  );
  if (missing.length === page.length) return { lines: added, written };
  const batch = page.map(toExplainInput);
  const context = explainContextFrom(plan.filters);
  const lines: Record<string, Explanation> = {};
  for (const p of missing) {
    const input = toExplainInput(p);
    const line = added[p.productId] ?? { title_he: null, why_he: whyFromData(input) };
    if (!written[p.productId]) {
      lines[p.productId] = line;
      continue;
    }
    const holds = lineThatHolds(line, input, batch, context);
    if (!holds) {
      meta.explainRejected.push({
        product_id: p.productId,
        rejected: { why_he: line.why_he, why_problem: "not_for_page" },
      });
    }
    lines[p.productId] = holds ?? { title_he: line.title_he, why_he: whyFromData(input) };
  }
  return { lines, written };
}

/**
 * The created_at that makes a parse expire EMPTY_RESULTS_TTL_HOURS after `now` under the
 * CACHE_TTL_HOURS rule every store applies (isFresh).
 */
export function emptyParseCreatedAt(now: Date): Date {
  return new Date(now.getTime() - (CACHE_TTL_HOURS - EMPTY_RESULTS_TTL_HOURS) * 3_600_000);
}

export interface MoreOutcome {
  results: ResultProduct[];
  more_available: boolean;
  /** When the cached result set was fetched from AliExpress (ISO), as SearchResponse.fetched_at. */
  fetched_at: string;
  meta: SearchMeta<"explain_more">;
  /** The search_log row written for this page, or null for an empty page (nothing is logged). */
  log: SearchLogEntry | null;
}

/**
 * "עוד N אפשרויות": explains the next page of an existing cached result set. A page with results
 * writes a search_log row (source "more"; the request carries only the filters key, so the query
 * column holds the result set's Hebrew product label). Its explain call goes to llm_usage as
 * "explain_more". A page that fails after the result set was found writes a row too (failure set).
 */
export async function loadMore(
  fk: string,
  page: number,
  deps: Pick<
    SearchDeps,
    "llm" | "store" | "now" | "beforeLlmWork" | "clockMs" | "newSearchUid" | "failureOf"
  >,
  { owner = false }: { owner?: boolean } = {},
): Promise<MoreOutcome | null> {
  const now = deps.now ?? (() => new Date());
  const run = startRun(deps);
  const cached = await deps.store.getResults(fk, now());
  if (!cached) return null;
  const meta = newMeta<"explain_more">("results");
  const writeUsage = usageWriter(deps.store, meta);
  const origin: SearchOrigin = {
    source: "more",
    without: [],
    typed: false,
    ...(owner ? { owner: true } : {}),
  };
  const label = cached.filters.product_he;
  const row = {
    query: label,
    queryNorm: normalizeQuery(label),
    parsed: cached.filters,
    cache: "results",
    source: "more",
    listable: false, // never on /searches
  } as const;
  try {
    const start = page * RESULTS_PER_PAGE;
    const slice = cached.products.slice(start, start + RESULTS_PER_PAGE);
    const missing = slice.filter((p) => !cached.explanations[p.productId]);
    let fallback: Record<string, Explanation> = {};
    if (missing.length) {
      await deps.beforeLlmWork?.();
      const added = await timed(run, meta, "explain_ms", () =>
        explainOrFallback(deps.llm, cached.filters, missing, meta, (call) =>
          meta.llmUsage.push({ kind: "explain_more", ...call }),
        ),
      );
      if (meta.explainFailed) {
        // Shown once and not saved: the next request for this page explains it again.
        fallback = added;
      } else {
        Object.assign(cached.explanations, added);
        await deps.store.updateResults(fk, cached);
      }
      // The product data is as old as the cached result set: the rows must say so (/p, /coupons
      // and /go read updated_at as when the price, promo code and link were checked). Saved after
      // a failed explain too: the cards' /go links need the rows.
      await deps.store.saveProducts(
        missing,
        Object.fromEntries(Object.entries(added).map(([id, e]) => [id, e.title_he])),
        new Date(cached.createdAt),
      );
    }
    const results = slice.map((p) =>
      toResultProduct(p, cached.explanations[p.productId] ?? fallback[p.productId]),
    );
    const log: SearchLogEntry | null = results.length
      ? {
          ...row,
          resultIds: slice.map((p) => p.productId),
          resultsCount: results.length,
          categoryId: slice[0].category.firstId,
          ...telemetry(origin, meta, run),
        }
      : null;
    await Promise.all([log && quietly("logSearch", () => deps.store.logSearch(log)), writeUsage()]);
    return {
      results,
      more_available: cached.products.length > start + RESULTS_PER_PAGE,
      fetched_at: cached.createdAt,
      meta,
      log,
    };
  } catch (err) {
    await logFailure(deps.store, deps.failureOf, err, (failure) => ({
      ...row,
      resultIds: [],
      resultsCount: 0,
      categoryId: null,
      ...telemetry(origin, meta, run, failure),
    }));
    throw err;
  } finally {
    await writeUsage();
  }
}
