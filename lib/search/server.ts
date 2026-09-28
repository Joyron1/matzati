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
import { LINK_MAX_AGE_DAYS, RESULTS_PER_PAGE, SKU_DETAILS_ENABLED } from "@/lib/config/site";
import { couponsForProduct } from "@/lib/coupons/queries";
import type { Coupon } from "@/lib/coupons/types";
import { couponForProduct } from "@/lib/deals/queries";
import { aliexpressConfig, ConfigError, llmConfig } from "@/lib/env";
import { checkSearchRate, clientIp, consumeDailyLlmBudget, hashIp } from "@/lib/guard/rate-limit";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import type { LlmProvider } from "@/lib/llm/provider";
import { serviceClient } from "@/lib/supabase/server";
import { categoryLabelHe, tipsCategoryOf, type TipsCategory } from "@/lib/tips/category";
import { TipsRefresher, type TipsJobDeps } from "@/lib/tips/refresh";
import { displayableTips, readCategoryTips } from "@/lib/tips/store";
import type { Deal, ResultProduct, SearchResponse } from "@/lib/types";
import type { SortPreference } from "./filters";
import {
  isListableSearch,
  loadMore,
  MAX_QUERY_LENGTH,
  RESULTS_KEPT,
  runSearch,
  SearchError,
  toResultProduct,
  type SearchDeps,
  type SearchOrigin,
  type SearchOutcome,
} from "./pipeline";
import { hasHebrew } from "@/lib/product-title";
import { normalizeQuery } from "./cache-key";
import type { SearchLogEntry, SearchStore } from "./store";
import { SupabaseStore, type StoredProduct } from "./supabase-store";

export type SearchFailure =
  "invalid_query" | "rate_limited" | "capacity" | "parse_failed" | "upstream" | "unavailable";

export type SearchPageResult =
  | { ok: true; response: SearchResponse }
  | { ok: false; error: SearchFailure; retryAfterSec?: number };

const PRODUCT_ID = /^\d{1,20}$/;
const FILTERS_KEY = /^[0-9a-f]{64}$/;
const CLICK_SRC = /^[a-z0-9_-]{1,32}$/i;
const PRODUCT_TTL_MS = 24 * 3_600_000;
const LINK_MAX_AGE_MS = LINK_MAX_AGE_DAYS * 86_400_000;
const LAST_PAGE = Math.ceil(RESULTS_KEPT / RESULTS_PER_PAGE) - 1;
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

function searchDeps(dailyCap: number) {
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

function toFailure(err: unknown, where: string): SearchFailure {
  if (err instanceof SearchError) {
    if (err.code === "upstream") logError(where, err);
    return err.code;
  }
  logError(where, err);
  if (err instanceof AliExpressError || err instanceof LlmApiError) return "upstream";
  return "unavailable"; // config, database and anything unexpected
}

/** DAILY_SEARCH_CAP (units of LLM work per Israel day), for the admin stats. Throws ConfigError. */
export function dailySearchCap(): number {
  return guardEnv().dailyCap;
}

/**
 * A request that joined another request's run was served without any new work, so it is logged
 * like a cache hit: its own query, cache "results". Whether /searches may list it is decided again
 * for its own query and origin: the run it joined had the same source, chips removed and sort
 * (both part of the in-flight key) and showed the same results, but it may have been typed where
 * this one came from one of our links, or the other way round. Never throws.
 */
async function logShared(
  store: () => SearchStore,
  log: SearchLogEntry,
  q: string,
  origin: Omit<SearchOrigin, "source">,
) {
  try {
    await store().logSearch({
      ...log,
      query: q,
      queryNorm: normalizeQuery(q),
      cache: "results",
      listable: isListableSearch(q, { ...origin, source: log.source }, log.resultsCount),
    });
  } catch (err) {
    logError("search-log", err);
  }
}

/** Runs a search for a request. `headers` are the incoming request headers (for the IP). */
// Identical searches that arrive while one is still running share its result instead of paying
// for a second parse, fetch and explain (seen in testing: a refresh during a 10 s search ran it
// twice). Per server instance; the 14-day cache covers everything after the first run completes.
const inFlight = new Map<string, Promise<SearchOutcome>>();

async function sharedRun(
  q: string,
  without: string[],
  sort: SortPreference | undefined,
  typed: boolean,
  deps: SearchDeps,
): Promise<SearchOutcome> {
  const key = JSON.stringify([normalizeQuery(q), [...without].sort(), sort ?? null]);
  const running = inFlight.get(key);
  if (running) {
    const outcome = await running;
    await logShared(() => deps.store, outcome.log, q, { without, sort, typed });
    return outcome;
  }
  const run = runSearch({ q, without, sort, typed }, deps).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

/**
 * `typed` is false for a query from one of our own links (a recent-search card, an example): it is
 * searched and logged like any other, but never listed on /searches. Default true.
 */
export async function searchForRequest(
  input: { q: string; without?: string[]; sort?: SortPreference; typed?: boolean },
  headers: Headers,
): Promise<SearchPageResult> {
  const q = input.q.trim();
  if (!q || q.length > MAX_QUERY_LENGTH) return { ok: false, error: "invalid_query" };
  try {
    const env = guardEnv();
    if (!env.ipHashSalt) throw new ConfigError(["IP_HASH_SALT"]);
    const { db, deps } = searchDeps(env.dailyCap);
    // Every request counts, cached ones included: a cached search costs no LLM or AliExpress
    // call, but the limit is against scripted abuse, which can hammer cached queries just as
    // well (each still costs DB reads). Chip removals and sort changes count too; 20/hour
    // leaves room for refining.
    const rate = await checkSearchRate(db, hashIp(clientIp(headers), env.ipHashSalt), new Date());
    if (!rate.ok) return { ok: false, error: "rate_limited", retryAfterSec: rate.retryAfterSec };
    const { response } = await sharedRun(
      q,
      input.without ?? [],
      input.sort,
      input.typed ?? true,
      deps,
    );
    return { ok: true, response };
  } catch (err) {
    return { ok: false, error: toFailure(err, "search") };
  }
}

export type MoreResult =
  | { ok: true; results: ResultProduct[]; more_available: boolean }
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
 * "עוד 3 אפשרויות" for a cached result set. `page` is 1 for results 4-6. A page that still needs an
 * explain call counts against the visitor's per-IP limit (when `headers` are given) before the
 * daily LLM budget, so one client cannot drain the budget with parallel requests. Pages that are
 * already explained are free.
 */
export async function moreForRequest(
  filtersKey: string,
  page: number,
  headers?: Headers,
): Promise<MoreResult> {
  if (!FILTERS_KEY.test(filtersKey) || !Number.isInteger(page) || page < 1 || page > LAST_PAGE) {
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
    const out = await loadMore(filtersKey, page, { ...deps, beforeLlmWork });
    if (!out) return { ok: false, error: "not_found" };
    return { ok: true, results: out.results, more_available: out.more_available };
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
 * Product saved by one of our searches; refreshed from productdetail.get when older than 24h.
 * Unknown ids return null (404): only products that went through our filters get a page, and a
 * crawler requesting random ids cannot spend AliExpress quota.
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
  let fresh: AliProduct | null;
  try {
    const ali = aliClient();
    const spaced = aliSpacer();
    fresh = await refreshProduct(ali, spaced, stored, now);
    if (fresh && SKU_DETAILS_ENABLED) {
      fresh = { ...fresh, skuDetails: await spaced(() => skuDetailsFor(ali, productId)) };
    }
  } catch (err) {
    logError("product", err);
    // Real data from the last refresh (with its date) beats a 404 while AliExpress is down.
    return stored;
  }
  if (!fresh) return null;
  const titleHe = stored.titleHe;
  await store
    .saveProducts([fresh], { [productId]: titleHe })
    .catch((err) => logError("product", err));
  return { product: fresh, titleHe, updatedAt: now.toISOString() };
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

const PREVIEW_RETRY_MS = 10 * 60_000;
const previews = new Map<string, { run: Promise<SearchOutcome | null>; failedAt?: number }>();

async function runPreview(q: string): Promise<SearchOutcome | null> {
  try {
    return await runSearch({ q, source: "preview" }, searchDeps(guardEnv().dailyCap).deps);
  } catch (err) {
    toFailure(err, "preview");
    return null;
  }
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
  // Renders arriving together while the cache is cold share one paid run per instance. A failure
  // is remembered for a while: during an outage every landing page render would otherwise start a
  // new paid run and use up the daily LLM budget that real searches need.
  const key = q.trim();
  const entry = previews.get(key);
  const retry = entry?.failedAt !== undefined && Date.now() - entry.failedAt >= PREVIEW_RETRY_MS;
  if (entry && !retry) {
    const shared = await entry.run;
    if (shared) {
      const origin = { without: [], typed: false };
      await logShared(() => new SupabaseStore(serviceClient()), shared.log, key, origin);
    }
    return shared?.response ?? null;
  }
  const run: Promise<SearchOutcome | null> = runPreview(key).then((outcome) => {
    if (outcome) previews.delete(key);
    else previews.set(key, { run, failedAt: Date.now() });
    return outcome;
  });
  previews.set(key, { run });
  return (await run)?.response ?? null;
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

/** Logs a click and returns the affiliate link to redirect to, or null when there is none. */
export async function clickOut(productId: string, src: string): Promise<string | null> {
  if (!PRODUCT_ID.test(productId)) return null;
  try {
    const db = serviceClient();
    const store = new SupabaseStore(db);
    const stored = await store.getProduct(productId);
    if (!stored) return null;
    const [link] = await Promise.all([
      affiliateLink(db, stored, new Date()),
      store
        .logClick(productId, CLICK_SRC.test(src) ? src : "other")
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
