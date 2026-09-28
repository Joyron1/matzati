// The search pipeline (CLAUDE.md §6). The LLM parses and explains; code fetches, filters, ranks
// and links. Rate limiting and the daily kill switch live in the API layer, not here.
import { generateLinks, queryProducts, type ProductSort } from "@/lib/aliexpress/affiliate";
import type { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import {
  explainContextFrom,
  explainProducts,
  whyFromData,
  type ExplainInput,
} from "@/lib/llm/explain";
import { parseQuery } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest } from "@/lib/llm/provider";
import { usefulRelaxations } from "@/lib/ranking/blockers";
import { demoteFlaggedLeads } from "@/lib/ranking/featured-guard";
import { rankWithFill, rejectionCounts, trustTierOf, type RejectReason } from "@/lib/ranking/rank";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { isListableQuery } from "@/lib/recent/privacy";
import type { SearchArrival } from "@/lib/search-url";
import type { LlmCallKind, LlmUsageRecord } from "@/lib/stats/usage";
import type { FilterBlocker, ResultProduct, SearchResponse } from "@/lib/types";
import {
  CACHE_TTL_HOURS,
  EMPTY_RESULTS_TTL_HOURS,
  filtersKey,
  normalizeQuery,
  queryKey,
} from "./cache-key";
import { applyOverrides, buildChips } from "./chips";
import { lowestUnitsSold, nextFetch, type FetchedPage, type FetchStop } from "./fetch-policy";
import type { ParsedQuery, SortPreference } from "./filters";
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
/** How many ranked products we keep per search: the first 3 plus "show 3 more", with spares. */
export const RESULTS_KEPT = 12;

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
function withLimits(
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
  /** A signed-in admin (the owner) asked: logged with owner true, never listed on /searches. */
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
  timings: { parse_ms: null, fetch_ms: null, explain_ms: null },
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
function errorText(err: unknown): string {
  return (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300);
}

function toExplainInput(p: AliProduct): ExplainInput {
  return {
    product_id: p.productId,
    title_en: p.title,
    price_ils: p.price,
    original_price_ils: p.originalPrice,
    discount_pct: p.discountPct,
    positive_feedback_pct: p.positiveFeedbackPct,
    units_sold_30d: p.unitsSold,
  };
}

export function toResultProduct(p: AliProduct, e: Explanation | undefined): ResultProduct {
  return {
    product_id: p.productId,
    title_he: e?.title_he ?? p.title,
    title_en: p.title,
    why_he: e?.why_he ?? "",
    price_ils: p.price,
    original_price_ils: p.originalPrice,
    price_is_approx: p.currency !== "ILS",
    discount_pct: p.discountPct,
    positive_feedback_pct: p.positiveFeedbackPct,
    units_sold: p.unitsSold,
    passed_tier: trustTierOf(p),
    image_urls: p.imageUrls,
    category_id: p.category.firstId,
  };
}

interface Fetched {
  ranked: AliProduct[];
  passed: number;
  checked: number;
  /** Every distinct product checked (for the blockers of a search with too few results). */
  pool: AliProduct[];
}

/**
 * Fetches by the fetch policy (./fetch-policy.ts), then filters and ranks everything found. Only
 * the first call can fail the search: a later call that fails (AliExpress's quota is shared by
 * every visitor) keeps what was found so far, and no call after the first starts once the step
 * has run FETCH_BUDGET_MS.
 */
async function fetchAndRank(
  parsed: ParsedQuery,
  deps: Required<Pick<SearchDeps, "ali" | "sleep" | "aliSpacingMs" | "now">>,
  meta: SearchMeta,
): Promise<Fetched> {
  const seen = new Map<string, AliProduct>();
  const calls: FetchedPage[] = [];
  const started = deps.now().getTime();
  for (;;) {
    const decision = nextFetch({ filters: parsed, calls, pool: [...seen.values()] });
    if ("stop" in decision) {
      meta.fetchStop = decision.stop;
      break;
    }
    if (calls.length && deps.now().getTime() - started >= FETCH_BUDGET_MS) {
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
  const final = rankWithFill(pool, parsed, RESULTS_PER_PAGE);
  // passed counts every distinct product that met the filters, not just the ones we keep.
  return {
    ranked: final.ranked.slice(0, RESULTS_KEPT),
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
async function ensureLinks(
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

function respond(
  q: string,
  filters: ParsedQuery,
  cached: CachedResults,
  key: string,
  fromCache: boolean,
): SearchResponse {
  const shown = cached.products.slice(0, RESULTS_PER_PAGE);
  return {
    query: q,
    chips: buildChips(filters),
    sort: filters.sort_preference,
    checked_count: cached.checked,
    passed_count: cached.passed,
    results: shown.map((p) => toResultProduct(p, cached.explanations[p.productId])),
    more_available: cached.products.length > RESULTS_PER_PAGE,
    filters_key: key,
    cached: fromCache,
    fetched_at: cached.createdAt,
    ...(cached.blockers ? { blockers: cached.blockers } : {}),
    // From this request's parse, like the chips: a need we could not check is never hidden.
    ...(filters.preferences?.length ? { not_filtered: filters.preferences.map((p) => p.he) } : {}),
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
  "fetchStop" | "keywordsTried" | "demoted" | "explainFailed" | "explainRejected"
>;

/**
 * search_log.diag for a request that fetched or explained something itself (SearchDiag), null for
 * a full cache hit or a failure before any of it.
 */
export function diagOf(meta: DiagMeta): SearchDiag | null {
  const fetched = meta.fetchStop !== null && meta.fetchStop !== undefined;
  const explained = meta.explainFailed === true || meta.explainRejected.length > 0;
  if (!fetched && !explained && !meta.demoted?.length) return null;
  return {
    fetch_stop: meta.fetchStop ?? null,
    keywords_tried: [...meta.keywordsTried],
    demoted: [...(meta.demoted ?? [])],
    explain_failed: meta.explainFailed === true,
    explain_rejected: meta.explainRejected.length,
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
 * so the card's link rebuilds exactly these filters; never the owner's own) that showed results,
 * and only when the query passes the privacy check (no phone or ID numbers, emails, links or
 * handles).
 */
export function isListableSearch(q: string, origin: SearchOrigin, resultsCount: number): boolean {
  return (
    origin.source === "search" &&
    origin.owner !== true &&
    origin.typed &&
    origin.without.length === 0 &&
    origin.sort === undefined &&
    resultsCount > 0 &&
    isListableQuery(q)
  );
}

/** The state of one runSearch call, shared by its steps and its failure row. */
interface SearchRun {
  deps: SearchDeps;
  meta: SearchMeta;
  run: RunClock;
  origin: SearchOrigin;
  /** The filters once known (null while parsing), for the failure row. */
  filters: ParsedQuery | null;
  writeUsage: () => Promise<void>;
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
 * Runs one search. Every search writes a search_log row: one that returns a response (cached or
 * not, with or without results), and one that fails after the query was accepted (failure set to
 * its code, see SearchDeps.failureOf). Every LLM call writes an llm_usage row, also when the search
 * then fails. Neither write can fail the search.
 */
export async function runSearch(input: SearchInput, deps: SearchDeps): Promise<SearchOutcome> {
  const q = input.q.trim();
  if (!q || q.length > MAX_QUERY_LENGTH) {
    throw new SearchError("invalid_query", `query must be 1-${MAX_QUERY_LENGTH} characters`);
  }
  const meta = newMeta<"parse" | "explain">("none");
  const state: SearchRun = {
    deps,
    meta,
    run: startRun(deps),
    origin: searchOrigin(input),
    filters: null,
    writeUsage: usageWriter(deps.store, meta),
  };
  try {
    return await search(q, input, state);
  } catch (err) {
    await logFailure(deps.store, deps.failureOf, err, (f) => failedLogEntry(q, state, f));
    throw err;
  } finally {
    // A parse that failed twice, or an upstream error after the parse, was still paid for.
    await state.writeUsage();
  }
}

async function search(q: string, input: SearchInput, state: SearchRun): Promise<SearchOutcome> {
  const { deps, meta, run, writeUsage } = state;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const without = input.without ?? [];
  let charged = false;
  const chargeOnce = async () => {
    if (charged) return;
    charged = true;
    await deps.beforeLlmWork?.();
  };

  // 1. Parse, from the 14-day parse cache when possible.
  const qk = queryKey(q);
  let parsed = await deps.store.getParse(qk, now());
  if (parsed) {
    meta.cache = "parse";
  } else {
    await chargeOnce();
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

  // 2. Results, from the 14-day filters cache when possible.
  const fk = filtersKey(filters);
  const hit = await deps.store.getResults(fk, now());
  if (hit) {
    meta.cache = "results";
    const response = respond(q, filters, hit, fk, true);
    const log = searchLogEntry(q, filters, hit.products, response, state);
    await Promise.all([quietly("logSearch", () => deps.store.logSearch(log)), writeUsage()]);
    return { response, meta, log };
  }

  // 3. Fetch, filter, rank, link, explain the first page.
  await chargeOnce();
  let fetched: Fetched;
  try {
    fetched = await timed(run, meta, "fetch_ms", async () => {
      const aliSpacingMs = deps.aliSpacingMs ?? 1_100;
      const found = await fetchAndRank(filters, { ali: deps.ali, sleep, aliSpacingMs, now }, meta);
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
  const { passed, checked, pool } = fetched;
  const explained = await timed(run, meta, "explain_ms", () =>
    explainOrFallback(deps.llm, filters, fetched.ranked.slice(0, RESULTS_PER_PAGE), meta, (call) =>
      meta.llmUsage.push({ kind: "explain", ...call }),
    ),
  );
  // Safety net (plan item 2, lib/ranking/featured-guard.ts): a first-page product whose line says
  // it is not the searched product moves down; the model only marks, the code decides. A product
  // that moves up gets the sentence from the data (no extra call).
  const guarded = demoteFlaggedLeads(
    fetched.ranked,
    explained,
    filters.product_he,
    RESULTS_PER_PAGE,
  );
  meta.demoted = guarded.demoted;
  const ranked = guarded.ranked;
  const promoted = ranked.slice(0, RESULTS_PER_PAGE).filter((p) => !explained[p.productId]);
  const explanations = { ...explained, ...explanationsFromData(promoted) };

  const results: CachedResults = {
    filters,
    checked,
    passed,
    products: ranked,
    explanations,
    createdAt: now().toISOString(),
    // Fewer than a page: what kept the checked products out, for the results page (item 12).
    ...(ranked.length < RESULTS_PER_PAGE ? { blockers: blockersOf(pool, filters, passed) } : {}),
    // Lines from the data after a failed explain call: kept 48 h only, then explained again.
    ...(meta.explainFailed ? { degraded: true } : {}),
  };
  const response = respond(q, filters, results, fk, false);
  const log = searchLogEntry(q, filters, ranked, response, state);
  await Promise.all([
    deps.store.putResults(fk, q, results),
    quietly("logSearch", () => deps.store.logSearch(log)),
    writeUsage(),
    // Every explained product: the first page, and any the safety net moved down (its "more" page
    // finds it explained and would not save it, and /go needs the row).
    deps.store.saveProducts(
      ranked.filter((p) => explanations[p.productId]),
      Object.fromEntries(Object.entries(explanations).map(([id, e]) => [id, e.title_he])),
    ),
    // A parse whose own filters found nothing is kept as long as that empty result set (48 h), not
    // 14 days: the next search after that parses again. Chips removed are the visitor's choice.
    !ranked.length && !without.length
      ? deps.store.putParse(qk, normalizeQuery(q), parsed, emptyParseCreatedAt(now()))
      : null,
  ]);
  return { response, meta, log };
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
 * "עוד 3 אפשרויות": explains the next page of an existing cached result set. A page with results
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
