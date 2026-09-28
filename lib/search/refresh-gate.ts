// Guards the /p refresh (productdetail.get, lib/search/server.ts) per server instance, like the /go
// link reuse and the hot list loader. AliExpress throttles productdetail.get hard (ApiCallLimit on
// calls 12 s apart, 2026-09-28) and the page serves the stored row when a refresh fails, so without
// this every view of a stale product would call it again:
// - views of one product that arrive while its refresh runs share that refresh (one call);
// - a product whose refresh failed (any error) is not refreshed again for FAILURE_COOLDOWN_MS, and
//   neither is one AliExpress no longer returns (a remembered value, `remember`);
// - after a rate limit (ApiCallLimit) no product is refreshed for RATE_LIMIT_BACKOFF_MS, doubling
//   with each rate limit in a row up to MAX_RATE_LIMIT_BACKOFF_MS; a refresh that works resets it,
//   unless a rate limit came after that refresh's call went out (it only answered late).
// A refresh that is skipped costs no call; the caller serves what it has. Pure apart from the clock.

/** How long a product whose refresh failed (or that is gone) waits before the next refresh. */
export const FAILURE_COOLDOWN_MS = 10 * 60_000;
/** The first wait of every product after a rate limit; each further one in a row doubles it. */
export const RATE_LIMIT_BACKOFF_MS = 60_000;
export const MAX_RATE_LIMIT_BACKOFF_MS = 10 * 60_000;

export type SkipReason =
  /** The refresh ran now (or this request joined it) and failed. */
  | "failed"
  /** This product failed within FAILURE_COOLDOWN_MS: no call. */
  | "cooling"
  /** Every product waits after a rate limit: no call. */
  | "backoff";

export type RefreshOutcome<T> = { ok: true; value: T } | { ok: false; reason: SkipReason };

export interface RefreshGateOptions<T> {
  clock?: () => number;
  failureCooldownMs?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  /** True for an error that means the app key is being throttled (starts the back-off). */
  isRateLimit?: (err: unknown) => boolean;
  /** A value to serve again for the cooldown without a call (a product AliExpress did not return). */
  remember?: (value: T) => boolean;
  /** Called once per failed refresh (never for a skipped one or a request that joined it). */
  onFailure?: (err: unknown) => void;
}

interface Remembered<T> {
  at: number;
  outcome: RefreshOutcome<T>;
}

/** The wait of every product after `streak` (1, 2, …) rate limits in a row. */
export function rateLimitBackoffMs(
  streak: number,
  base = RATE_LIMIT_BACKOFF_MS,
  max = MAX_RATE_LIMIT_BACKOFF_MS,
): number {
  return Math.min(base * 2 ** Math.max(0, streak - 1), max);
}

export class RefreshGate<T> {
  private readonly running = new Map<string, Promise<RefreshOutcome<T>>>();
  private readonly remembered = new Map<string, Remembered<T>>();
  private backoffUntil = 0;
  /** Rate limits in a row (the back-off's streak); reset by a success. */
  private rateLimits = 0;
  /** Every rate limit ever seen: orders a success against the rate limits around it. */
  private rateLimitsSeen = 0;
  private readonly clock: () => number;
  private readonly cooldownMs: number;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly isRateLimit: (err: unknown) => boolean;
  private readonly remember: (value: T) => boolean;
  private readonly onFailure: (err: unknown) => void;

  constructor(options: RefreshGateOptions<T> = {}) {
    // Read through a function so fake timers in tests move it.
    this.clock = options.clock ?? (() => Date.now());
    this.cooldownMs = options.failureCooldownMs ?? FAILURE_COOLDOWN_MS;
    this.backoffMs = options.backoffMs ?? RATE_LIMIT_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? MAX_RATE_LIMIT_BACKOFF_MS;
    this.isRateLimit = options.isRateLimit ?? (() => false);
    this.remember = options.remember ?? (() => false);
    this.onFailure = options.onFailure ?? (() => {});
  }

  /** True while every refresh waits after a rate limit. */
  backingOff(): boolean {
    return this.clock() < this.backoffUntil;
  }

  /** Products whose failure or value is remembered now (for tests and logs). */
  get rememberedCount(): number {
    this.prune(this.clock());
    return this.remembered.size;
  }

  /**
   * `refresh()` for `key`, unless a refresh of `key` is running (its outcome is shared), `key` has
   * a remembered failure or value, or every refresh waits after a rate limit. Never throws.
   */
  run(key: string, refresh: () => Promise<T>): Promise<RefreshOutcome<T>> {
    const joined = this.running.get(key);
    if (joined) return joined;
    const now = this.clock();
    this.prune(now);
    const last = this.remembered.get(key);
    if (last) return Promise.resolve(last.outcome.ok ? last.outcome : failed("cooling"));
    if (now < this.backoffUntil) return Promise.resolve(failed("backoff"));

    const run = this.start(refresh).then((outcome) => {
      if (!outcome.ok || this.remember(outcome.value)) {
        this.remembered.set(key, { at: this.clock(), outcome });
      }
      return outcome;
    });
    const shared = run.finally(() => this.running.delete(key));
    this.running.set(key, shared);
    return shared;
  }

  private async start(refresh: () => Promise<T>): Promise<RefreshOutcome<T>> {
    // Rate limits so far: a success clears the back-off only when no rate limit came after its
    // call went out. A call that started earlier and simply answered late (another product, at
    // the same time) says nothing about the key's throttle now.
    const limitsBefore = this.rateLimitsSeen;
    try {
      const value = await refresh();
      if (this.rateLimitsSeen === limitsBefore) {
        this.rateLimits = 0;
        this.backoffUntil = 0;
      }
      return { ok: true, value };
    } catch (err) {
      if (this.isRateLimit(err)) {
        this.rateLimitsSeen++;
        this.rateLimits++;
        const until =
          this.clock() + rateLimitBackoffMs(this.rateLimits, this.backoffMs, this.maxBackoffMs);
        this.backoffUntil = Math.max(this.backoffUntil, until);
      }
      try {
        this.onFailure(err);
      } catch {
        // A logging problem never turns a refresh into an exception.
      }
      return failed("failed");
    }
  }

  /** Drops what nobody may reuse any more, so the map holds only the last cooldown's products. */
  private prune(now: number) {
    for (const [key, entry] of this.remembered) {
      if (now - entry.at >= this.cooldownMs) this.remembered.delete(key);
    }
  }
}

const failed = <T>(reason: SkipReason): RefreshOutcome<T> => ({ ok: false, reason });
