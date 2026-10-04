// Server-only entry points used by pages and route handlers. Builds the pipeline deps from env on
// every call (LLM provider, AliExpress client, SupabaseStore) and applies the guards: the per-IP
// rate limit and the daily LLM budget (DAILY_SEARCH_CAP). Failures come back as codes; stack
// traces and error messages never reach the caller.
import "server-only";
import { APIError as LlmApiError } from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { cache } from "react";
import { z } from "zod";
import {
  HOT_LINK_TYPE,
  STANDARD_LINK_TYPE,
  generateLinks,
  getProductDetails,
  getSkuDetails,
  itemSourceUrl,
  type PromotionLinkType,
} from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import {
  isPromoCodeCurrent,
  readStoredPromoCode,
  type AliPromoCode,
} from "@/lib/aliexpress/promo-code";
import {
  affiliateUrl,
  mediaUrl,
  type AliProduct,
  type AliSkuDetails,
} from "@/lib/aliexpress/schemas";
import {
  LINK_MAX_AGE_DAYS,
  MORE_STEP,
  RESULTS_FIRST_VIEW,
  RESULTS_PER_PAGE,
  SKU_DETAILS_ENABLED,
} from "@/lib/config/site";
import type { ShopCapMode } from "@/lib/ranking/config";
import { shopCapMode } from "@/lib/settings/queries";
import { withPromoValidity } from "./promo";
import { couponsForProduct } from "@/lib/coupons/queries";
import type { Coupon } from "@/lib/coupons/types";
import { couponForProduct } from "@/lib/deals/queries";
import { getAdminUser } from "@/lib/admin/auth";
import { aliexpressConfig, ConfigError, llmConfig } from "@/lib/env";
import { checkSearchRate, clientIp, consumeDailyLlmBudget, hashIp } from "@/lib/guard/rate-limit";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import type { LlmProvider } from "@/lib/llm/provider";
import { serviceClient } from "@/lib/supabase/server";
import { categoryLabelHe, tipsCategoryOf, type TipsCategory } from "@/lib/tips/category";
import { TipsRefresher, type TipsJobDeps } from "@/lib/tips/refresh";
import { displayableTips, readCategoryTips } from "@/lib/tips/store";
import type { Deal, ResultProduct, SearchResponse } from "@/lib/types";
import {
  MAX_CLICK_POSITION,
  type ClickRef,
  type LoggedResult,
  type SearchArrival,
} from "@/lib/search-url";
import type { SortPreference } from "./filters";
import {
  CacheMissError,
  isListableSearch,
  loadMore,
  logOrigin,
  MAX_QUERY_LENGTH,
  RESULTS_KEPT,
  runSearch,
  SearchError,
  startSearch,
  toResultProduct,
  type SearchDeps,
  type SearchOrigin,
  type SearchOutcome,
  type SearchStages,
  type UnderstoodSearch,
} from "./pipeline";
import { hasHebrew } from "@/lib/product-title";
import type { SeoResults } from "@/lib/seo/results";
import { retryOnce } from "@/lib/seo/retry";
import {
  collectSeoResults,
  continueSeoResults,
  SEO_ALI_RETRIES,
  SeoOutOfTimeError,
  type SeoRunDeps,
} from "./seo-run";
import { normalizeQuery } from "./cache-key";
import { RefreshGate } from "./refresh-gate";
import type { SearchLogEntry, SearchStore } from "./store";
import { SupabaseStore, type StoredProduct } from "./supabase-store";

/**
 * Why a search request got no results page. "upstream" is AliExpress; "llm" is the model that
 * parses the query (not reached or too slow), which the page names honestly (plan item 7).
 */
export type SearchFailure =
  | "invalid_query"
  | "rate_limited"
  | "capacity"
  | "parse_failed"
  | "upstream"
  | "llm"
  | "unavailable";

/** A response to one visitor request: its results carry the uid of its search_log row. */
export type LoggedSearchResponse = Omit<SearchResponse, "results" | "extra_results"> & {
  results: LoggedResult[];
  extra_results?: LoggedResult[];
};

export type SearchPageResult =
  | { ok: true; response: LoggedSearchResponse }
  | { ok: false; error: SearchFailure; retryAfterSec?: number };

const PRODUCT_ID = /^\d{1,20}$/;
const FILTERS_KEY = /^[0-9a-f]{64}$/;
const CLICK_SRC = /^[a-z0-9_-]{1,32}$/i;
const PRODUCT_TTL_MS = 24 * 3_600_000;
const LINK_MAX_AGE_MS = LINK_MAX_AGE_DAYS * 86_400_000;
const LAST_PAGE = Math.ceil(RESULTS_KEPT / RESULTS_PER_PAGE) - 1;
/** The last page of cards after the first view (loadMore with `cards`, 0-based). */
const LAST_CARDS_PAGE = Math.ceil((RESULTS_KEPT - RESULTS_FIRST_VIEW) / MORE_STEP) - 1;
/**
 * Gap between two AliExpress calls of one request. The app key's frequency ban (ApiCallLimit,
 * about a second) is shared by every caller, so back-to-back calls would cost a retry (CLAUDE.md
 * §6.4 spaces the search's calls the same way).
 */
const ALI_SPACING_MS = 1_100;

type Spaced = <T>(call: () => Promise<T>) => Promise<T>;

/**
 * Runs the AliExpress calls of one request one after another, each starting at least
 * ALI_SPACING_MS after the previous one ended. The /p refresh can make productdetail.get,
 * link.generate and (with SKU_DETAILS_ENABLED) product.sku.detail.get in a row.
 */
function aliSpacer(): Spaced {
  let lastEnd: number | null = null;
  return async (call) => {
    const wait = lastEnd === null ? 0 : lastEnd + ALI_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await call();
    } finally {
      lastEnd = Date.now();
    }
  };
}

const guardEnvSchema = z.object({
  IP_HASH_SALT: z.string().trim().optional(),
  // 0 is the kill switch: no new LLM work at all, cached results are still served.
  DAILY_SEARCH_CAP: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(0).default(2000),
  ),
});

function guardEnv() {
  const parsed = guardEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError([...new Set(parsed.error.issues.map((i) => String(i.path[0])))]);
  }
  return { ipHashSalt: parsed.data.IP_HASH_SALT ?? "", dailyCap: parsed.data.DAILY_SEARCH_CAP };
}

function llmProvider(): LlmProvider {
  const cfg = llmConfig();
  // The OpenAI adapter is deferred (owner decision 2026-09-27), so selecting it is a config error.
  if (cfg.provider !== "anthropic") throw new ConfigError(["LLM_PROVIDER"]);
  return new AnthropicProvider(cfg.apiKey, cfg.model);
}

const aliClient = () => new AliExpressClient(aliexpressConfig());

/**
 * The pipeline deps for one request. `shopCap` is the admin's shop cap setting, read once per
 * request (shopCapMode in lib/settings/queries.ts) by the entry points that rank: a search and an
 * SEO page run. "עוד N אפשרויות" only reads a result set ranked already, and passes none.
 */
function searchDeps(dailyCap: number, shopCap?: ShopCapMode) {
  const db = serviceClient();
  const deps: SearchDeps = {
    llm: llmProvider(),
    ali: aliClient(),
    store: new SupabaseStore(db),
    beforeLlmWork: async () => {
      if (!(await consumeDailyLlmBudget(db, new Date(), dailyCap))) {
        throw new SearchError("capacity", "daily LLM budget is used up");
      }
    },
    // search_log.failure holds the code the visitor was answered with.
    failureOf: failureCode,
    ...(shopCap ? { shopCap } : {}),
  };
  return { db, deps };
}

function logError(where: string, err: unknown) {
  // Name and message only: no stack traces. Our errors name missing keys, never their values.
  const text =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "object" && err && "message" in err
        ? String(err.message)
        : String(err);
  console.error(`[${where}] ${text.slice(0, 500)}`);
}

/** The code a search failure is answered with (and logged under, search_log.failure). */
export function failureCode(err: unknown): SearchFailure {
  if (err instanceof SearchError) return err.code;
  if (err instanceof AliExpressError) return "upstream";
  if (err instanceof LlmApiError) return "llm";
  return "unavailable"; // config, database and anything unexpected
}

function toFailure(err: unknown, where: string): SearchFailure {
  if (!(err instanceof SearchError) || err.code === "upstream" || err.code === "llm") {
    logError(where, err);
  }
  return failureCode(err);
}

/** DAILY_SEARCH_CAP (units of LLM work per Israel day), for the admin stats. Throws ConfigError. */
export function dailySearchCap(): number {
  return guardEnv().dailyCap;
}

/**
 * A request that joined another request's run was served without any new work, so it is logged
 * like a cache hit: its own query, cache "results", shared, no AliExpress calls and only its own
 * wait as total_ms. Whether /searches may list it, and its origin, are decided again for its own
 * query and origin: the run it joined had the same source, chips removed and sort (all part of the
 * in-flight key) and showed the same results, but it may have been typed where this one came from
 * one of our links, or the other way round. `searchUid` is the row's uid when the request already
 * gave it to its results (a streamed page), and `productsMs` its own wait for the products.
 * Returns the row's uid; never throws.
 */
async function logShared(
  store: () => SearchStore,
  log: SearchLogEntry,
  q: string,
  origin: Omit<SearchOrigin, "source">,
  waitedMs: number,
  {
    searchUid = crypto.randomUUID(),
    productsMs = null,
  }: { searchUid?: string; productsMs?: number | null } = {},
): Promise<string> {
  const joined: SearchOrigin = { ...origin, source: log.source };
  try {
    await store().logSearch({
      ...log,
      query: q,
      queryNorm: normalizeQuery(q),
      cache: "results",
      listable: isListableSearch(q, joined, log.resultsCount),
      origin: logOrigin(joined),
      timings: {
        parse_ms: null,
        fetch_ms: null,
        explain_ms: null,
        products_ms: productsMs,
        total_ms: waitedMs,
      },
      aliCalls: 0,
      searchUid,
      shared: true,
      // Its own asker and no work of its own.
      owner: joined.owner === true,
      diag: null,
    });
  } catch (err) {
    logError("search-log", err);
  }
  return searchUid;
}

/** The response for one request, its results tagged with that request's search_log uid. */
function tagged(response: SearchResponse, searchUid: string): LoggedSearchResponse {
  const tag = (r: ResultProduct): LoggedResult => ({ ...r, search_uid: searchUid });
  return {
    ...response,
    results: response.results.map(tag),
    ...(response.extra_results ? { extra_results: response.extra_results.map(tag) } : {}),
  };
}

/**
 * Keeps the function alive until `work` settles (after(), waitUntil on Vercel): a streamed search
 * caches and logs itself after the last of its page was sent. Outside a request (scripts, tests)
 * there is no after(), and the work simply runs on.
 */
function keepAlive(work: Promise<unknown>): void {
  const settled = work.then(
    () => undefined,
    () => undefined,
  );
  try {
    after(() => settled);
  } catch {
    // Outside a request scope.
  }
}

// Identical searches that arrive while one is still running share its stages instead of paying
// for a second parse, fetch and explain (seen in testing: a refresh during a 10 s search ran it
// twice): a request that joins sees the chips, the products and the lines as the run has them.
// Per server instance; the 14-day cache covers everything after the run is cached.
const inFlight = new Map<string, SearchStages>();

interface SharedRunInput {
  q: string;
  without: string[];
  sort?: SortPreference;
  typed: boolean;
  arrival?: SearchArrival;
  /** A signed-in admin asked (requestIsOwner): the row is logged with owner true. */
  owner: boolean;
  /** The category the search is limited to (SearchInput.category), already validated. */
  category?: string;
}

/**
 * True when a signed-in admin (the owner) made this request: their searches and clicks are logged
 * with owner true and left out of the stats (plan item 10); their typed searches are listed on
 * /searches like anyone's (owner decision 2026-09-29). Visitors have no auth cookie, so for them
 * this makes no network call (lib/admin/auth.ts).
 */
async function requestIsOwner(): Promise<boolean> {
  return (await getAdminUser()) !== null;
}

/**
 * The stages of the run this request started or joined, and the uid of this request's own
 * search_log row, known before the row is written so its results can carry it at once. A joiner
 * logs its row once the run is done; a joiner of a run that fails logs nothing: the run logged the
 * failure once, and only the run's own request reports its error.
 */
function sharedRun(
  input: SharedRunInput,
  deps: SearchDeps,
): { stages: SearchStages; searchUid: string } {
  const { q, without, sort } = input;
  // The shop cap mode too: a run ranked under the mode before a switch is never shared after it.
  // And the category: a search limited to one never joins the unrestricted run, or the other way.
  const key = JSON.stringify([
    normalizeQuery(q),
    [...without].sort(),
    sort ?? null,
    deps.shopCap ?? null,
    ...(input.category ? [input.category] : []),
  ]);
  const running = inFlight.get(key);
  if (running) {
    const started = performance.now();
    const searchUid = crypto.randomUUID();
    const origin = {
      without,
      sort,
      typed: input.typed,
      arrival: input.arrival,
      ...(input.owner ? { owner: true } : {}),
    };
    const waited = (stage: Promise<unknown>) =>
      stage.then(
        () => Math.round(performance.now() - started),
        () => null,
      );
    const shown = waited(running.products);
    const finished = waited(running.final);
    const logged = running.outcome.then(
      async (outcome) =>
        logShared(() => deps.store, outcome.log, q, origin, (await finished) ?? 0, {
          searchUid,
          productsMs: await shown,
        }),
      () => undefined,
    );
    keepAlive(logged);
    return { stages: running, searchUid };
  }
  const stages = startSearch(input, deps);
  inFlight.set(key, stages);
  const done = stages.outcome.finally(() => inFlight.delete(key));
  done.catch((err: unknown) => toFailure(err, "search"));
  keepAlive(done);
  return { stages, searchUid: stages.searchUid };
}

/** A stage of a search as one request sees it: its value, or the failure it is answered with. */
export type Staged<T> =
  { ok: true; value: T } | { ok: false; error: SearchFailure; retryAfterSec?: number };

/** The products of a request's search, before (pending) or with every line. */
export interface ProductsView {
  response: LoggedSearchResponse;
  /** Lines are still being written: `final` brings them. */
  pending: boolean;
}

/**
 * One request's search as the results page streams it (docs/search-quality-plan.md item 15): the
 * chips once the query is understood, the products once they are ranked, then every line. Each
 * stage resolves once, with its value or the failure; none rejects.
 */
export interface SearchStream {
  /** The chips, and how long this request waited for them (the page's first wait). */
  understood: Promise<Staged<UnderstoodSearch & { waitedMs: number }>>;
  products: Promise<Staged<ProductsView>>;
  final: Promise<Staged<LoggedSearchResponse>>;
}

function staged<T>(stage: Promise<T>): Promise<Staged<T>> {
  return stage.then(
    (value) => ({ ok: true as const, value }),
    (err: unknown) => ({ ok: false as const, error: failureCode(err) }),
  );
}

/**
 * Starts (or joins) the search of one request, after the per-IP rate limit, and returns its stages.
 * `typed` is false for a query from one of our own links (a recent-search card, an example) or an
 * ad: it is searched and logged like any other, but never listed on /searches. It defaults to true
 * unless `arrival` says where the visitor came from (parseArrival in lib/search-url.ts), which
 * search_log.origin records. The results carry the uid of this request's search_log row, which
 * their /go links pass on. The search caches and logs itself after the page is sent (keepAlive).
 */
export async function startSearchForRequest(
  input: {
    q: string;
    without?: string[];
    sort?: SortPreference;
    typed?: boolean;
    arrival?: SearchArrival;
    /** A first-level category from parseSearchCategory (lib/search-url.ts), or undefined. */
    category?: string;
  },
  headers: Headers,
): Promise<Staged<SearchStream>> {
  const q = input.q.trim();
  if (!q || q.length > MAX_QUERY_LENGTH) return { ok: false, error: "invalid_query" };
  const started = performance.now();
  try {
    const env = guardEnv();
    if (!env.ipHashSalt) throw new ConfigError(["IP_HASH_SALT"]);
    const db = serviceClient();
    // Every request counts, cached ones included: a cached search costs no LLM or AliExpress
    // call, but the limit is against scripted abuse, which can hammer cached queries just as
    // well (each still costs DB reads). Chip removals and sort changes count too; 20/hour
    // leaves room for refining.
    // A refused request is not logged: it did no work, and a flood of them would only add rows.
    const rate = await checkSearchRate(db, hashIp(clientIp(headers), env.ipHashSalt), new Date());
    if (!rate.ok) return { ok: false, error: "rate_limited", retryAfterSec: rate.retryAfterSec };
    // The admin's shop cap setting, once for this request (cached, the default on any failure).
    const { deps } = searchDeps(env.dailyCap, await shopCapMode());
    const { stages, searchUid } = sharedRun(
      {
        q,
        without: input.without ?? [],
        sort: input.sort,
        typed: input.typed ?? input.arrival === undefined,
        ...(input.arrival ? { arrival: input.arrival } : {}),
        owner: await requestIsOwner(),
        ...(input.category ? { category: input.category } : {}),
      },
      deps,
    );
    return {
      ok: true,
      value: {
        understood: staged(
          stages.understood.then((understood) => ({
            ...understood,
            waitedMs: Math.round(performance.now() - started),
          })),
        ),
        products: staged(
          stages.products.then(({ response, pending }) => ({
            response: tagged(response, searchUid),
            pending,
          })),
        ),
        final: staged(stages.final.then((response) => tagged(response, searchUid))),
      },
    };
  } catch (err) {
    return { ok: false, error: toFailure(err, "search") };
  }
}

/** Runs a search for a request and waits for every line (the JSON API). See startSearchForRequest. */
export async function searchForRequest(
  input: Parameters<typeof startSearchForRequest>[0],
  headers: Headers,
): Promise<SearchPageResult> {
  const started = await startSearchForRequest(input, headers);
  if (!started.ok) return started;
  const final = await started.value.final;
  return final.ok ? { ok: true, response: final.value } : final;
}

/** An LLM that is never called: a crawler's search is cache-only (CacheMissError first). */
const NO_LLM: LlmProvider = {
  name: "anthropic",
  model: "none",
  generateStructured: () => Promise.reject(new CacheMissError("parse")),
};

/** No network for a crawler's AliExpress client: cache-only, and this makes sure of it. */
const NO_FETCH: typeof fetch = () => Promise.reject(new CacheMissError("results"));

/**
 * A crawler's /search or POST /api/search (isBotUserAgent in lib/guard/bots.ts; owner request
 * 2026-10-03): never paid work. Only a cached parse and a cached result set for exactly these
 * filters whose first view is complete (SearchInput.cacheOnly); its row is logged with origin
 * "bot", never listed and left out of the stats. Null when nothing is cached (no row is written),
 * over the per-IP limit, or on any failure: the caller then shows the page for crawlers. The
 * deps can call neither the LLM nor AliExpress (NO_LLM, NO_FETCH, a budget that refuses), so a
 * pipeline change could never make a crawler spend money.
 */
export async function cachedSearchForBot(
  input: { q: string; without?: string[]; sort?: SortPreference; category?: string },
  headers: Headers,
): Promise<LoggedSearchResponse | null> {
  const q = input.q.trim();
  if (!q || q.length > MAX_QUERY_LENGTH) return null;
  try {
    const env = guardEnv();
    if (!env.ipHashSalt) return null;
    const db = serviceClient();
    // The per-IP limits stay for crawlers too: every request costs database reads.
    const rate = await checkSearchRate(db, hashIp(clientIp(headers), env.ipHashSalt), new Date());
    if (!rate.ok) return null;
    const deps: SearchDeps = {
      llm: NO_LLM,
      ali: new AliExpressClient(aliexpressConfig(), { fetch: NO_FETCH }),
      store: new SupabaseStore(db),
      beforeLlmWork: () => Promise.reject(new CacheMissError("parse")),
      failureOf: failureCode,
      shopCap: await shopCapMode(),
    };
    const stages = startSearch(
      {
        q,
        without: input.without ?? [],
        sort: input.sort,
        cacheOnly: true,
        bot: true,
        ...(input.category ? { category: input.category } : {}),
      },
      deps,
    );
    keepAlive(stages.outcome);
    return tagged(await stages.final, stages.searchUid);
  } catch (err) {
    if (!(err instanceof CacheMissError)) logError("bot-search", err);
    return null;
  }
}

/** A finished response as the stages the results page reads (a crawler's cached search). */
export function settledStream(response: LoggedSearchResponse): SearchStream {
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
  return {
    understood: ok({
      query: response.query,
      chips: response.chips,
      sort: response.sort,
      ...(response.not_filtered ? { not_filtered: response.not_filtered } : {}),
      waitedMs: 0,
    }),
    products: ok({ response, pending: false }),
    final: ok(response),
  };
}

export type MoreResult =
  | { ok: true; results: LoggedResult[]; more_available: boolean }
  | {
      ok: false;
      error: "not_found" | "capacity" | "rate_limited" | "unavailable";
      retryAfterSec?: number;
    };

class RateLimitedError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("per-IP search limit reached");
    this.name = "RateLimitedError";
  }
}

/**
 * "עוד N אפשרויות" for a cached result set. `page` is 1 for the second page (results 6-10, the WhatsApp bot); /search starts at FIRST_MORE_PAGE (2, places 11-15). A
 * page that still needs an explain call counts against the visitor's per-IP limit (when `headers`
 * are given) before the daily LLM budget, so one client cannot drain the budget with parallel
 * requests. Pages that are already explained are free.
 */
export async function moreForRequest(
  filtersKey: string,
  page: number,
  headers?: Headers,
  { cards = false }: { cards?: boolean } = {},
): Promise<MoreResult> {
  const [first, last] = cards ? [0, LAST_CARDS_PAGE] : [1, LAST_PAGE];
  if (!FILTERS_KEY.test(filtersKey) || !Number.isInteger(page) || page < first || page > last) {
    return { ok: false, error: "not_found" };
  }
  try {
    const env = guardEnv();
    const { db, deps } = searchDeps(env.dailyCap);
    const chargeBudget = deps.beforeLlmWork;
    const beforeLlmWork = async () => {
      if (headers) {
        if (!env.ipHashSalt) throw new ConfigError(["IP_HASH_SALT"]);
        const ipHash = hashIp(clientIp(headers), env.ipHashSalt);
        const rate = await checkSearchRate(db, ipHash, new Date());
        if (!rate.ok) throw new RateLimitedError(rate.retryAfterSec);
      }
      await chargeBudget?.();
    };
    const out = await loadMore(
      filtersKey,
      page,
      {
        ...deps,
        beforeLlmWork,
        // Like a refused search, a page refused by the per-IP limit is not logged.
        failureOf: (err) => (err instanceof RateLimitedError ? null : failureCode(err)),
      },
      { owner: await requestIsOwner(), cards },
    );
    if (!out) return { ok: false, error: "not_found" };
    // The page's own search_log row (source "more"): its cards' /go links carry that uid.
    const searchUid = out.log?.searchUid;
    const results = withPromoValidity(
      searchUid ? out.results.map((r) => ({ ...r, search_uid: searchUid })) : out.results,
      Date.now(),
    );
    return { ok: true, results, more_available: out.more_available };
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return { ok: false, error: "rate_limited", retryAfterSec: err.retryAfterSec };
    }
    return { ok: false, error: toFailure(err, "more") === "capacity" ? "capacity" : "unavailable" };
  }
}

export interface ProductPageData {
  product: ResultProduct;
  /** Original AliExpress page (not the affiliate link), for reference only. */
  detailUrl: string;
  shopName: string | null;
  updatedAt: string;
  /** Generic buying tips for the product's category (LLM job c), or null while there are none. */
  tips: string[] | null;
  /** Hebrew name of the category the tips are for; null when we have no translation. */
  tipsCategoryHe: string | null;
  /**
   * A published, current community coupon for this product (deals table), or null. The fallback:
   * null whenever there are owner coupons.
   */
  coupon: Deal | null;
  /** Owner coupons valid now (lib/coupons): this product's own first, then featured sitewide. */
  ownerCoupons: Coupon[];
  /** The product's AliExpress promo code while it is valid (startsAt <= now < endsAt), or null. */
  apiCoupon: AliPromoCode | null;
  /** product_video_url (https, *.aliexpress-media.com), or null. */
  videoUrl: string | null;
  /** Colors and sizes; always null while SKU_DETAILS_ENABLED is off. */
  skuDetails: AliSkuDetails | null;
}

/** One link.generate call for one product; the first https AliExpress link, or null. */
async function generateLink(
  ali: AliExpressClient,
  productId: string,
  promotionLinkType: PromotionLinkType = STANDARD_LINK_TYPE,
): Promise<string | null> {
  const links = await generateLinks(ali, [itemSourceUrl(productId)], { promotionLinkType });
  for (const l of links) {
    const url = affiliateUrl(l.promotionLink);
    if (url) return url;
  }
  return null;
}

/**
 * A row whose link is a link.generate hot link (promotion_link_type 2, made by a hot list for a
 * product with a higher hot rate, lib/hot/loader.ts). Strict: the stored jsonb is not trusted.
 */
const hasHotLink = (stored: StoredProduct) => stored.product.promotionLinkType === HOT_LINK_TYPE;

/** The link type /go regenerates a row's link with: 2 for a row marked 2, 0 otherwise. */
const linkTypeOf = (stored: StoredProduct): PromotionLinkType =>
  hasHotLink(stored) ? HOT_LINK_TYPE : STANDARD_LINK_TYPE;

/**
 * When the stored affiliate link was made: promotionLinkAt when that was set, otherwise the row's
 * last save (the link came with that save's product data).
 */
const linkMadeAt = (stored: StoredProduct) => stored.product.promotionLinkAt ?? stored.updatedAt;

/** True while the stored link is younger than LINK_MAX_AGE_DAYS. An unreadable time is old. */
function linkIsFresh(stored: StoredProduct, now: Date): boolean {
  const made = Date.parse(linkMadeAt(stored));
  return Number.isFinite(made) && now.getTime() - made < LINK_MAX_AGE_MS;
}

/**
 * A row saved from a hot list (lib/hot/loader.ts): AliExpress's Hebrew title and that list's link.
 * Rows saved before `source` was stored are known by a Hebrew AliExpress title and no title of
 * ours: every other save is in English.
 */
const fromHotList = (stored: StoredProduct) =>
  stored.product.source === "hot" || (stored.titleHe === null && hasHebrew(stored.product.title));

/**
 * Fresh details with an affiliate link, or null when AliExpress no longer returns the product.
 * When productdetail.get sends no link, the stored one is kept (with the time it was made) while it
 * is fresh; otherwise a new one is generated. A product from a hot list is refreshed in Hebrew, so
 * its title stays the one its card shows, and keeps the list's link while it is fresh: whether that
 * link earns the hot commission is unconfirmed (docs/aliexpress-api.md), so it is not swapped for
 * productdetail.get's.
 *
 * A row with a hot link (promotionLinkType 2) keeps it, with its type and time, while it is
 * younger than LINK_MAX_AGE_DAYS; after that a new type 2 link is made (one more call). When that
 * call fails or gives no usable link, the product goes on with productdetail.get's link (type
 * unknown), as any other. Every hot row keeps its stored hot rate, whichever link it ends up with,
 * since productdetail.get sends "0.0%".
 */
async function refreshProduct(
  ali: AliExpressClient,
  spaced: Spaced,
  stored: StoredProduct,
  now: Date,
): Promise<AliProduct | null> {
  const { productId } = stored.product;
  const hot = fromHotList(stored);
  const page = await spaced(() => getProductDetails(ali, [productId], hot ? "HE" : "EN"));
  const found = page.products.find((p) => p.productId === productId);
  if (!found) return null;
  let product: AliProduct = hot ? { ...found, source: "hot" } : found;
  if (hot || hasHotLink(stored)) {
    // productdetail.get sends a hot rate of "0.0%" (null): a hot row keeps the one its list
    // stored, whatever link it ends up with (stats only, never selection, filters or order).
    product = {
      ...product,
      hotCommissionRatePct:
        found.hotCommissionRatePct ?? stored.product.hotCommissionRatePct ?? null,
    };
  }
  const known = stored.product.promotionLink;
  const keepKnown = known && linkIsFresh(stored, now);
  if (hasHotLink(stored)) {
    const hotLink = (promotionLink: string, promotionLinkAt: string): AliProduct => ({
      ...product,
      promotionLink,
      promotionLinkType: HOT_LINK_TYPE,
      promotionLinkAt,
    });
    if (known && keepKnown) return hotLink(known, linkMadeAt(stored));
    const renewed = await spaced(() => generateLink(ali, productId, HOT_LINK_TYPE)).catch(
      (err: unknown) => {
        logError("product", err);
        return null;
      },
    );
    if (renewed) return hotLink(renewed, now.toISOString());
  }
  if (keepKnown && (hot || !product.promotionLink)) {
    return { ...product, promotionLink: known, promotionLinkAt: linkMadeAt(stored) };
  }
  if (product.promotionLink) return product;
  const promotionLink = await spaced(() => generateLink(ali, productId));
  return promotionLink ? { ...product, promotionLink } : null; // never show what we cannot link
}

/** SKU details for the refresh. A failure (such as a missing permission) only leaves them out. */
async function skuDetailsFor(ali: AliExpressClient, productId: string) {
  try {
    return await getSkuDetails(ali, productId);
  } catch (err) {
    logError("sku", err);
    return null;
  }
}

interface PageProduct {
  product: AliProduct;
  titleHe: string | null;
  updatedAt: string;
}

/**
 * The /p refreshes of this server instance (lib/search/refresh-gate.ts): views of one product
 * share its refresh; a product whose refresh failed, or that AliExpress no longer returns, is not
 * refreshed again for FAILURE_COOLDOWN_MS; after an ApiCallLimit no product is refreshed for
 * RATE_LIMIT_BACKOFF_MS (doubling while it repeats). Meanwhile the stored row is served.
 */
const pageRefreshes = new RefreshGate<PageProduct | null>({
  isRateLimit: (err) => err instanceof AliExpressError && err.kind === "rate_limit",
  remember: (value) => value === null,
  onFailure: (err) => logError("product", err),
});

/**
 * One refresh of a stored product: productdetail.get (plus link.generate or SKU details when
 * needed, spaced), saved with the time of the refresh. Null when AliExpress no longer returns the
 * product. Throws when a call fails; a failed save is logged and the fresh data still shown.
 */
async function refreshAndSave(
  store: SupabaseStore,
  stored: StoredProduct,
  now: Date,
): Promise<PageProduct | null> {
  const { productId } = stored.product;
  const ali = aliClient();
  const spaced = aliSpacer();
  let fresh = await refreshProduct(ali, spaced, stored, now);
  if (fresh && SKU_DETAILS_ENABLED) {
    fresh = { ...fresh, skuDetails: await spaced(() => skuDetailsFor(ali, productId)) };
  }
  if (!fresh) return null;
  const titleHe = stored.titleHe;
  await store
    .saveProducts([fresh], { [productId]: titleHe })
    .catch((err) => logError("product", err));
  return { product: fresh, titleHe, updatedAt: now.toISOString() };
}

/**
 * Product saved by one of our searches; refreshed from productdetail.get when older than 24h.
 * Unknown ids return null (404): only products that went through our filters get a page, and a
 * crawler requesting random ids cannot spend AliExpress quota. A refresh that fails, or that
 * pageRefreshes skips (a recent failure of this product, or the back-off after a rate limit),
 * serves the stored row: real data from the last refresh, with its date, beats a 404 while
 * AliExpress is down or throttling us.
 */
async function loadPageProduct(productId: string): Promise<PageProduct | null> {
  const store = new SupabaseStore(serviceClient());
  const stored = await store.getProduct(productId);
  if (!stored) return null;
  const now = new Date();
  if (
    stored.product.promotionLink &&
    now.getTime() - Date.parse(stored.updatedAt) < PRODUCT_TTL_MS
  ) {
    return stored;
  }
  const refreshed = await pageRefreshes.run(productId, () => refreshAndSave(store, stored, now));
  return refreshed.ok ? refreshed.value : stored;
}

// One refresher per server instance, so concurrent views of a category share one LLM call.
const tipsRefresher = new TipsRefresher();

function tipsJobDeps(): TipsJobDeps {
  const db = serviceClient();
  const { dailyCap } = guardEnv();
  const store = new SupabaseStore(db);
  return {
    db,
    llm: llmProvider(),
    chargeBudget: () => consumeDailyLlmBudget(db, new Date(), dailyCap),
    recordUsage: (record) => store.logUsage([record]),
  };
}

/** Runs the refresh after the response is sent; the page never waits for the LLM. */
function scheduleTipsRefresh(category: TipsCategory) {
  const job = () => tipsRefresher.refresh(category, tipsJobDeps);
  try {
    after(job);
  } catch {
    // Outside a request (scripts, tests) there is no after(): run it detached instead.
    void job();
  }
}

/**
 * Stored tips for the product's category. A missing or stale entry is (re)generated in the
 * background; until then the page shows the stored list (if it is the current version) or none.
 */
async function tipsForPage(
  p: AliProduct,
  now: Date,
): Promise<Pick<ProductPageData, "tips" | "tipsCategoryHe">> {
  const category = tipsCategoryOf(p.category);
  if (!category) return { tips: null, tipsCategoryHe: null };
  const tipsCategoryHe = categoryLabelHe(category.id);
  try {
    const entry = await readCategoryTips(category.id, now);
    if (!entry || entry.stale) scheduleTipsRefresh(category);
    return { tips: displayableTips(entry), tipsCategoryHe };
  } catch (err) {
    // A read failure is not a missing entry: nothing is generated while the database is down.
    logError("tips", err);
    return { tips: null, tipsCategoryHe };
  }
}

async function couponForPage(productId: string, now: Date): Promise<Deal | null> {
  try {
    const deal = await couponForProduct(productId, now);
    // A "don't buy" warning is never offered as a coupon next to the buy button.
    return deal && deal.type !== "dont_buy" && deal.coupon_code?.trim() ? deal : null;
  } catch (err) {
    logError("coupon", err);
    return null;
  }
}

async function ownerCouponsForPage(productId: string, now: Date): Promise<Coupon[]> {
  try {
    return await couponsForProduct(productId, now);
  } catch (err) {
    logError("coupons", err);
    return [];
  }
}

/**
 * The product's AliExpress promo code while it is valid. Its amounts are in the request currency,
 * so it is shown for ILS products only, where ₪ is what AliExpress itself wrote. The stored jsonb
 * is checked again (readStoredPromoCode), as /coupons does.
 */
function apiCouponFor(p: AliProduct, now: Date): AliPromoCode | null {
  const code = readStoredPromoCode(p.promoCode);
  return code && p.currency === "ILS" && isPromoCodeCurrent(code, now) ? code : null;
}

/**
 * Everything /p shows: the product (see loadPageProduct) with its video and AliExpress promo code,
 * its category tips, owner coupons and the community coupon. Tips and coupons never fail the page;
 * they are simply left out. Products saved before videos and promo codes were read lack them.
 * Wrapped in cache() so generateMetadata and the page share one lookup (and refresh) per request.
 */
export const productForPage = cache(async (productId: string): Promise<ProductPageData | null> => {
  if (!PRODUCT_ID.test(productId)) return null;
  try {
    const loaded = await loadPageProduct(productId);
    if (!loaded) return null;
    const { product: p, titleHe, updatedAt } = loaded;
    const now = new Date();
    const [tips, coupon, ownerCoupons] = await Promise.all([
      tipsForPage(p, now),
      couponForPage(productId, now),
      ownerCouponsForPage(productId, now),
    ]);
    return {
      product: toResultProduct(p, titleHe ? { title_he: titleHe, why_he: "" } : undefined),
      detailUrl: p.detailUrl,
      shopName: p.shop.name,
      updatedAt,
      ...tips,
      coupon: ownerCoupons.length ? null : coupon,
      ownerCoupons,
      apiCoupon: apiCouponFor(p, now),
      // The stored row is not trusted blindly: only AliExpress's media CDN over https.
      videoUrl: mediaUrl(p.videoUrl),
      skuDetails: SKU_DETAILS_ENABLED ? (p.skuDetails ?? null) : null,
    };
  } catch (err) {
    logError("product", err);
    return null;
  }
});

/**
 * One run for an SEO landing page (lib/seo/refresh.ts): its response and whether its explain call
 * failed (lines built from the data), or the failure code it was answered with.
 */
export type SeoRun =
  { ok: true; response: SearchResponse; degraded: boolean } | { ok: false; error: SearchFailure };

type PreviewRun = { ok: true; outcome: SearchOutcome } | { ok: false; error: SearchFailure };

const PREVIEW_RETRY_MS = 10 * 60_000;
const previews = new Map<string, { run: Promise<PreviewRun>; failedAt?: number }>();

async function runPreview(q: string): Promise<PreviewRun> {
  try {
    const { deps } = searchDeps(guardEnv().dailyCap, await shopCapMode());
    return { ok: true, outcome: await runSearch({ q, source: "preview" }, deps) };
  } catch (err) {
    return { ok: false, error: toFailure(err, "preview") };
  }
}

function seoRunOf(outcome: SearchOutcome): SeoRun {
  return { ok: true, response: outcome.response, degraded: outcome.meta.explainFailed === true };
}

/**
 * examplePreview with how the run went (the first render of a landing page without stored
 * results, lib/seo/refresh.ts firstRun): its response and whether its explain call failed, or the
 * failure code.
 */
export async function examplePreviewRun(q: string): Promise<SeoRun> {
  // Renders arriving together while the cache is cold share one paid run per instance. A failure
  // is remembered for a while: during an outage every landing page render would otherwise start a
  // new paid run and use up the daily LLM budget that real searches need.
  const key = q.trim();
  const entry = previews.get(key);
  const retry = entry?.failedAt !== undefined && Date.now() - entry.failedAt >= PREVIEW_RETRY_MS;
  if (entry && !retry) {
    const started = performance.now();
    const shared = await entry.run;
    if (!shared.ok) return shared;
    const origin = { without: [], typed: false };
    const waited = Math.round(performance.now() - started);
    await logShared(
      () => new SupabaseStore(serviceClient()),
      shared.outcome.log,
      key,
      origin,
      waited,
    );
    // Not tagged with a search uid: the landing page is static for a day (ISR), so its clicks
    // would all name one render's row.
    return seoRunOf(shared.outcome);
  }
  const run: Promise<PreviewRun> = runPreview(key).then((result) => {
    if (result.ok) previews.delete(key);
    else previews.set(key, { run, failedAt: Date.now() });
    return result;
  });
  previews.set(key, { run });
  const result = await run;
  return result.ok ? seoRunOf(result.outcome) : result;
}

/**
 * Real results for a query we chose: the SEO landing pages (lib/seo/page-view.ts). Not counted
 * against the visitor's rate limit (it is not their search), still subject to the daily LLM
 * budget, and served from the 14-day cache after the first run. Null on any failure, so the page
 * shows its fallback instead. Logged with source "preview", so landing page renders never count
 * as searches in the stats. (The home page used to show an example from it; older "preview" rows
 * include those views.)
 */
export async function examplePreview(q: string): Promise<SearchResponse | null> {
  const run = await examplePreviewRun(q);
  return run.ok ? run.response : null;
}

/** Wait before the second try of an SEO page refresh (AliExpress's frequency ban is ~1 s). */
const SEO_REFRESH_BACKOFF_MS = 3_000;
/**
 * Time a second try needs to start: its first AliExpress call and one explain call
 * (SEO_RUN_LIMITS in lib/search/seo-run.ts); none with less left.
 */
const SEO_REFRESH_RETRY_ROOM_MS = 30_000;

/** An SEO page's run: its results, or the code it failed with ("time": no room to start). */
export type SeoResultsRun =
  { ok: true; results: SeoResults } | { ok: false; error: SearchFailure | "time" };

/**
 * The deps of an SEO page's run (lib/search/seo-run.ts): the real LLM and database, the admin's
 * shop cap, the daily LLM budget, and an AliExpress client with one retry, so every call it
 * makes is bounded and the run can keep inside its deadline.
 */
async function seoRunDeps(): Promise<SeoRunDeps> {
  const { dailyCap } = guardEnv();
  const db = serviceClient();
  const store = new SupabaseStore(db);
  return {
    llm: llmProvider(),
    ali: new AliExpressClient(aliexpressConfig(), { retries: SEO_ALI_RETRIES }),
    store,
    shopCap: await shopCapMode(),
    chargeBudget: async () => {
      if (!(await consumeDailyLlmBudget(db, new Date(), dailyCap))) {
        throw new SearchError("capacity", "daily LLM budget is used up");
      }
    },
    saveTitles: (titles) => store.saveTitles(titles),
  };
}

function seoFailure(err: unknown): SeoResultsRun {
  if (err instanceof SeoOutOfTimeError) return { ok: false, error: "time" };
  return { ok: false, error: toFailure(err, "seo-refresh") };
}

/**
 * A new run for an SEO landing page's stored results (lib/seo/refresh.ts, owner decision
 * 2026-09-29): every product of the page's query that passes the site's filters, ranked by the
 * site's ranking under the admin's shop cap, up to SEO_MAX_PRODUCTS, explained group by group
 * (collectSeoResults in ./seo-run.ts). Never served from the results cache, so the products and
 * prices are new; the parse may come from the parse cache, and the first three groups are cached
 * for visitors' searches with the same filters. Logged as source "preview" (never a search in the
 * stats), under the daily LLM budget. An upstream failure (AliExpress, its rate limit included) is
 * tried once more after a short back-off when there is time before `deadline` (epoch ms). Never
 * throws.
 */
export async function refreshSearch(
  q: string,
  { deadline, previous = [] }: { deadline: number; previous?: readonly SeoResults[] },
): Promise<SeoResultsRun> {
  const attempt = async (): Promise<SeoResultsRun> => {
    try {
      const { results } = await collectSeoResults(q, await seoRunDeps(), { deadline, previous });
      return { ok: true, results };
    } catch (err) {
      return seoFailure(err);
    }
  };
  return retryOnce(attempt, {
    retryable: (run) => !run.ok && run.error === "upstream",
    backoffMs: SEO_REFRESH_BACKOFF_MS,
    roomMs: SEO_REFRESH_RETRY_ROOM_MS,
    deadline,
  });
}

/**
 * Writes the lines an SEO page's stored run still lacks, without fetching (continueSeoResults in
 * ./seo-run.ts). Never throws.
 */
export async function continueSeoRun(
  results: SeoResults,
  { deadline }: { deadline: number },
): Promise<SeoResultsRun> {
  try {
    return {
      ok: true,
      results: (await continueSeoResults(results, await seoRunDeps(), { deadline })).results,
    };
  } catch (err) {
    return seoFailure(err);
  }
}

/**
 * Saves a new link into the stored product without touching updated_at: the row's price is as old
 * as before, and /p must keep saying when it was checked (saveProducts would stamp the row as
 * fresh and add a price_history row). Applies only to the row as it was read, so a refresh saved
 * in the meantime is never overwritten with older data.
 */
async function saveLink(db: SupabaseClient, stored: StoredProduct, link: string, now: Date) {
  const data: AliProduct = {
    ...stored.product,
    promotionLink: link,
    promotionLinkAt: now.toISOString(),
  };
  const { error } = await db
    .from("products")
    .update({ data })
    .eq("product_id", data.productId)
    .eq("updated_at", stored.updatedAt);
  if (error) throw error;
}

/**
 * One link.generate call for /go, of the row's link type (2 for a row with a hot link, 0 otherwise);
 * the new link is saved and the row keeps its type. Null when it fails or gives nothing usable (an
 * https AliExpress link, generateLink).
 */
async function regenerateLink(
  db: SupabaseClient,
  stored: StoredProduct,
  now: Date,
): Promise<string | null> {
  let link: string | null = null;
  try {
    link = await generateLink(aliClient(), stored.product.productId, linkTypeOf(stored));
  } catch (err) {
    logError("go", err);
  }
  if (!link) return null;
  await saveLink(db, stored, link, now).catch((err) => logError("go", err));
  return link;
}

/** How long a link.generate result for /go is reused (per product and server instance). */
const LINK_RETRY_MS = 10 * 60_000;
const linkRuns = new Map<string, { run: Promise<string | null>; settledAt?: number }>();

/**
 * The stored link while it is younger than LINK_MAX_AGE_DAYS (AliExpress may invalidate old short
 * links, agreement 5.4). Otherwise, or when there is none, one link.generate call makes a new one
 * (type 2 for a row marked with a hot link, type 0 otherwise), which is saved; when that fails the
 * stored link is still used.
 *
 * /go is public and has no per-IP limit, and the app key shares one frequency ban with searches and
 * /p, so a burst of clicks on one old link must not become a burst of calls: clicks that arrive
 * while a call runs share it, and its result (a new link, or a failure that falls back to the
 * stored link) is reused for LINK_RETRY_MS instead of calling again. Normally the saved link is
 * fresh and no click gets here; the reuse matters when AliExpress or the save fails.
 */
async function affiliateLink(
  db: SupabaseClient,
  stored: StoredProduct,
  now: Date,
): Promise<string | null> {
  const current = stored.product.promotionLink;
  if (current && linkIsFresh(stored, now)) return current;
  const id = stored.product.productId;
  const entry = linkRuns.get(id);
  const expired =
    entry?.settledAt !== undefined && now.getTime() - entry.settledAt >= LINK_RETRY_MS;
  if (entry && !expired) return (await entry.run) ?? current;
  for (const [key, e] of linkRuns) {
    // Results nobody can reuse any more; keeps the map as small as the recent regenerations.
    if (e.settledAt !== undefined && now.getTime() - e.settledAt >= LINK_RETRY_MS) {
      linkRuns.delete(key);
    }
  }
  const run: Promise<string | null> = regenerateLink(db, stored, now).then((link) => {
    linkRuns.set(id, { run, settledAt: Date.now() });
    return link;
  });
  linkRuns.set(id, { run });
  return (await run) ?? current;
}

const clickUidSchema = z.uuid();
const clickPositionSchema = z.coerce.number().int().min(1).max(MAX_CLICK_POSITION);

/**
 * The s (search_log uid) and pos (card position) parameters of a /go request (goHref in
 * lib/search-url.ts). Anyone can send any value, so each is checked on its own and a bad one is
 * dropped while the click is still logged. They are written to clicks for the stats and never
 * trusted for anything else.
 */
export function clickRefFrom(params: URLSearchParams): ClickRef {
  const uid = clickUidSchema.safeParse(params.get("s") ?? "");
  const pos = params.get("pos")?.trim();
  const position = pos ? clickPositionSchema.safeParse(pos) : null;
  return {
    searchUid: uid.success ? uid.data.toLowerCase() : null,
    position: position?.success ? position.data : null,
  };
}

const NO_CLICK_REF: ClickRef = { searchUid: null, position: null };

/** Logs a click and returns the affiliate link to redirect to, or null when there is none. */
export async function clickOut(
  productId: string,
  src: string,
  ref: ClickRef = NO_CLICK_REF,
): Promise<string | null> {
  if (!PRODUCT_ID.test(productId)) return null;
  try {
    const db = serviceClient();
    const store = new SupabaseStore(db);
    const stored = await store.getProduct(productId);
    if (!stored) return null;
    const [link] = await Promise.all([
      affiliateLink(db, stored, new Date()),
      requestIsOwner()
        .then((owner) => store.logClick(productId, CLICK_SRC.test(src) ? src : "other", ref, owner))
        .catch((err) => logError("go", err)),
    ]);
    if (!link) return null;
    // Only AliExpress hosts over https, so a bad row can never turn /go into an open redirect.
    const safe = affiliateUrl(link);
    if (!safe) logError("go", new Error(`refusing a non-AliExpress link for product ${productId}`));
    return safe;
  } catch (err) {
    logError("go", err);
    return null;
  }
}
