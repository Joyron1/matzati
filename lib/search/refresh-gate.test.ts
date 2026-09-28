// RefreshGate (the /p refresh guard) on a fake clock: shared runs, the per-product cooldown after a
// failure, the back-off of every product after a rate limit, and remembered values.
import { describe, expect, it, vi } from "vitest";
import {
  FAILURE_COOLDOWN_MS,
  MAX_RATE_LIMIT_BACKOFF_MS,
  RATE_LIMIT_BACKOFF_MS,
  RefreshGate,
  rateLimitBackoffMs,
} from "./refresh-gate";

class RateLimited extends Error {}

function setup() {
  const clock = { now: Date.parse("2026-09-28T12:00:00Z") };
  const onFailure = vi.fn();
  const gate = new RefreshGate<string | null>({
    clock: () => clock.now,
    isRateLimit: (err) => err instanceof RateLimited,
    remember: (value) => value === null,
    onFailure,
  });
  const advance = (ms: number) => (clock.now += ms);
  return { gate, onFailure, advance };
}

const ok = (value: string | null) => vi.fn(async () => value);
const failing = (err: Error = new Error("network")) =>
  vi.fn(async (): Promise<string | null> => {
    throw err;
  });

/** A refresh that resolves when the test says so. */
function deferred() {
  let resolve: (value: string) => void = () => {};
  let reject: (err: Error) => void = () => {};
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { refresh: vi.fn(() => promise), resolve, reject };
}

describe("RefreshGate", () => {
  it("runs a refresh and does not remember a success: the next stale view refreshes again", async () => {
    const { gate } = setup();
    const refresh = ok("fresh");
    await expect(gate.run("a", refresh)).resolves.toEqual({ ok: true, value: "fresh" });
    await expect(gate.run("a", refresh)).resolves.toEqual({ ok: true, value: "fresh" });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(gate.rememberedCount).toBe(0);
  });

  it("lets views that arrive together share one refresh of a product", async () => {
    const { gate } = setup();
    const d = deferred();
    const views = [gate.run("a", d.refresh), gate.run("a", d.refresh), gate.run("a", d.refresh)];
    d.resolve("fresh");
    await expect(Promise.all(views)).resolves.toEqual([
      { ok: true, value: "fresh" },
      { ok: true, value: "fresh" },
      { ok: true, value: "fresh" },
    ]);
    expect(d.refresh).toHaveBeenCalledTimes(1);
  });

  it("shares a failing refresh too, and reports its error once", async () => {
    const { gate, onFailure } = setup();
    const d = deferred();
    const views = [gate.run("a", d.refresh), gate.run("a", d.refresh)];
    const err = new Error("timeout");
    d.reject(err);
    await expect(Promise.all(views)).resolves.toEqual([
      { ok: false, reason: "failed" },
      { ok: false, reason: "failed" },
    ]);
    expect(d.refresh).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(err);
  });

  it("refreshes other products separately", async () => {
    const { gate } = setup();
    const a = deferred();
    const b = ok("b");
    const first = gate.run("a", a.refresh);
    await expect(gate.run("b", b)).resolves.toEqual({ ok: true, value: "b" });
    a.resolve("a");
    await expect(first).resolves.toEqual({ ok: true, value: "a" });
  });

  it("does not refresh a failed product again for FAILURE_COOLDOWN_MS, then does", async () => {
    const { gate, advance } = setup();
    const broken = failing();
    await expect(gate.run("a", broken)).resolves.toEqual({ ok: false, reason: "failed" });
    advance(FAILURE_COOLDOWN_MS - 1);
    const refresh = ok("fresh");
    await expect(gate.run("a", refresh)).resolves.toEqual({ ok: false, reason: "cooling" });
    expect(refresh).not.toHaveBeenCalled();
    // Another product is not held back by it (not a rate limit).
    await expect(gate.run("b", refresh)).resolves.toEqual({ ok: true, value: "fresh" });
    advance(1);
    await expect(gate.run("a", refresh)).resolves.toEqual({ ok: true, value: "fresh" });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("holds every product back for RATE_LIMIT_BACKOFF_MS after a rate limit", async () => {
    const { gate, advance } = setup();
    await gate.run("a", failing(new RateLimited("ApiCallLimit")));
    expect(gate.backingOff()).toBe(true);
    advance(RATE_LIMIT_BACKOFF_MS - 1);
    const other = ok("b");
    await expect(gate.run("b", other)).resolves.toEqual({ ok: false, reason: "backoff" });
    expect(other).not.toHaveBeenCalled();
    advance(1);
    expect(gate.backingOff()).toBe(false);
    await expect(gate.run("b", other)).resolves.toEqual({ ok: true, value: "b" });
    // The throttled product itself still waits out its own cooldown.
    await expect(gate.run("a", other)).resolves.toEqual({ ok: false, reason: "cooling" });
  });

  it("doubles the back-off with each rate limit in a row, and a refresh that works resets it", async () => {
    const { gate, advance } = setup();
    const waits: number[] = [];
    for (const key of ["a", "b", "c"]) {
      await gate.run(key, failing(new RateLimited()));
      let waited = 0;
      while (gate.backingOff()) {
        advance(1_000);
        waited += 1_000;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([
      RATE_LIMIT_BACKOFF_MS,
      2 * RATE_LIMIT_BACKOFF_MS,
      4 * RATE_LIMIT_BACKOFF_MS,
    ]);
    await gate.run("d", ok("d"));
    await gate.run("e", failing(new RateLimited()));
    advance(RATE_LIMIT_BACKOFF_MS);
    expect(gate.backingOff()).toBe(false);
  });

  it("keeps the back-off when a refresh sent before the rate limit answers after it", async () => {
    const { gate, advance } = setup();
    // Product a's call goes out, then b's call is throttled, then a's answer arrives.
    const slow = deferred();
    const a = gate.run("a", slow.refresh);
    await gate.run("b", failing(new RateLimited("ApiCallLimit")));
    expect(gate.backingOff()).toBe(true);
    slow.resolve("fresh");
    await expect(a).resolves.toEqual({ ok: true, value: "fresh" });
    expect(gate.backingOff()).toBe(true);
    const other = ok("c");
    await expect(gate.run("c", other)).resolves.toEqual({ ok: false, reason: "backoff" });
    expect(other).not.toHaveBeenCalled();
    // The streak also stands: the next rate limit after the wait doubles it.
    advance(RATE_LIMIT_BACKOFF_MS);
    await gate.run("d", failing(new RateLimited()));
    advance(RATE_LIMIT_BACKOFF_MS);
    expect(gate.backingOff()).toBe(true);
    advance(RATE_LIMIT_BACKOFF_MS);
    expect(gate.backingOff()).toBe(false);
    // A refresh sent after the last rate limit that works clears it as before.
    await gate.run("e", failing(new RateLimited()));
    advance(4 * RATE_LIMIT_BACKOFF_MS);
    await gate.run("f", ok("f"));
    await gate.run("g", failing(new RateLimited()));
    advance(RATE_LIMIT_BACKOFF_MS);
    expect(gate.backingOff()).toBe(false);
  });

  it("caps the back-off at MAX_RATE_LIMIT_BACKOFF_MS", () => {
    expect([1, 2, 3, 4].map((n) => rateLimitBackoffMs(n))).toEqual([
      60_000, 120_000, 240_000, 480_000,
    ]);
    expect(rateLimitBackoffMs(5)).toBe(MAX_RATE_LIMIT_BACKOFF_MS);
    expect(rateLimitBackoffMs(40)).toBe(MAX_RATE_LIMIT_BACKOFF_MS);
  });

  it("serves a remembered value (a product that is gone) for the cooldown without a call", async () => {
    const { gate, advance } = setup();
    const gone = ok(null);
    await expect(gate.run("a", gone)).resolves.toEqual({ ok: true, value: null });
    advance(FAILURE_COOLDOWN_MS - 1);
    await expect(gate.run("a", gone)).resolves.toEqual({ ok: true, value: null });
    expect(gone).toHaveBeenCalledTimes(1);
    advance(1);
    await gate.run("a", gone);
    expect(gone).toHaveBeenCalledTimes(2);
  });

  it("forgets what nobody may reuse any more", async () => {
    const { gate, advance } = setup();
    await gate.run("a", failing());
    await gate.run("b", ok(null));
    expect(gate.rememberedCount).toBe(2);
    advance(FAILURE_COOLDOWN_MS);
    expect(gate.rememberedCount).toBe(0);
  });

  it("never throws, even when the refresh throws before its promise or the logger fails", async () => {
    const gate = new RefreshGate<string>({
      onFailure: () => {
        throw new Error("log sink down");
      },
    });
    const sync = vi.fn((): Promise<string> => {
      throw new Error("config");
    });
    await expect(gate.run("a", sync)).resolves.toEqual({ ok: false, reason: "failed" });
  });
});
