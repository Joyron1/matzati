// lib/hot/queries wiring: the carousel mixes the MIX_CATEGORY_IDS lists, products are saved with
// no Hebrew titles of ours, and failures are returned (never thrown) and logged once. The cache,
// Supabase and the gateway are faked; nothing here reaches AliExpress or Supabase.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
// Just enough of the Supabase client for the stored links read: from().select().in(), awaited.
const db = vi.hoisted(() => {
  type Answer = { data: unknown; error: { message: string } | null };
  const state: {
    reads: { table: string; columns: string; column: string; ids: string[] }[];
    answer: (ids: string[]) => Answer;
  } = { reads: [], answer: () => ({ data: [], error: null }) };
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: async (column: string, ids: string[]) => {
          state.reads.push({ table, columns, column, ids });
          return state.answer(ids);
        },
      }),
    }),
  };
  return { state, client };
});
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => db.client }));
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
const LINK_METHOD = "aliexpress.affiliate.link.generate";

/** A link.generate answer: one short link per source value. */
const linkAnswer = (sources: string[]) =>
  JSON.stringify({
    aliexpress_affiliate_link_generate_response: {
      resp_result: {
        resp_code: 200,
        result: {
          promotion_links: {
            promotion_link: sources.map((s) => ({
              source_value: s,
              promotion_link: `https://s.click.aliexpress.com/e/_h${s.match(/item\/(\d+)/)![1]}`,
            })),
          },
        },
      },
    },
  });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let errors: ReturnType<typeof vi.spyOn>;

const methodOf = (init: RequestInit | undefined) =>
  new URLSearchParams(String(init?.body)).get("method");

/** Answers each list call by its category_ids param, and every hot links call with links. */
function gateway(bodies: Record<string, string>) {
  fetchMock.mockImplementation(async (_url, init) => {
    const sent = new URLSearchParams(String(init?.body));
    if (sent.get("method") === LINK_METHOD) {
      return new Response(linkAnswer((sent.get("source_values") ?? "").split(",")));
    }
    return new Response(bodies[sent.get("category_ids") ?? ""] ?? FAILURE);
  });
}

/** Calls of `method`: the hot lists by default. */
const calls = (method = "aliexpress.affiliate.hotproduct.query") =>
  fetchMock.mock.calls.filter(([, init]) => methodOf(init) === method).length;

beforeEach(() => {
  vi.resetModules(); // a fresh loader (and its failure memory) per test
  clock.now = Date.parse("2026-09-28T12:00:00Z");
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  save.mockClear();
  db.state.reads.length = 0;
  db.state.answer = () => ({ data: [], error: null });
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
    // A cold list costs its list call and one hot links call.
    expect(calls()).toBe(MIX_CATEGORY_IDS.length);
    expect(calls(LINK_METHOD)).toBe(MIX_CATEGORY_IDS.length);
    expect(fetchMock).toHaveBeenCalledTimes(2 * MIX_CATEGORY_IDS.length);
    expect(products).toHaveLength(CAROUSEL_SIZE);
    expect(new Set(products.map((p) => p.productId)).size).toBe(CAROUSEL_SIZE);
    expect(save).toHaveBeenCalledTimes(MIX_CATEGORY_IDS.length);
    const [saved, titles, fetchedAt, options] = save.mock.calls[0] as unknown as [
      { promotionLinkType?: number }[],
      ...unknown[],
    ];
    expect(saved.some((p) => p.promotionLinkType === 2)).toBe(true);
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
    expect(calls(LINK_METHOD)).toBe(0);
    expect(errors).toHaveBeenCalledTimes(MIX_CATEGORY_IDS.length);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("hot links on a refetch whose type 2 call fails", () => {
  /** Category 44's list, with every link.generate call refused. */
  function linksRefused() {
    fetchMock.mockImplementation(async (_url, init) =>
      methodOf(init) === LINK_METHOD ? new Response(FAILURE) : new Response(fixture("cat44-HE")),
    );
  }
  const FRESH_AT = "2026-09-25T12:00:00.000Z";

  it("reads the stored rows once and keeps their fresh type 2 links", async () => {
    linksRefused();
    db.state.answer = (ids) => ({
      data: ids.map((id) => ({
        product_id: id,
        link: `https://s.click.aliexpress.com/e/_db${id}`,
        type: 2,
        at: FRESH_AT,
      })),
      error: null,
    });
    const { loadHotPool } = await import("./queries");
    expect((await loadHotPool("44")).ok).toBe(true);
    expect(db.state.reads).toHaveLength(1);
    const [read] = db.state.reads;
    expect(read).toMatchObject({ table: "products", column: "product_id" });
    expect(read.columns).toBe(
      "product_id, link:data->>promotionLink, type:data->promotionLinkType, at:data->>promotionLinkAt",
    );
    const [saved] = save.mock.calls[0] as unknown as [
      { productId: string; promotionLink: string; promotionLinkType?: number }[],
    ];
    const hot = saved.filter((p) => p.promotionLinkType === 2);
    expect(hot.map((p) => p.productId)).toEqual(read.ids);
    expect(hot.length).toBeGreaterThan(30);
    for (const p of hot) {
      expect(p).toMatchObject({
        promotionLink: `https://s.click.aliexpress.com/e/_db${p.productId}`,
        promotionLinkAt: FRESH_AT,
      });
    }
  });

  it("shows the list with its own links when the read fails", async () => {
    linksRefused();
    db.state.answer = () => ({ data: null, error: { message: "timeout" } });
    const { loadHotPool } = await import("./queries");
    expect((await loadHotPool("44")).ok).toBe(true);
    const [saved] = save.mock.calls[0] as unknown as [{ promotionLinkType?: number }[]];
    expect(saved.every((p) => p.promotionLinkType === undefined)).toBe(true);
  });

  it("reads nothing when every hot link was made", async () => {
    gateway({ "44": fixture("cat44-HE") });
    const { loadHotPool } = await import("./queries");
    expect((await loadHotPool("44")).ok).toBe(true);
    expect(db.state.reads).toHaveLength(0);
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
    expect(calls()).toBe(2);
    expect(errors).toHaveBeenCalledTimes(1);

    // While the loader waits, views are served from memory: no call, no new log line.
    const before = fetchMock.mock.calls.length;
    for (let i = 0; i < 3; i++) expect(await loadHotPool("44")).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(before);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
