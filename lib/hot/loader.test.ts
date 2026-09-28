// HotPoolLoader against a fake AliExpress gateway serving the probe's masked responses
// (fixtures/aliexpress/probe-hot). Nothing here reaches AliExpress or Supabase.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { FILTERS } from "@/lib/ranking/config";
import { AliExpressError } from "@/lib/aliexpress/errors";
import {
  ALI_SPACING_MS,
  HOT_LIST_TTL_MS,
  HotPoolError,
  HotPoolLoader,
  RECENT_MS,
  RETRY_AFTER_FAILURE_MS,
  failureKind,
  retryDelayMs,
  type HotFetchDeps,
} from "./loader";
import { PER_SHOP } from "./select";

const METHOD = "aliexpress.affiliate.hotproduct.query";
const fixtureText = (name: string) =>
  readFileSync(`fixtures/aliexpress/probe-hot/${METHOD}.${name}.json`, "utf8");
const EMPTY = JSON.stringify({
  aliexpress_affiliate_hotproduct_query_response: {
    resp_result: { resp_code: 405, resp_msg: "The result is empty" },
  },
});
const DENIED = JSON.stringify({
  error_response: { type: "ISV", code: "InsufficientPermission", msg: "no permission" },
});
const BANNED = JSON.stringify({
  error_response: { type: "ISV", code: "ApiCallLimit", msg: "this ban will last 1 seconds" },
});
const MINUTE = 60_000;

function setup(bodies: string[]) {
  let now = Date.parse("2026-09-28T12:00:00Z");
  const fetchMock = vi.fn<typeof fetch>();
  for (const body of bodies) fetchMock.mockImplementationOnce(async () => new Response(body));
  const client = new AliExpressClient(
    { appKey: "k", appSecret: "secret", trackingId: "trk", gateway: "https://g.test/sync" },
    { fetch: fetchMock, sleep: async () => {}, retries: 0 },
  );
  const saved: { products: AliProduct[]; fetchedAt: Date }[] = [];
  const saveProducts = vi.fn(async (products: AliProduct[], fetchedAt: Date) => {
    saved.push({ products, fetchedAt });
  });
  const sleeps: number[] = [];
  const log = vi.fn();
  const loader = new HotPoolLoader({
    clock: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    log,
  });
  const deps = (): HotFetchDeps => ({ ali: client, saveProducts });
  const sent = (call: number) => new URLSearchParams(String(fetchMock.mock.calls[call][1]?.body));
  return {
    loader,
    deps,
    fetchMock,
    sent,
    saved,
    saveProducts,
    sleeps,
    log,
    advance: (ms: number) => (now += ms),
  };
}

describe("HotPoolLoader", () => {
  it("fetches a category's list once, keeps what passes and saves those products", async () => {
    const t = setup([fixtureText("cat44-HE")]);
    const pool = await t.loader.load("44", t.deps);
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    expect(t.sent(0).get("method")).toBe(METHOD);
    expect(t.sent(0).get("category_ids")).toBe("44");
    expect(t.sent(0).get("target_language")).toBe("HE");
    expect(pool.key).toBe("44");
    expect(pool.checked).toBe(46);
    expect(pool.fetchedAt).toBe("2026-09-28T12:00:00.000Z");
    expect(pool.products.length).toBeGreaterThan(30);
    for (const p of pool.products) {
      expect(p.positiveFeedbackPct).toBeGreaterThanOrEqual(FILTERS.minPositiveFeedbackPct);
      expect(p.unitsSold).toBeGreaterThanOrEqual(FILTERS.minUnitsSold);
    }
    // The shown products are saved in full (links included), with the fetch time, once.
    expect(t.saved).toHaveLength(1);
    expect(t.saved[0].fetchedAt.toISOString()).toBe(pool.fetchedAt);
    expect(t.saved[0].products.map((p) => p.productId)).toEqual(
      pool.products.map((p) => p.productId),
    );
    expect(t.saved[0].products.every((p) => p.promotionLink?.startsWith("https://"))).toBe(true);
    // Marked, so a /p refresh keeps the Hebrew title and this list's link.
    expect(t.saved[0].products.every((p) => p.source === "hot")).toBe(true);
  });

  it("gives one shop at most PER_SHOP places in a list", async () => {
    const t = setup([fixtureText("cat44-HE")]);
    const pool = await t.loader.load("44", t.deps);
    const shops = new Map<string, number>();
    for (const p of pool.products) {
      if (p.shopId) shops.set(p.shopId, (shops.get(p.shopId) ?? 0) + 1);
    }
    // The fixture has a shop with 4 products.
    expect(Math.max(...shops.values())).toBe(PER_SHOP);
  });

  it("lets concurrent requests for a list share one call", async () => {
    const t = setup([fixtureText("cat44-HE")]);
    const [a, b, c] = await Promise.all([
      t.loader.load("44", t.deps),
      t.loader.load("44", t.deps),
      t.loader.load("44", t.deps),
    ]);
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("reuses a list fetched in the last RECENT_MS, then fetches again", async () => {
    const t = setup([fixtureText("cat44-HE"), fixtureText("cat44-HE.page2")]);
    const first = await t.loader.load("44", t.deps);
    t.advance(RECENT_MS - 1);
    expect(await t.loader.load("44", t.deps)).toBe(first);
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    t.advance(1);
    const second = await t.loader.load("44", t.deps);
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
    expect(second.products[0].productId).not.toBe(first.products[0].productId);
  });

  it("spaces this instance's calls ALI_SPACING_MS apart", async () => {
    const t = setup([fixtureText("cat44-HE"), fixtureText("all-HE")]);
    await Promise.all([t.loader.load("44", t.deps), t.loader.load("15", t.deps)]);
    expect(t.sent(1).get("category_ids")).toBe("15");
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
    expect(t.sleeps).toEqual([ALI_SPACING_MS]);
  });

  /** Loads "44" `ms` from now (advancing the clock) and says whether AliExpress was called. */
  async function callsAfter(t: ReturnType<typeof setup>, ms: number): Promise<boolean> {
    t.advance(ms);
    const before = t.fetchMock.mock.calls.length;
    await t.loader.load("44", t.deps).catch(() => undefined);
    return t.fetchMock.mock.calls.length > before;
  }

  it("does not call again for RETRY_AFTER_FAILURE_MS after a passing failure", async () => {
    const t = setup([BANNED, fixtureText("cat44-HE")]);
    await expect(t.loader.load("44", t.deps)).rejects.toMatchObject({
      name: "HotPoolError",
      reason: "failed",
      waiting: false,
    });
    expect(t.loader.isWaiting("44")).toBe(true);
    t.advance(RETRY_AFTER_FAILURE_MS - 1);
    await expect(t.loader.load("44", t.deps)).rejects.toMatchObject({
      reason: "failed",
      waiting: true,
    });
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
    // Once the wait is over, the next view calls again.
    t.advance(1);
    expect(t.loader.isWaiting("44")).toBe(false);
    await expect(t.loader.load("44", t.deps)).resolves.toMatchObject({ key: "44" });
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
    expect(t.saveProducts).toHaveBeenCalledTimes(1);
  });

  it("doubles the wait after each passing failure in a row, and starts over after a good list", async () => {
    const t = setup([BANNED, BANNED, BANNED, fixtureText("cat44-HE"), BANNED, BANNED]);
    await t.loader.load("44", t.deps).catch(() => undefined);
    // 10, then 20, then 40 minutes.
    expect(await callsAfter(t, 10 * MINUTE)).toBe(true);
    expect(await callsAfter(t, 20 * MINUTE - 1)).toBe(false);
    expect(await callsAfter(t, 1)).toBe(true);
    expect(await callsAfter(t, 40 * MINUTE - 1)).toBe(false);
    expect(await callsAfter(t, 1)).toBe(true); // the good list
    expect(t.loader.isWaiting("44")).toBe(false);
    // A good list resets the count: the next failure waits 10 minutes again.
    expect(await callsAfter(t, RECENT_MS)).toBe(true);
    expect(await callsAfter(t, 10 * MINUTE - 1)).toBe(false);
    expect(await callsAfter(t, 1)).toBe(true);
    expect(t.fetchMock).toHaveBeenCalledTimes(6);
  });

  it("waits HOT_LIST_TTL_MS after a lasting failure (a missing permission)", async () => {
    const t = setup([DENIED, DENIED]);
    await expect(t.loader.load("44", t.deps)).rejects.toMatchObject({ reason: "failed" });
    expect(await callsAfter(t, HOT_LIST_TTL_MS - 1)).toBe(false);
    expect(await callsAfter(t, 1)).toBe(true);
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports an empty list as empty, saves nothing and waits HOT_LIST_TTL_MS", async () => {
    const t = setup([EMPTY]);
    const err = await t.loader.load("26", t.deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HotPoolError);
    expect(err).toMatchObject({ reason: "empty" });
    expect(t.saveProducts).not.toHaveBeenCalled();
    t.advance(HOT_LIST_TTL_MS - 1);
    await expect(t.loader.load("26", t.deps)).rejects.toMatchObject({
      reason: "empty",
      waiting: true,
    });
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("counts a config error as a lasting failure without calling AliExpress", async () => {
    const t = setup([]);
    const broken = (): HotFetchDeps => {
      throw new Error("Missing or invalid environment variables: ALIEXPRESS_APP_KEY");
    };
    await expect(t.loader.load("44", broken)).rejects.toMatchObject({ reason: "failed" });
    expect(t.fetchMock).not.toHaveBeenCalled();
    t.advance(HOT_LIST_TTL_MS - 1);
    expect(t.loader.isWaiting("44")).toBe(true);
  });

  it("still returns the list when saving fails, and logs it", async () => {
    const t = setup([fixtureText("cat44-HE")]);
    t.saveProducts.mockRejectedValueOnce(new Error("db down"));
    const pool = await t.loader.load("44", t.deps);
    expect(pool.products.length).toBeGreaterThan(0);
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("products not saved"));
  });
});

describe("retry schedule", () => {
  it("backs off passing failures from RETRY_AFTER_FAILURE_MS, doubling, up to HOT_LIST_TTL_MS", () => {
    expect([1, 2, 3, 4].map((n) => retryDelayMs("transient", n) / MINUTE)).toEqual([
      10, 20, 40, 80,
    ]);
    expect(retryDelayMs("transient", 1)).toBe(RETRY_AFTER_FAILURE_MS);
    expect(retryDelayMs("transient", 7)).toBe(640 * MINUTE);
    expect(retryDelayMs("transient", 8)).toBe(HOT_LIST_TTL_MS);
    expect(retryDelayMs("transient", 50)).toBe(HOT_LIST_TTL_MS);
    expect(retryDelayMs("lasting", 1)).toBe(HOT_LIST_TTL_MS);
  });

  it("retries rate limits, server, network and unreadable responses sooner; nothing else", () => {
    for (const kind of ["rate_limit", "server", "network", "bad_response", "unknown"] as const) {
      expect(failureKind(new AliExpressError(kind, "x"))).toBe("transient");
    }
    for (const kind of ["auth", "invalid_request"] as const) {
      expect(failureKind(new AliExpressError(kind, "x"))).toBe("lasting");
    }
    expect(failureKind(new HotPoolError("empty", "none passed"))).toBe("lasting");
    expect(failureKind(new Error("Missing or invalid environment variables"))).toBe("lasting");
  });
});
