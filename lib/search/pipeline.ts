// The search pipeline (CLAUDE.md §6). The LLM parses and explains; code fetches, filters, ranks
// and links. Rate limiting and the daily kill switch live in the API layer, not here.
import { generateLinks, queryProducts, type ProductSort } from "@/lib/aliexpress/affiliate";
import type { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { explainContextFrom, explainProducts, type ExplainInput } from "@/lib/llm/explain";
import { parseQuery } from "@/lib/llm/parse";
import type { LlmProvider } from "@/lib/llm/provider";
import {
  rankProducts,
  rankWithFill,
  rejectionCounts,
  trustTierOf,
  type RejectReason,
} from "@/lib/ranking/rank";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { isListableQuery } from "@/lib/recent/privacy";
import type { LlmCallKind, LlmUsageRecord } from "@/lib/stats/usage";
import type { ResultProduct, SearchResponse } from "@/lib/types";
import { filtersKey, normalizeQuery, queryKey } from "./cache-key";
import { applyOverrides, buildChips } from "./chips";
import type { ParsedQuery, SortPreference } from "./filters";
import type {
  CachedResults,
  CacheLevel,
  Explanation,
  SearchLogEntry,
  SearchSource,
  SearchStore,
} from "./store";

export const MAX_QUERY_LENGTH = 200;
/** How many ranked products we keep per search: the first 3 plus "show 3 more", with spares. */
export const RESULTS_KEPT = 12;
const MAX_ALI_CALLS = 3;
const FILLER = new Set(["durable", "quality", "best", "good", "new", "premium", "hot", "cheap"]);

export type SearchErrorCode =
  | "invalid_query"
  | "parse_failed"
  | "upstream"
  /** The daily LLM budget (DAILY_SEARCH_CAP) is used up; cached results are still served. */
  | "capacity";

export class SearchError extends Error {
  constructor(
    public readonly code: SearchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SearchError";
  }
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
   * The visitor typed the query (default). False when it came from one of our own links (a
   * recent-search card, an example query): logged as usual, never listed on /searches.
   */
  typed?: boolean;
}

/** An LLM call recorded by the pipeline; K narrows the jobs one entry point can make. */
export type UsageOf<K extends LlmCallKind> = Omit<LlmUsageRecord, "kind"> & { kind: K };

/** A search makes parse and explain calls; "show more" (loadMore) makes explain_more calls. */
export interface SearchMeta<K extends LlmCallKind = "parse" | "explain"> {
  cache: CacheLevel;
  /** Every LLM call made, also written to llm_usage (SearchStore.logUsage). */
  llmUsage: UsageOf<K>[];
  aliCalls: number;
  rejected: Record<RejectReason, number> | null;
  keywordsTried: string[];
  /** Explain lines that failed a check and fell back (for evals and logs, never shown). */
  explainRejected: { product_id: string; rejected: unknown }[];
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
  rejected: null,
  keywordsTried: [],
  explainRejected: [],
});

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

/** Fallback keyword sets, most specific first (keyword ladder). */
export function keywordLadder(parsed: ParsedQuery): string[] {
  const primary = parsed.keywords_en.trim();
  const reqTokens = new Set(
    parsed.requirements
      .flatMap((r) => [r.en, ...r.alt])
      .flatMap((s) => s.toLowerCase().split(/\s+/)),
  );
  const reduced = primary
    .split(/\s+/)
    .filter((w) => !reqTokens.has(w.toLowerCase()) && !FILLER.has(w.toLowerCase()))
    .join(" ");
  const ladder = [primary];
  if (reduced.split(" ").length >= 2 && reduced !== primary) ladder.push(reduced);
  const hint = parsed.category_hint?.trim();
  if (hint && hint.split(/\s+/).length >= 2 && !ladder.includes(hint)) ladder.push(hint);
  return ladder;
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

async function fetchAndRank(
  parsed: ParsedQuery,
  deps: Required<Pick<SearchDeps, "ali" | "sleep" | "aliSpacingMs">>,
  meta: SearchMeta,
): Promise<{ ranked: AliProduct[]; passed: number; checked: number }> {
  const seen = new Map<string, AliProduct>();
  let ranked: AliProduct[] = [];
  const call = async (keywords: string, pageNo: number) => {
    if (meta.aliCalls > 0) await deps.sleep(deps.aliSpacingMs);
    meta.aliCalls++;
    meta.keywordsTried.push(pageNo > 1 ? `${keywords} (p${pageNo})` : keywords);
    const page = await queryProducts(deps.ali, {
      keywords,
      pageNo,
      minPriceIls: parsed.min_price_ils,
      maxPriceIls: parsed.max_price_ils,
      sort: FETCH_SORT,
    });
    for (const p of page.products) if (!seen.has(p.productId)) seen.set(p.productId, p);
    ranked = rankProducts([...seen.values()], parsed);
    return page;
  };

  const ladder = keywordLadder(parsed);
  const first = await call(ladder[0], 1);
  meta.rejected = rejectionCounts([...seen.values()], parsed);
  // Page 2 only when page 1 was full, more exist, and relevance (not trust) is what limited us.
  const r = meta.rejected;
  if (
    ranked.length < 2 * RESULTS_PER_PAGE &&
    first.products.length >= 50 &&
    (first.totalRecords ?? 0) > 50 &&
    r.type + r.requirement >= r.feedback + r.volume &&
    meta.aliCalls < MAX_ALI_CALLS
  ) {
    await call(ladder[0], 2);
  }
  for (const keywords of ladder.slice(1)) {
    if (ranked.length >= RESULTS_PER_PAGE || meta.aliCalls >= MAX_ALI_CALLS) break;
    await call(keywords, 1);
  }
  meta.rejected = rejectionCounts([...seen.values()], parsed);
  // Too few met FILTERS: top up to one page from the second trust tier (FILL_TIER).
  const final = rankWithFill([...seen.values()], parsed, RESULTS_PER_PAGE);
  // passed counts every distinct product that met the filters, not just the ones we keep.
  return {
    ranked: final.ranked.slice(0, RESULTS_KEPT),
    passed: final.ranked.length,
    checked: seen.size,
  };
}

/** Makes sure every product we may show has an affiliate link (§6.7). */
async function ensureLinks(ali: AliExpressClient, products: AliProduct[]): Promise<AliProduct[]> {
  const missing = products.filter((p) => !p.promotionLink);
  if (!missing.length) return products;
  const links = await generateLinks(
    ali,
    missing.map((p) => `https://www.aliexpress.com/item/${p.productId}.html`),
  );
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
  const res = await explainProducts(llm, explainContextFrom(parsed), products.map(toExplainInput));
  recordCall({ usage: res.usage, model: res.model });
  for (const i of res.items) {
    if (i.rejected) meta.explainRejected.push({ product_id: i.product_id, rejected: i.rejected });
  }
  return Object.fromEntries(
    res.items.map((i) => [i.product_id, { title_he: i.title_he, why_he: i.why_he }]),
  );
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
  };
}

/** How a search was asked for: what decides whether /searches may list it (isListableSearch). */
export interface SearchOrigin {
  source: SearchSource;
  /** Chip ids removed. */
  without: readonly string[];
  /** Sort chosen with the refine buttons, if any. */
  sort?: SortPreference;
  /** False for a query from one of our own links (SearchInput.typed). */
  typed: boolean;
}

/**
 * Whether a search may appear on the public recent-searches page (/searches): only a query the
 * visitor typed (source "search", not from one of our links, no chips removed, no sort override,
 * so the card's link rebuilds exactly these filters) that showed results, and only when the query
 * passes the privacy check (no phone or ID numbers, emails, links or handles).
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

function searchLogEntry(
  q: string,
  filters: ParsedQuery,
  products: AliProduct[],
  response: SearchResponse,
  cache: CacheLevel,
  origin: SearchOrigin,
): SearchLogEntry {
  return {
    query: q,
    queryNorm: normalizeQuery(q),
    parsed: filters,
    resultIds: products.map((p) => p.productId),
    cache,
    resultsCount: response.results.length,
    source: origin.source,
    categoryId: response.results[0]?.category_id ?? null,
    listable: isListableSearch(q, origin, response.results.length),
  };
}

/**
 * Runs one search. Every search that returns a response (cached or not, with or without results)
 * writes a search_log row, and every LLM call writes an llm_usage row, also when the search then
 * fails. Neither write can fail the search.
 */
export async function runSearch(input: SearchInput, deps: SearchDeps): Promise<SearchOutcome> {
  const q = input.q.trim();
  if (!q || q.length > MAX_QUERY_LENGTH) {
    throw new SearchError("invalid_query", `query must be 1-${MAX_QUERY_LENGTH} characters`);
  }
  const meta = newMeta<"parse" | "explain">("none");
  const writeUsage = usageWriter(deps.store, meta);
  try {
    return await search(q, input, deps, meta, writeUsage);
  } finally {
    // A parse that failed twice, or an upstream error after the parse, was still paid for.
    await writeUsage();
  }
}

async function search(
  q: string,
  input: SearchInput,
  deps: SearchDeps,
  meta: SearchMeta,
  writeUsage: () => Promise<void>,
): Promise<SearchOutcome> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const without = input.without ?? [];
  const origin: SearchOrigin = {
    source: input.source ?? "search",
    without,
    sort: input.sort,
    typed: input.typed ?? true,
  };
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
    const res = await parseQuery(deps.llm, q);
    res.usage.forEach((u) => meta.llmUsage.push({ kind: "parse", usage: u, model: res.model }));
    if (!res.parsed) throw new SearchError("parse_failed", "could not understand the query");
    parsed = res.parsed;
    await deps.store.putParse(qk, normalizeQuery(q), parsed, now());
  }
  const filters: ParsedQuery = {
    ...applyOverrides(parsed, without),
    ...(input.sort ? { sort_preference: input.sort } : {}),
  };

  // 2. Results, from the 14-day filters cache when possible.
  const fk = filtersKey(filters);
  const hit = await deps.store.getResults(fk, now());
  if (hit) {
    meta.cache = "results";
    const response = respond(q, filters, hit, fk, true);
    const log = searchLogEntry(q, filters, hit.products, response, meta.cache, origin);
    await Promise.all([quietly("logSearch", () => deps.store.logSearch(log)), writeUsage()]);
    return { response, meta, log };
  }

  // 3. Fetch, filter, rank, link, explain the first page.
  await chargeOnce();
  let ranked: AliProduct[];
  let checked: number;
  let passed: number;
  try {
    ({ ranked, passed, checked } = await fetchAndRank(
      filters,
      { ali: deps.ali, sleep, aliSpacingMs: deps.aliSpacingMs ?? 1_100 },
      meta,
    ));
    ranked = await ensureLinks(deps.ali, ranked);
  } catch (err) {
    if (err instanceof AliExpressError) throw new SearchError("upstream", err.message);
    throw err;
  }
  const explanations = await explainRange(
    deps.llm,
    filters,
    ranked.slice(0, RESULTS_PER_PAGE),
    meta,
    (call) => meta.llmUsage.push({ kind: "explain", ...call }),
  );

  const results: CachedResults = {
    filters,
    checked,
    passed,
    products: ranked,
    explanations,
    createdAt: now().toISOString(),
  };
  const response = respond(q, filters, results, fk, false);
  const log = searchLogEntry(q, filters, ranked, response, meta.cache, origin);
  await Promise.all([
    deps.store.putResults(fk, q, results),
    quietly("logSearch", () => deps.store.logSearch(log)),
    writeUsage(),
    deps.store.saveProducts(
      ranked.slice(0, RESULTS_PER_PAGE),
      Object.fromEntries(Object.entries(explanations).map(([id, e]) => [id, e.title_he])),
    ),
  ]);
  return { response, meta, log };
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
 * "explain_more".
 */
export async function loadMore(
  fk: string,
  page: number,
  deps: Pick<SearchDeps, "llm" | "store" | "now" | "beforeLlmWork">,
): Promise<MoreOutcome | null> {
  const now = deps.now ?? (() => new Date());
  const cached = await deps.store.getResults(fk, now());
  if (!cached) return null;
  const meta = newMeta<"explain_more">("results");
  const writeUsage = usageWriter(deps.store, meta);
  try {
    const start = page * RESULTS_PER_PAGE;
    const slice = cached.products.slice(start, start + RESULTS_PER_PAGE);
    const missing = slice.filter((p) => !cached.explanations[p.productId]);
    if (missing.length) {
      await deps.beforeLlmWork?.();
      const added = await explainRange(deps.llm, cached.filters, missing, meta, (call) =>
        meta.llmUsage.push({ kind: "explain_more", ...call }),
      );
      Object.assign(cached.explanations, added);
      await deps.store.updateResults(fk, cached);
      await deps.store.saveProducts(
        missing,
        Object.fromEntries(Object.entries(added).map(([id, e]) => [id, e.title_he])),
      );
    }
    const results = slice.map((p) => toResultProduct(p, cached.explanations[p.productId]));
    const label = cached.filters.product_he;
    const log: SearchLogEntry | null = results.length
      ? {
          query: label,
          queryNorm: normalizeQuery(label),
          parsed: cached.filters,
          resultIds: slice.map((p) => p.productId),
          cache: "results",
          resultsCount: results.length,
          source: "more",
          categoryId: slice[0].category.firstId,
          listable: false,
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
  } finally {
    await writeUsage();
  }
}
