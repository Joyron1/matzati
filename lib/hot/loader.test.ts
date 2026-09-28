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
import { LINK_MAX_AGE_MS, type StoredLinkRow } from "./links";
import { PER_SHOP } from "./select";

const METHOD = "aliexpress.affiliate.hotproduct.query";
const LINK_METHOD = "aliexpress.affiliate.link.generate";
const fixtureText = (name: string) =>
  readFileSync(`fixtures/aliexpress/probe-hot/${METHOD}.${name}.json`, "utf8");

/** A link.generate answer with one short link per source value, shaped like the type 2 fixture. */
function linkAnswer(
  sources: string[],
  link = (id: string) => `https://s.click.aliexpress.com/e/_h${id}`,
) {
  return JSON.stringify({
    aliexpress_affiliate_link_generate_response: {
      resp_result: {
        resp_code: 200,
        resp_msg: "Call succeeds",
        result: {
          total_result_count: sources.length,
          promotion_links: {
            promotion_link: sources.map((s) => ({
              source_value: s,
              promotion_link: link(s.match(/item\/(\d+)\.html/)![1]),
            })),
          },
          tracking_id: "<ALIEXPRESS_TRACKING_ID>",
        },
      },
      request_id: "fake",
    },
  });
}

/** How the fake gateway answers link.generate: a link per product, or one of the error bodies. */
type LinkMode = "ok" | "banned" | "denied" | ((sources: string[]) => string);
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

/**
 * A loader against a fake gateway: hotproduct.query calls take `bodies` in order, link.generate
 * calls are answered per `links`.
 */
function setup(
  bodies: string[],
  links: LinkMode = "ok",
  { mayFetch }: { mayFetch?: () => boolean } = {},
) {
  let now = Date.parse("2026-09-28T12:00:00Z");
  const queue = [...bodies];
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const sent = new URLSearchParams(String(init?.body));
    if (sent.get("method") === LINK_METHOD) {
      const sources = (sent.get("source_values") ?? "").split(",");
      if (links === "banned") return new Response(BANNED);
      if (links === "denied") return new Response(DENIED);
      return new Response(links === "ok" ? linkAnswer(sources) : links(sources));
    }
    const body = queue.shift();
    if (body === undefined) throw new Error("no more fake list responses");
    return new Response(body);
  });
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
    mayFetch,
  });
  const deps = (): HotFetchDeps => ({ ali: client, saveProducts });
  const sent = (call: number) => new URLSearchParams(String(fetchMock.mock.calls[call][1]?.body));
  const methods = () => fetchMock.mock.calls.map((_, i) => sent(i).get("method"));
  return {
    loader,
    deps,
    fetchMock,
    sent,
    methods,
    /** hotproduct.query calls so far. */
    listCalls: () => methods().filter((m) => m === METHOD).length,
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
    // The list, then one link.generate call for its hot links (see below).
    expect(t.methods()).toEqual([METHOD, LINK_METHOD]);
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
    expect(t.methods()).toEqual([METHOD, LINK_METHOD]);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("reuses a list fetched in the last RECENT_MS, then fetches again", async () => {
    const t = setup([fixtureText("cat44-HE"), fixtureText("cat44-HE.page2")]);
    const first = await t.loader.load("44", t.deps);
    t.advance(RECENT_MS - 1);
    expect(await t.loader.load("44", t.deps)).toBe(first);
    expect(t.listCalls()).toBe(1);
    t.advance(1);
    const second = await t.loader.load("44", t.deps);
    expect(t.listCalls()).toBe(2);
    expect(second.products[0].productId).not.toBe(first.products[0].productId);
  });

  it("starts no fetch while mayFetch says no, records no failure, and still shares what it has", async () => {
    let allowed = false;
    const t = setup([fixtureText("cat44-HE")], "ok", { mayFetch: () => allowed });
    const refused = await t.loader.load("44", t.deps).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(HotPoolError);
    expect(refused).toMatchObject({ reason: "failed", waiting: true });
    expect(t.fetchMock).not.toHaveBeenCalled();
    // Nothing is held against the list: the next caller that may fetch does so at once.
    expect(t.loader.isWaiting("44")).toBe(false);
    allowed = true;
    const running = t.loader.load("44", t.deps);
    allowed = false;
    // A fetch already running, and then a list fetched in the last RECENT_MS, cost no call.
    const [joined, pool] = await Promise.all([t.loader.load("44", t.deps), running]);
    expect(joined).toBe(pool);
    expect(await t.loader.load("44", t.deps)).toBe(pool);
    expect(t.listCalls()).toBe(1);
    t.advance(RECENT_MS);
    await expect(t.loader.load("44", t.deps)).rejects.toMatchObject({ waiting: true });
    expect(t.listCalls()).toBe(1);
  });

  it("spaces this instance's calls ALI_SPACING_MS apart, hot link calls included", async () => {
    const t = setup([fixtureText("cat44-HE"), fixtureText("all-HE")]);
    await Promise.all([t.loader.load("44", t.deps), t.loader.load("15", t.deps)]);
    expect(t.sent(1).get("category_ids")).toBe("15");
    expect(t.methods()).toEqual([METHOD, METHOD, LINK_METHOD, LINK_METHOD]);
    expect(t.sleeps).toEqual([ALI_SPACING_MS, ALI_SPACING_MS, ALI_SPACING_MS]);
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
    expect(t.listCalls()).toBe(2);
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
    expect(t.listCalls()).toBe(6);
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

  describe("hot links (promotion_link_type 2)", () => {
    /** The same list loaded with the link call failing: what the list alone gives. */
    async function listOnly() {
      const t = setup([fixtureText("cat44-HE")], "denied");
      return { pool: await t.loader.load("44", t.deps), saved: t.saved[0].products };
    }

    it("makes one type 2 call for the kept products with a higher hot rate and saves those links", async () => {
      const t = setup([fixtureText("cat44-HE")]);
      const pool = await t.loader.load("44", t.deps);
      const link = t.sent(1);
      expect(link.get("method")).toBe(LINK_METHOD);
      expect(link.get("promotion_link_type")).toBe("2");
      expect(link.get("tracking_id")).toBe("trk");
      // Spaced after the list call like any other call.
      expect(t.sleeps).toEqual([ALI_SPACING_MS]);

      const saved = t.saved[0].products;
      const eligible = saved.filter(
        (p) => (p.hotCommissionRatePct ?? 0) > (p.commissionRatePct ?? Infinity),
      );
      expect(eligible.length).toBeGreaterThan(30);
      expect(eligible.length).toBeLessThan(saved.length);
      expect(link.get("source_values")!.split(",")).toEqual(
        eligible.map((p) => `https://www.aliexpress.com/item/${p.productId}.html`),
      );
      const madeAt = new Date(Date.parse(pool.fetchedAt) + ALI_SPACING_MS).toISOString();
      for (const p of eligible) {
        expect(p).toMatchObject({
          promotionLink: `https://s.click.aliexpress.com/e/_h${p.productId}`,
          promotionLinkType: 2,
          promotionLinkAt: madeAt,
          source: "hot",
        });
      }
      // The rest keep the list's own /s/ link, type unknown.
      for (const p of saved.filter((q) => !eligible.includes(q))) {
        expect(p.promotionLink).toMatch(/^https:\/\/s\.click\.aliexpress\.com\/s\//);
        expect(p.promotionLinkType).toBeUndefined();
        expect(p.promotionLinkAt).toBeUndefined();
      }
    });

    it("changes neither the products shown nor their order", async () => {
      const t = setup([fixtureText("cat44-HE")]);
      const pool = await t.loader.load("44", t.deps);
      const alone = await listOnly();
      expect(pool.products).toEqual(alone.pool.products);
      expect(t.saved[0].products.map((p) => p.productId)).toEqual(
        alone.saved.map((p) => p.productId),
      );
      // The saved rows and the returned list are the same products, in the same order.
      expect(t.saved[0].products.map((p) => p.productId)).toEqual(
        pool.products.map((p) => p.productId),
      );
    });

    it("keeps the list's links when the call fails, and still returns and saves the list", async () => {
      for (const mode of ["denied", "banned"] as const) {
        const t = setup([fixtureText("cat44-HE")], mode);
        const pool = await t.loader.load("44", t.deps);
        expect(pool.products.length).toBeGreaterThan(30);
        expect(t.loader.isWaiting("44")).toBe(false);
        const saved = t.saved[0].products;
        expect(saved.every((p) => p.promotionLink?.includes("/s/"))).toBe(true);
        expect(saved.every((p) => p.promotionLinkType === undefined)).toBe(true);
        expect(t.log).toHaveBeenCalledWith(expect.stringContaining("hot links not made"));
      }
    });

    it("keeps the list's link for a product whose answer is missing or not an AliExpress link", async () => {
      let asked: string[] = [];
      const t = setup([fixtureText("cat44-HE")], (sources) => {
        asked = sources;
        const [bad, ...rest] = sources.slice(0, -1); // the last one gets no answer
        return linkAnswer([bad, ...rest], (id) =>
          id === bad.match(/item\/(\d+)/)![1]
            ? "https://evil.test/redirect"
            : `https://s.click.aliexpress.com/e/_h${id}`,
        );
      });
      await t.loader.load("44", t.deps);
      const byId = new Map(t.saved[0].products.map((p) => [p.productId, p]));
      const idOf = (s: string) => s.match(/item\/(\d+)/)![1];
      const first = byId.get(idOf(asked[0]))!;
      const last = byId.get(idOf(asked[asked.length - 1]))!;
      for (const p of [first, last]) {
        expect(p.promotionLink).toMatch(/^https:\/\/s\.click\.aliexpress\.com\/s\//);
        expect(p.promotionLinkType).toBeUndefined();
      }
      expect(byId.get(idOf(asked[1]))!.promotionLinkType).toBe(2);
      expect(t.log).toHaveBeenCalledWith(
        expect.stringContaining(`${asked.length - 2} of ${asked.length} hot links made`),
      );
    });

    describe("a refetch whose type 2 call gives no link", () => {
      /**
       * A loader whose saves go to a fake products table that storedLinks reads back, and whose
       * link.generate answers per `mode` (switchable between fetches).
       */
      function withTable() {
        const mode: { links: LinkMode } = { links: "ok" };
        const t = setup([fixtureText("cat44-HE"), fixtureText("cat44-HE")], (sources) => {
          if (mode.links === "banned") return BANNED;
          if (mode.links === "denied") return DENIED;
          return mode.links === "ok" ? linkAnswer(sources) : mode.links(sources);
        });
        const table = new Map<string, AliProduct>();
        t.saveProducts.mockImplementation(async (products: AliProduct[], fetchedAt: Date) => {
          t.saved.push({ products, fetchedAt });
          for (const p of products) table.set(p.productId, p);
        });
        const storedLinks = vi.fn(async (ids: string[]): Promise<StoredLinkRow[]> =>
          ids.flatMap((id) => {
            const p = table.get(id);
            return p
              ? [
                  {
                    productId: id,
                    promotionLink: p.promotionLink,
                    promotionLinkType: p.promotionLinkType,
                    promotionLinkAt: p.promotionLinkAt,
                  },
                ]
              : [];
          }),
        );
        const deps = (): HotFetchDeps => ({ ...t.deps(), storedLinks });
        return { ...t, mode, deps, storedLinks };
      }

      const hot = (ps: AliProduct[]) => ps.filter((p) => p.promotionLinkType === 2);

      it("keeps each product's fresh stored type 2 link, with its time, when the call fails", async () => {
        for (const failure of ["banned", "denied"] as const) {
          const t = withTable();
          await t.loader.load("44", t.deps);
          const first = t.saved[0].products;
          expect(hot(first).length).toBeGreaterThan(30);
          expect(t.storedLinks).not.toHaveBeenCalled(); // every link was made: nothing read

          t.advance(HOT_LIST_TTL_MS);
          t.mode.links = failure;
          await t.loader.load("44", t.deps);
          const second = t.saved[1].products;
          expect(t.storedLinks).toHaveBeenCalledTimes(1);
          expect(t.storedLinks).toHaveBeenCalledWith(hot(first).map((p) => p.productId));
          const before = new Map(first.map((p) => [p.productId, p]));
          for (const p of second) {
            const was = before.get(p.productId)!;
            if (was.promotionLinkType === 2) {
              expect(p).toMatchObject({
                promotionLink: was.promotionLink,
                promotionLinkType: 2,
                promotionLinkAt: was.promotionLinkAt,
                source: "hot",
              });
            } else {
              // Not asked for (the hot rate is not higher): the list's own link, as before.
              expect(p.promotionLink).toMatch(/^https:\/\/s\.click\.aliexpress\.com\/s\//);
              expect(p.promotionLinkType).toBeUndefined();
            }
          }
          expect(t.log).toHaveBeenCalledWith(
            expect.stringContaining(`${hot(first).length} of ${hot(first).length} kept`),
          );
        }
      });

      it("keeps a stored link for a product the call sends no usable link for", async () => {
        const t = withTable();
        await t.loader.load("44", t.deps);
        const first = hot(t.saved[0].products);
        const [skipped, bad] = first.map((p) => p.productId);
        t.advance(HOT_LIST_TTL_MS);
        t.mode.links = (sources) =>
          linkAnswer(
            sources.filter((s) => !s.includes(skipped)),
            (id) =>
              id === bad
                ? "https://evil.test/redirect"
                : `https://s.click.aliexpress.com/e/_n${id}`,
          );
        await t.loader.load("44", t.deps);
        const byId = new Map(t.saved[1].products.map((p) => [p.productId, p]));
        expect(t.storedLinks).toHaveBeenCalledWith([skipped, bad]);
        for (const id of [skipped, bad]) {
          expect(byId.get(id)).toMatchObject({
            promotionLink: `https://s.click.aliexpress.com/e/_h${id}`,
            promotionLinkType: 2,
            promotionLinkAt: first[0].promotionLinkAt,
          });
        }
        // The others got this fetch's new links.
        expect(byId.get(first[2].productId)?.promotionLink).toBe(
          `https://s.click.aliexpress.com/e/_n${first[2].productId}`,
        );
      });

      it("goes back to the list's link once the stored one is LINK_MAX_AGE_DAYS old", async () => {
        const t = withTable();
        await t.loader.load("44", t.deps);
        t.advance(LINK_MAX_AGE_MS - ALI_SPACING_MS);
        t.mode.links = "banned";
        await t.loader.load("44", t.deps);
        expect(t.storedLinks).toHaveBeenCalledTimes(1);
        const second = t.saved[1].products;
        expect(second.every((p) => p.promotionLinkType === undefined)).toBe(true);
        expect(second.every((p) => p.promotionLink?.includes("/s/"))).toBe(true);
      });

      it("keeps the list's links, and the list, when the stored links cannot be read", async () => {
        const t = withTable();
        t.mode.links = "banned";
        t.storedLinks.mockRejectedValueOnce(new Error("db down"));
        const pool = await t.loader.load("44", t.deps);
        expect(pool.products.length).toBeGreaterThan(30);
        expect(t.saved[0].products.every((p) => p.promotionLinkType === undefined)).toBe(true);
        expect(t.log).toHaveBeenCalledWith(expect.stringContaining("stored hot links not read"));
      });
    });

    it("makes no call when no kept product has a higher hot rate", async () => {
      const lower = fixtureText("cat44-HE").replace(
        /"hot_product_commission_rate": "[^"]*"/g,
        '"hot_product_commission_rate": "0.0%"',
      );
      const t = setup([lower]);
      const pool = await t.loader.load("44", t.deps);
      expect(pool.products.length).toBeGreaterThan(30);
      expect(t.methods()).toEqual([METHOD]);
      expect(t.saved[0].products.every((p) => p.promotionLinkType === undefined)).toBe(true);
    });
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
