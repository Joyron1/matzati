// Fetches one category's hot list from AliExpress (hotproduct.query), keeps what we show
// (select.ts) and saves those products to the products table, so /p/<id> and /go work for every
// card. lib/hot/queries.ts caches the result for HOT_LIST_TTL_MS, so a list is fetched here about
// twice a day.
//
// Per server instance, because the app key's frequency ban (about a second) is shared by every
// caller: requests that arrive while a list is being fetched join that fetch; a list fetched in the
// last RECENT_MS is reused while the cache entry is still being written; a list that failed is not
// fetched again until its retry time (retryDelayMs); and this instance's hot calls start at least
// ALI_SPACING_MS apart. One list costs one call (plus the client's retries of a rate limit or a
// server error, at most two), plus the hot links call below: never a second page, since two calls
// seconds apart return different lists (docs/aliexpress-api.md, Hot products).
//
// Retry times: a lasting failure (a missing permission or key, a rejected request, a list where
// nothing passes our filters) waits HOT_LIST_TTL_MS, as long as a good list is kept. A passing one
// (rate limit, server, network, unreadable response) waits RETRY_AFTER_FAILURE_MS, then twice as
// long after each further failure in a row, up to HOT_LIST_TTL_MS. A good list resets the count.
// While a list waits, lib/hot/queries.ts serves its last list without reading the cache: a stale
// cache entry starts a background refresh on every view, which would be refused here and logged
// by Next (unstable_cache) each time.
//
// Links (owner decision 2026-09-28, lib/hot/links.ts): once the list is selected, the kept products
// whose hot rate beats their standard rate get a link.generate hot link (promotion_link_type 2) in
// ONE batched call, spaced after the list call like any other; the rest keep the promotion_link
// hotproduct.query returned (made with our tracking id, type unknown). When that call fails, or
// sends no usable link for a product, the product keeps the fresh type 2 link its stored row holds
// from an earlier fetch (HotFetchDeps.storedLinks, one read, only then), else the list's link: the
// list itself never fails over it. The links change nothing in what is shown or in what order. So
// a cold list costs two calls. Whether either link type earns the hot commission is UNCONFIRMED
// until orders show it (docs/aliexpress-api.md, Hot link).
import { HOT_LINK_TYPE, generateLinks, queryHotProducts } from "@/lib/aliexpress/affiliate";
import type { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError, type AliExpressErrorKind } from "@/lib/aliexpress/errors";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { HotCategoryId } from "./categories";
import {
  hotLinkSources,
  productsWithoutHotLink,
  withHotLinks,
  withStoredHotLinks,
  type StoredLinkRow,
} from "./links";
import { selectHotProducts, toHotProduct, type HotProduct } from "./select";

export interface HotPool {
  key: HotCategoryId;
  /** What we show, by 30-day sales. Never empty. */
  products: HotProduct[];
  /** Products AliExpress returned, before our filters. */
  checked: number;
  /** When AliExpress returned the list (ISO). */
  fetchedAt: string;
}

export interface HotFetchDeps {
  ali: AliExpressClient;
  /**
   * Saves the shown products (full data, AliExpress's Hebrew titles, source "hot") as checked at
   * `fetchedAt`.
   */
  saveProducts: (products: AliProduct[], fetchedAt: Date) => Promise<void>;
  /**
   * The link fields of the stored rows among `productIds` (products.data). Read only when the hot
   * links call leaves products it was for without a hot link, so a refetch keeps their fresh
   * stored type 2 links. Without it they keep the list's links.
   */
  storedLinks?: (productIds: string[]) => Promise<StoredLinkRow[]>;
}

export type HotPoolFailure = "empty" | "failed";

export class HotPoolError extends Error {
  constructor(
    readonly reason: HotPoolFailure,
    message: string,
    /** True when no call was made: the list failed recently and waits for its retry. */
    readonly waiting = false,
  ) {
    super(message);
    this.name = "HotPoolError";
  }
}

/** How long a good list is kept (lib/hot/queries.ts), and the longest wait after a failure. */
export const HOT_LIST_TTL_MS = 12 * 3_600_000;
/** The first wait after a passing failure; each further failure in a row doubles it. */
export const RETRY_AFTER_FAILURE_MS = 10 * 60_000;
/** A list fetched this recently is reused (covers the moment before the cache entry is written). */
export const RECENT_MS = 60_000;
/** Gap between two hot calls of this instance (the search pipeline and /p space theirs alike). */
export const ALI_SPACING_MS = 1_100;

/** "transient" failures are retried sooner (see the file comment); everything else is "lasting". */
export type HotFailureKind = "transient" | "lasting";

const TRANSIENT_KINDS: ReadonlySet<AliExpressErrorKind> = new Set([
  "rate_limit",
  "server",
  "network",
  "bad_response",
  "unknown", // a gateway code we do not know: backed off, not given up on
]);

export function failureKind(err: unknown): HotFailureKind {
  return err instanceof AliExpressError && TRANSIENT_KINDS.has(err.kind) ? "transient" : "lasting";
}

/** The wait before the next call after `attempts` (1, 2, …) failures in a row. */
export function retryDelayMs(kind: HotFailureKind, attempts: number): number {
  if (kind === "lasting") return HOT_LIST_TTL_MS;
  return Math.min(RETRY_AFTER_FAILURE_MS * 2 ** Math.max(0, attempts - 1), HOT_LIST_TTL_MS);
}

export interface HotPoolLoaderOptions {
  recentMs?: number;
  spacingMs?: number;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

const errorText = (err: unknown) =>
  err instanceof Error ? `${err.name}: ${err.message}` : String(err);

interface Failure {
  reason: HotPoolFailure;
  /** Failures in a row, for the back-off. */
  attempts: number;
  /** No call before this time (clock ms). */
  retryAt: number;
}

export class HotPoolLoader {
  private readonly inFlight = new Map<HotCategoryId, Promise<HotPool>>();
  private readonly recent = new Map<HotCategoryId, { pool: HotPool; at: number }>();
  private readonly failures = new Map<HotCategoryId, Failure>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallEnd: number | null = null;
  private readonly recentMs: number;
  private readonly spacingMs: number;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (message: string) => void;

  constructor(options: HotPoolLoaderOptions = {}) {
    this.recentMs = options.recentMs ?? RECENT_MS;
    this.spacingMs = options.spacingMs ?? ALI_SPACING_MS;
    this.clock = options.clock ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = options.log ?? ((m) => console.error(`[hot] ${m.slice(0, 500)}`));
  }

  /** True while `key` failed and waits for its retry time: load() would make no call. */
  isWaiting(key: HotCategoryId): boolean {
    const failed = this.failures.get(key);
    return failed !== undefined && this.clock() < failed.retryAt;
  }

  /**
   * The list for `key`, fetched now unless a fetch is running or just finished. Rejects with a
   * HotPoolError ("empty" when nothing passed our filters, "failed" otherwise), so the caller's
   * cache keeps the list it had. `deps` is called inside the fetch, so a config error (a missing
   * key) counts as a failure too.
   */
  load(key: HotCategoryId, deps: () => HotFetchDeps): Promise<HotPool> {
    const running = this.inFlight.get(key);
    if (running) return running;
    const now = this.clock();
    const recent = this.recent.get(key);
    if (recent && now - recent.at < this.recentMs) return Promise.resolve(recent.pool);
    const failed = this.failures.get(key);
    if (failed && now < failed.retryAt) {
      return Promise.reject(new HotPoolError(failed.reason, `${key}: waiting to retry`, true));
    }

    const run = this.fetch(key, deps)
      .then(
        (pool) => {
          this.failures.delete(key);
          this.recent.set(key, { pool, at: this.clock() });
          return pool;
        },
        (err: unknown) => {
          const reason = err instanceof HotPoolError ? err.reason : "failed";
          const attempts = (this.failures.get(key)?.attempts ?? 0) + 1;
          const wait = retryDelayMs(failureKind(err), attempts);
          this.failures.set(key, { reason, attempts, retryAt: this.clock() + wait });
          const next = `next try in ${Math.round(wait / 60_000)} min`;
          throw new HotPoolError(
            reason,
            `${err instanceof HotPoolError ? err.message : errorText(err)} (${next})`,
          );
        },
      )
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, run);
    return run;
  }

  /** Runs one AliExpress call after this instance's previous one, ALI_SPACING_MS after it ended. */
  private spaced<T>(call: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastCallEnd === null ? 0 : this.lastCallEnd + this.spacingMs - this.clock();
      if (wait > 0) await this.sleep(wait);
      try {
        return await call();
      } finally {
        this.lastCallEnd = this.clock();
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * `products` (already selected) with a hot link for each one that pays a hot rate: one
   * link.generate call with promotion_link_type 2, spaced after the list call. Never throws: a
   * product the call gives no link (all of them when it fails) keeps its stored fresh hot link
   * (keepStoredHotLinks), else the list's link. Neither the set nor the order changes.
   */
  private async withHotLinks(
    key: HotCategoryId,
    deps: Pick<HotFetchDeps, "ali" | "storedLinks">,
    products: AliProduct[],
  ): Promise<AliProduct[]> {
    const sources = hotLinkSources(products);
    if (!sources.length) return products;
    let linked = products;
    try {
      const links = await this.spaced(() =>
        generateLinks(deps.ali, sources, { promotionLinkType: HOT_LINK_TYPE }),
      );
      linked = withHotLinks(products, links, new Date(this.clock()).toISOString());
      const made = linked.filter((p) => p.promotionLinkType === HOT_LINK_TYPE).length;
      if (made < sources.length) {
        this.log(`${key}: ${made} of ${sources.length} hot links made; the rest keep the list's`);
      }
    } catch (err) {
      this.log(`${key}: hot links not made, the list's links are kept: ${errorText(err)}`);
    }
    return this.keepStoredHotLinks(key, deps.storedLinks, linked);
  }

  /**
   * `products` where each one the hot links call left without a hot link keeps the fresh type 2
   * link of its stored row (withStoredHotLinks), with that link's time. One read, only when such
   * products exist. Never throws: when the read fails they keep the list's links.
   */
  private async keepStoredHotLinks(
    key: HotCategoryId,
    storedLinks: HotFetchDeps["storedLinks"],
    products: AliProduct[],
  ): Promise<AliProduct[]> {
    const missing = productsWithoutHotLink(products);
    if (!missing.length || !storedLinks) return products;
    try {
      const kept = withStoredHotLinks(products, await storedLinks(missing), this.clock());
      const count = (ps: AliProduct[]) =>
        ps.filter((p) => p.promotionLinkType === HOT_LINK_TYPE).length;
      const reused = count(kept) - count(products);
      if (reused) this.log(`${key}: ${reused} of ${missing.length} kept their stored hot link`);
      return kept;
    } catch (err) {
      this.log(`${key}: stored hot links not read, the list's links are kept: ${errorText(err)}`);
      return products;
    }
  }

  private async fetch(key: HotCategoryId, makeDeps: () => HotFetchDeps): Promise<HotPool> {
    const deps = makeDeps();
    const { ali, saveProducts } = deps;
    const page = await this.spaced(() => queryHotProducts(ali, { categoryId: key }));
    const fetchedAt = new Date(this.clock());
    const selected = selectHotProducts(page.products);
    if (!selected.length) {
      throw new HotPoolError("empty", `${key}: none of ${page.products.length} products passed`);
    }
    // The saved rows and the returned list are built from this one array, so they agree.
    const kept = await this.withHotLinks(key, deps, selected);
    try {
      // Without a Hebrew title of ours: title_he holds the LLM's titles only. Marked as saved from
      // a hot list, so a /p refresh keeps the title in Hebrew and this list's link
      // (lib/search/server.ts); rows a search titled are left alone (SupabaseStore.saveProducts).
      await saveProducts(
        kept.map((p) => ({ ...p, source: "hot" as const })),
        fetchedAt,
      );
    } catch (err) {
      // The list is still shown; a card whose product was not saved leads to a 404 on /p.
      this.log(`${key}: products not saved: ${errorText(err)}`);
    }
    return {
      key,
      products: kept.map(toHotProduct),
      checked: page.products.length + page.skipped,
      fetchedAt: fetchedAt.toISOString(),
    };
  }
}
