import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Coupon } from "./types";

type Result = { data: unknown; error: { message: string } | null };

// Every query of the anon and service clients answers with `db.result` and records its table.
const db = vi.hoisted(() => ({
  result: { data: [], error: null } as { data: unknown; error: { message: string } | null },
  tables: [] as string[],
}));
const apiCodes = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("./api-codes", () => ({ listApiCodes: apiCodes.list }));

function fakeClient() {
  const query: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "or", "order", "limit"]) {
    query[m] = () => query;
  }
  query.single = query.maybeSingle = () => query;
  query.then = (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) =>
    Promise.resolve(db.result).then(ok, fail);
  return {
    from: (table: string) => {
      db.tables.push(table);
      return query;
    },
  };
}
vi.mock("@supabase/supabase-js", () => ({ createClient: () => fakeClient() }));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => fakeClient() }));

const {
  couponsForProduct,
  couponsForSale,
  CouponValidationError,
  hasPublishedCoupons,
  listPublicCoupons,
  saveCoupon,
} = await import("./queries");

const NOW = new Date("2026-10-01T09:00:00.000Z");
const PRODUCT = "1005006123456789";
const SALE = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

function coupon(over: Partial<Coupon> = {}): Coupon {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    code: "IL5",
    title: "₪5 הנחה לכל האתר",
    terms: null,
    min_spend_ils: null,
    scope: "sitewide",
    product_id: null,
    sale_id: null,
    starts_at: null,
    ends_at: null,
    featured: false,
    published: true,
    created_at: "2026-09-27T10:00:00.000Z",
    updated_at: "2026-09-27T10:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.result = { data: [], error: null };
  db.tables = [];
  apiCodes.list.mockReset().mockResolvedValue([]);
});

describe("public reads", () => {
  it("lists published coupons split by the time of the visit", async () => {
    const later = coupon({
      id: "00000000-0000-4000-8000-000000000002",
      starts_at: "2026-11-11T00:00:00.000Z",
    });
    db.result = { data: [coupon(), later], error: null };
    const { active, upcoming } = await listPublicCoupons(NOW);
    expect(active.map((c) => c.code)).toEqual(["IL5"]);
    expect(upcoming.map((c) => c.id)).toEqual([later.id]);
    expect(db.tables).toEqual(["coupons"]);
  });

  it("lets /coupons show its error card when the database fails", async () => {
    db.result = { data: null, error: { message: 'relation "coupons" does not exist' } };
    await expect(listPublicCoupons(NOW)).rejects.toThrow("does not exist");
  });

  it("product pages and sale cards get [] on a failure", async () => {
    db.result = { data: null, error: { message: "timeout" } };
    expect(await couponsForProduct(PRODUCT, NOW)).toEqual([]);
    expect(await couponsForSale(SALE, NOW)).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("product page: the product's coupon and a featured sitewide one", async () => {
    const own = coupon({ scope: "product", product_id: PRODUCT });
    db.result = { data: [own], error: null };
    // Both queries answer with the same row; the sitewide query's copy is not featured sitewide.
    expect((await couponsForProduct(PRODUCT, NOW)).map((c) => c.id)).toEqual([own.id]);
  });
});

describe("hasPublishedCoupons", () => {
  it("is true with an owner coupon, without asking for AliExpress codes", async () => {
    db.result = { data: [coupon()], error: null };
    expect(await hasPublishedCoupons()).toBe(true);
    expect(apiCodes.list).not.toHaveBeenCalled();
  });

  it("is true with only AliExpress codes, and false with nothing", async () => {
    apiCodes.list.mockResolvedValueOnce([{ productId: PRODUCT }]);
    expect(await hasPublishedCoupons()).toBe(true);
    expect(await hasPublishedCoupons()).toBe(false);
  });

  it("reads failures as nothing to show", async () => {
    db.result = { data: null, error: { message: "timeout" } };
    apiCodes.list.mockRejectedValue(new Error("timeout"));
    expect(await hasPublishedCoupons()).toBe(false);
  });
});

describe("saveCoupon", () => {
  it("validates again before the service-role write", async () => {
    const bad = { ...coupon(), code: "SAVE 5" };
    await expect(saveCoupon(bad)).rejects.toBeInstanceOf(CouponValidationError);
    expect(db.tables).toEqual([]);
  });
});
