// lib/hot/queries wiring: the carousel mixes the MIX_CATEGORY_IDS lists, products are saved with
// no Hebrew titles of ours, and failures are returned (never thrown) and logged once. The cache,
// Supabase and the gateway are faked; nothing here reaches AliExpress or Supabase.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({}) }));
vi.mock("@/lib/env", () => ({
  aliexpressConfig: () => ({
    appKey: "k",
    appSecret: "secret",
    trackingId: "trk",
    gateway: "https://g.test/sync",
  }),
}));
const save = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/search/supabase-store", () => ({
  SupabaseStore: class {
    saveProducts = save;
  },
}));
// No real waiting between the fake calls, and a clock the tests move.
const clock = vi.hoisted(() => ({ now: 0 }));
vi.mock("./loader", async (importOriginal) => {
  const original = await importOriginal<typeof import("./loader")>();
  return {
    ...original,
    HotPoolLoader: class extends original.HotPoolLoader {
      constructor() {
        super({ spacingMs: 0, clock: () => clock.now });
      }
    },
  };
});

const fixture = (name: string) =>
  readFileSync(
    `fixtures/aliexpress/probe-hot/aliexpress.affiliate.hotproduct.query.${name}.json`,
    "utf8",
  );
const FAILURE = JSON.stringify({ error_response: { code: "InsufficientPermission" } });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let errors: ReturnType<typeof vi.spyOn>;

/** Answers each call by its category_ids param. */
function gateway(bodies: Record<string, string>) {
  fetchMock.mockImplementation(async (_url, init) => {
    const category = new URLSearchParams(String(init?.body)).get("category_ids") ?? "";
    return new Response(bodies[category] ?? FAILURE);
  });
}

beforeEach(() => {
  vi.resetModules(); // a fresh loader (and its failure memory) per test
  clock.now = Date.parse("2026-09-28T12:00:00Z");
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  save.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  errors.mockRestore();
});

describe("hotCarouselProducts", () => {
  it("mixes the MIX_CATEGORY_IDS lists, CAROUSEL_SIZE products, and saves them untitled", async () => {
    const { MIX_CATEGORY_IDS } = await import("./categories");
    const [first, second, third, fourth] = MIX_CATEGORY_IDS;
    gateway({
      [first]: fixture("cat44-HE"),
      [second]: fixture("all-HE"),
      [third]: fixture("cat44-HE.page2"),
      [fourth]: fixture("cat44-EN"),
    });
    const { CAROUSEL_SIZE, hotCarouselProducts } = await import("./queries");
    const products = await hotCarouselProducts();
    expect(fetchMock).toHaveBeenCalledTimes(MIX_CATEGORY_IDS.length);
    expect(products).toHaveLength(CAROUSEL_SIZE);
    expect(new Set(products.map((p) => p.productId)).size).toBe(CAROUSEL_SIZE);
    expect(save).toHaveBeenCalledTimes(MIX_CATEGORY_IDS.length);
    const [, titles, fetchedAt, options] = save.mock.calls[0] as unknown as unknown[];
    // title_he is left alone: it holds our LLM titles, not AliExpress's machine translation. Rows
    // a search titled keep their data too.
    expect(titles).toEqual({});
    expect(fetchedAt).toBeInstanceOf(Date);
    expect(options).toEqual({ keepTitledRows: true });
  });

  it("leaves out a list checked more than CAROUSEL_MAX_AGE_MS ago (the carousel shows no date)", async () => {
    const { MIX_CATEGORY_IDS } = await import("./categories");
    gateway({
      [MIX_CATEGORY_IDS[0]]: fixture("cat44-HE"),
      [MIX_CATEGORY_IDS[1]]: fixture("all-HE"),
    });
    const { CAROUSEL_MAX_AGE_MS, hotCarouselProducts } = await import("./queries");
    const fetchedAt = new Date(clock.now);
    const at = (ms: number) => new Date(fetchedAt.getTime() + ms);
    expect((await hotCarouselProducts(at(CAROUSEL_MAX_AGE_MS))).length).toBeGreaterThan(0);
    // The lists are cached (here: remembered by the loader), so no new call is made.
    expect(await hotCarouselProducts(at(CAROUSEL_MAX_AGE_MS + 1))).toEqual([]);
  });

  it("shows the lists that loaded when another fails", async () => {
    const { MIX_CATEGORY_IDS } = await import("./categories");
    gateway({ [MIX_CATEGORY_IDS[1]]: fixture("cat44-HE") });
    const { hotCarouselProducts, loadHotMix } = await import("./queries");
    expect((await hotCarouselProducts()).length).toBeGreaterThan(0);
    const mix = await loadHotMix();
    expect(mix.ok && mix.pools.map((p) => p.key)).toEqual([MIX_CATEGORY_IDS[1]]);
  });

  it("is empty when every list fails, and logs each failure once", async () => {
    const { MIX_CATEGORY_IDS } = await import("./categories");
    gateway({});
    const { hotCarouselProducts, loadHotMix, loadHotPool } = await import("./queries");
    await expect(hotCarouselProducts()).resolves.toEqual([]);
    expect(errors).toHaveBeenCalledTimes(MIX_CATEGORY_IDS.length);
    // The next views wait for the retry: no call, no new log line.
    await expect(loadHotMix()).resolves.toEqual({ ok: false, reason: "failed" });
    await expect(loadHotPool(MIX_CATEGORY_IDS[0])).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
    expect(fetchMock).toHaveBeenCalledTimes(MIX_CATEGORY_IDS.length);
    expect(errors).toHaveBeenCalledTimes(MIX_CATEGORY_IDS.length);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("loadHotPool", () => {
  it("serves the last list it had while a failed refresh waits, without a call or a log line", async () => {
    const { RECENT_MS } = await import("./loader");
    gateway({ "44": fixture("cat44-HE") });
    const { loadHotPool } = await import("./queries");
    const first = await loadHotPool("44");
    expect(first.ok).toBe(true);

    // The next fetch fails (with a real cache: a stale entry's background refresh).
    clock.now += RECENT_MS;
    gateway({});
    expect(await loadHotPool("44")).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledTimes(1);

    // While the loader waits, views are served from memory: no call, no new log line.
    for (let i = 0; i < 3; i++) expect(await loadHotPool("44")).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
