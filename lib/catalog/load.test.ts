// loadCategoryList and cachedCategoryPhoto against fake hot list reads (lib/hot/queries.ts is
// mocked): which pages are asked for, in what order, and that a crawler's "more" never fetches.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HotPool } from "@/lib/hot/loader";
import type { HotProduct } from "@/lib/hot/select";

const m = vi.hoisted(() => ({
  loadHotPool: vi.fn(),
  cachedHotPool: vi.fn(),
  servedHotPool: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/hot/queries", () => m);

const { loadCategoryList, cachedCategoryPhoto } = await import("./load");
const { catalogBySlug } = await import("./categories");

const product = (id: string, sub: string | null): HotProduct => ({
  productId: id,
  title: id,
  imageUrl: `https://ae-pic-a1.aliexpress-media.com/kf/${id}.jpg`,
  price: 10,
  originalPrice: null,
  discountPct: null,
  positiveFeedbackPct: 95,
  unitsSold: 300,
  hasVideo: false,
  promoCode: null,
  categoryId: "15",
  subcategoryId: sub,
  shopId: `s${id}`,
});
const pool = (key: string, ids: string[], sub: string | null = "405"): HotPool => ({
  key,
  products: ids.map((id) => product(id, sub)),
  checked: 50,
  fetchedAt: "2026-10-03T08:00:00.000Z",
});

const home = catalogBySlug("בית-ומטבח")!;
const decor = catalogBySlug("עיצוב-ואביזרי-נוי")!;

beforeEach(() => {
  m.loadHotPool.mockReset();
  m.cachedHotPool.mockReset();
  m.servedHotPool.mockReset();
  m.loadHotPool.mockImplementation(async (key: string) => ({
    ok: true,
    pool: pool(key, [`${key}-a`, `${key}-b`]),
  }));
});

describe("loadCategoryList", () => {
  it("loads page 1 only, unless more pages are asked for, and caps them at 3", async () => {
    const one = await loadCategoryList(home, 1);
    expect(m.loadHotPool.mock.calls.map((c) => c[0])).toEqual(["15"]);
    expect(one).toMatchObject({ ok: true, loaded: 1, complete: true });

    m.loadHotPool.mockClear();
    const three = await loadCategoryList(home, 9);
    expect(m.loadHotPool.mock.calls.map((c) => c[0])).toEqual(["15", "15:2", "15:3"]);
    if (!three.ok) throw new Error("failed");
    expect(three.list.products).toHaveLength(6);
  });

  it("fetches a slice by its own second-level id (direct fetch, verified 2026-10-03)", async () => {
    await loadCategoryList(decor, 2);
    expect(m.loadHotPool.mock.calls.map((c) => c[0])).toEqual(["3710", "3710:2"]);
  });

  it("fetches a slice without direct fetch through its first-level list", async () => {
    await loadCategoryList({ ...decor, slice: { subcategoryId: "3710", directFetch: false } }, 2);
    expect(m.loadHotPool.mock.calls.map((c) => c[0])).toEqual(["15", "15:2"]);
  });

  it("serves a crawler's pages 2-3 from the cache only (never a call)", async () => {
    m.cachedHotPool.mockImplementation(async (key: string) =>
      key === "15:2" ? pool(key, ["c"]) : null,
    );
    const res = await loadCategoryList(home, 3, { readOnlyMore: true });
    expect(m.loadHotPool.mock.calls.map((c) => c[0])).toEqual(["15"]);
    expect(m.cachedHotPool.mock.calls.map((c) => c[0])).toEqual(["15:2", "15:3"]);
    expect(res).toMatchObject({ ok: true, loaded: 2, complete: false });
  });

  it("stops at a failed page, goes on past an empty one, and fails only with page 1", async () => {
    m.loadHotPool.mockImplementation(async (key: string) =>
      key === "15:2" ? { ok: false, reason: "failed" } : { ok: true, pool: pool(key, [key]) },
    );
    expect(await loadCategoryList(home, 3)).toMatchObject({ ok: true, complete: false });
    expect(m.loadHotPool).toHaveBeenCalledTimes(2);

    m.loadHotPool.mockImplementation(async (key: string) =>
      key === "15:2" ? { ok: false, reason: "empty" } : { ok: true, pool: pool(key, [key]) },
    );
    expect(await loadCategoryList(home, 3)).toMatchObject({ ok: true, complete: true });

    m.loadHotPool.mockImplementation(async () => ({ ok: false, reason: "failed" }));
    expect(await loadCategoryList(home, 3)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("cachedCategoryPhoto (the hub's tiles)", () => {
  it("uses only a list this instance holds, never a read or a call", () => {
    m.servedHotPool.mockReturnValue(null);
    expect(cachedCategoryPhoto(home)).toBeNull();
    m.servedHotPool.mockImplementation((key: string) =>
      key === "15"
        ? { ...pool(key, ["x"], "405"), products: [product("x", "405"), product("y", "3710")] }
        : key === "3710"
          ? { ...pool(key, ["y"], "3710"), products: [product("y", "3710")] }
          : null,
    );
    expect(cachedCategoryPhoto(home)).toContain("/x.jpg");
    // A slice shows a photo of its own sub-category.
    expect(cachedCategoryPhoto(decor)).toContain("/y.jpg");
    expect(m.loadHotPool).not.toHaveBeenCalled();
    expect(m.cachedHotPool).not.toHaveBeenCalled();
  });
});
