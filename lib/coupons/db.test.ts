import { describe, expect, it } from "vitest";
import {
  COUPON_COLUMNS,
  CouponNotFoundError,
  CouponSaleMissingError,
  CouponsDbError,
  insertCoupon,
  isCouponId,
  pickProductCoupons,
  removeCoupon,
  selectAllCoupons,
  selectCoupon,
  selectCouponsForProduct,
  selectCouponsForSale,
  selectPublicCoupons,
  splitPublicCoupons,
  toCoupon,
  updateCoupon,
  updateCouponPublished,
  type CouponsClient,
} from "./db";
import type { Coupon, CouponInput } from "./types";

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Call = [method: string, ...args: unknown[]];

/** Records the PostgREST builder chain and answers with a canned result. */
class FakeQuery implements PromiseLike<Result> {
  calls: Call[] = [];
  constructor(
    readonly table: string,
    private readonly result: Result,
  ) {}
  private add(method: string, args: unknown[]) {
    this.calls.push([method, ...args]);
    return this;
  }
  select(...a: unknown[]) {
    return this.add("select", a);
  }
  insert(...a: unknown[]) {
    return this.add("insert", a);
  }
  update(...a: unknown[]) {
    return this.add("update", a);
  }
  delete(...a: unknown[]) {
    return this.add("delete", a);
  }
  eq(...a: unknown[]) {
    return this.add("eq", a);
  }
  or(...a: unknown[]) {
    return this.add("or", a);
  }
  order(...a: unknown[]) {
    return this.add("order", a);
  }
  limit(...a: unknown[]) {
    return this.add("limit", a);
  }
  single() {
    return this.add("single", []);
  }
  maybeSingle() {
    return this.add("maybeSingle", []);
  }
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** Answers each query in turn with the next result (the last one repeats). */
function fakeDb(...results: Result[]) {
  const queue = results.length ? results : [{ data: [], error: null }];
  const queries: FakeQuery[] = [];
  const db = {
    from(table: string) {
      const q = new FakeQuery(table, queue[Math.min(queries.length, queue.length - 1)]);
      queries.push(q);
      return q;
    },
  };
  return { db: db as unknown as CouponsClient, queries };
}

const ok = (data: unknown): Result => ({ data, error: null });

const NOW = new Date("2026-10-01T09:00:00.000Z");
const NOT_ENDED = "ends_at.is.null,ends_at.gt.2026-10-01T09:00:00.000Z";
const PRODUCT = "1005006123456789";
const SALE = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

let seq = 0;
function row(over: Partial<Coupon> = {}): Coupon {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    code: `CODE${seq}`,
    title: `קופון ${seq}`,
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
const ids = (coupons: Coupon[]) => coupons.map((c) => c.id);

describe("toCoupon", () => {
  it("normalizes timestamps, blank terms and a numeric string minimum", () => {
    const coupon = toCoupon({
      ...row({ starts_at: "2026-11-11T00:00:00+02:00", terms: " " }),
      min_spend_ils: "39.90",
      created_at: "2026-09-27T10:00:00+00:00",
    });
    expect(coupon).toMatchObject({
      starts_at: "2026-11-10T22:00:00.000Z",
      created_at: "2026-09-27T10:00:00.000Z",
      terms: null,
      min_spend_ils: 39.9,
    });
  });

  it("skips rows without the expected shape, or whose scope and product disagree", () => {
    expect(toCoupon(row({ scope: "store" as never }))).toBeNull();
    expect(toCoupon(row({ created_at: "yesterday" }))).toBeNull();
    expect(toCoupon({ ...row(), min_spend_ils: "-5" })).toBeNull();
    expect(toCoupon(row({ scope: "product" }))).toBeNull();
    expect(toCoupon(row({ product_id: PRODUCT }))).toBeNull();
    expect(toCoupon(null)).toBeNull();
  });
});

describe("selection", () => {
  it("splits /coupons into valid now (featured, then soonest to end) and upcoming", () => {
    const openEnded = row();
    const endsLater = row({ ends_at: "2026-10-20T00:00:00.000Z" });
    const endsSoon = row({ ends_at: "2026-10-02T00:00:00.000Z" });
    const featured = row({ featured: true, ends_at: "2026-12-01T00:00:00.000Z" });
    const startsLater = row({ starts_at: "2026-11-11T00:00:00.000Z" });
    const startsSooner = row({ starts_at: "2026-10-10T00:00:00.000Z" });
    const ended = row({ ends_at: "2026-10-01T09:00:00.000Z" });
    const draft = row({ published: false });
    const { active, upcoming } = splitPublicCoupons(
      [openEnded, endsLater, ended, startsLater, endsSoon, draft, featured, startsSooner],
      NOW,
    );
    expect(ids(active)).toEqual(ids([featured, endsSoon, endsLater, openEnded]));
    expect(ids(upcoming)).toEqual(ids([startsSooner, startsLater]));
  });

  it("product page: the product's current coupons, then current featured sitewide ones", () => {
    const sitewide = row({ featured: true });
    const own = row({ scope: "product", product_id: PRODUCT });
    const ownFeatured = row({ scope: "product", product_id: PRODUCT, featured: true });
    const picked = pickProductCoupons(
      [
        sitewide,
        own,
        row({ scope: "product", product_id: "42" }),
        row({ featured: false }),
        row({ featured: true, starts_at: "2026-10-02T00:00:00.000Z" }),
        row({ scope: "product", product_id: PRODUCT, ends_at: "2026-09-30T00:00:00.000Z" }),
        row({ scope: "product", product_id: PRODUCT, published: false }),
        ownFeatured,
        sitewide,
      ],
      PRODUCT,
      NOW,
    );
    expect(ids(picked)).toEqual(ids([ownFeatured, own, sitewide]));
  });
});

describe("public reads", () => {
  it("/coupons: published, not ended, soonest to end first", async () => {
    const { db, queries } = fakeDb();
    await selectPublicCoupons(db, NOW);
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("coupons");
    expect(queries[0].calls).toEqual([
      ["select", COUPON_COLUMNS],
      ["eq", "published", true],
      ["or", NOT_ENDED],
      ["order", "ends_at", { ascending: true, nullsFirst: false }],
      ["limit", 200],
    ]);
  });

  it("/coupons: drops ended, unpublished and malformed rows even if the database returns them", async () => {
    const keep = row({ ends_at: "2026-10-01T09:00:01Z" });
    const { db } = fakeDb(
      ok([
        keep,
        row({ ends_at: "2026-10-01T09:00:00Z" }),
        row({ published: false }),
        row({ title: 42 as never }),
      ]),
    );
    const { active, upcoming } = await selectPublicCoupons(db, NOW);
    expect(ids(active)).toEqual([keep.id]);
    expect(upcoming).toEqual([]);
  });

  it("throws CouponsDbError when a query fails (the page shows its error card)", async () => {
    const { db } = fakeDb({ data: null, error: { message: 'relation "coupons" does not exist' } });
    await expect(selectPublicCoupons(db, NOW)).rejects.toBeInstanceOf(CouponsDbError);
  });

  it("product page: two queries, the product's own and featured sitewide", async () => {
    const own = row({ scope: "product", product_id: PRODUCT });
    const sitewide = row({ featured: true });
    const { db, queries } = fakeDb(ok([own]), ok([sitewide]));
    expect(ids(await selectCouponsForProduct(db, PRODUCT, NOW))).toEqual(ids([own, sitewide]));
    expect(queries.map((q) => q.calls)).toEqual([
      [
        ["select", COUPON_COLUMNS],
        ["eq", "published", true],
        ["eq", "scope", "product"],
        ["eq", "product_id", PRODUCT],
        ["or", NOT_ENDED],
        ["order", "created_at", { ascending: false }],
        ["limit", 20],
      ],
      [
        ["select", COUPON_COLUMNS],
        ["eq", "published", true],
        ["eq", "scope", "sitewide"],
        ["eq", "featured", true],
        ["or", NOT_ENDED],
        ["order", "created_at", { ascending: false }],
        ["limit", 20],
      ],
    ]);
  });

  it("product page: no query for an id that cannot exist", async () => {
    const { db, queries } = fakeDb();
    expect(await selectCouponsForProduct(db, "1,2", NOW)).toEqual([]);
    expect(await selectCouponsForProduct(db, "abc", NOW)).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("sale card: the sale's coupons that have not ended, current ones first", async () => {
    const upcoming = row({ sale_id: SALE, starts_at: "2026-11-11T00:00:00.000Z" });
    const current = row({ sale_id: SALE });
    const { db, queries } = fakeDb(
      ok([upcoming, current, row({ sale_id: "other" }), row({ sale_id: SALE, published: false })]),
    );
    expect(ids(await selectCouponsForSale(db, SALE, NOW))).toEqual(ids([current, upcoming]));
    expect(queries[0].calls).toEqual([
      ["select", COUPON_COLUMNS],
      ["eq", "published", true],
      ["eq", "sale_id", SALE],
      ["or", NOT_ENDED],
      ["order", "created_at", { ascending: false }],
      ["limit", 20],
    ]);
    const none = fakeDb();
    expect(await selectCouponsForSale(none.db, "11.11", NOW)).toEqual([]);
    expect(none.queries).toHaveLength(0);
  });
});

describe("admin", () => {
  const input: CouponInput = {
    code: "IL5",
    title: "₪5 הנחה לכל האתר",
    terms: null,
    min_spend_ils: 40,
    scope: "sitewide",
    product_id: null,
    sale_id: null,
    starts_at: null,
    ends_at: null,
    featured: false,
  };

  it("lists every coupon, drafts included, newest first", async () => {
    const { db, queries } = fakeDb(ok([row({ published: false })]));
    expect(await selectAllCoupons(db)).toHaveLength(1);
    expect(queries[0].calls).toEqual([
      ["select", COUPON_COLUMNS],
      ["order", "created_at", { ascending: false }],
      ["limit", 500],
    ]);
  });

  it("gets one coupon by id, and never queries an id that is not a uuid", async () => {
    const saved = row();
    const { db, queries } = fakeDb(ok(saved));
    expect(await selectCoupon(db, saved.id)).toEqual(saved);
    expect(queries[0].calls).toEqual([
      ["select", COUPON_COLUMNS],
      ["eq", "id", saved.id],
      ["maybeSingle"],
    ]);
    expect(await selectCoupon(db, "../1")).toBeNull();
    expect(queries).toHaveLength(1);
    expect(isCouponId(saved.id)).toBe(true);
    expect(isCouponId("abc")).toBe(false);
  });

  it("inserts and returns the saved row", async () => {
    const saved = row({ ...input, published: false });
    const { db, queries } = fakeDb(ok(saved));
    expect(await insertCoupon(db, input)).toEqual(saved);
    expect(queries[0].calls).toEqual([["insert", input], ["select", COUPON_COLUMNS], ["single"]]);
  });

  it("reports a linked sale that no longer exists (foreign key violation)", async () => {
    const { db } = fakeDb({ data: null, error: { message: "fk", code: "23503" } });
    await expect(insertCoupon(db, { ...input, sale_id: SALE })).rejects.toBeInstanceOf(
      CouponSaleMissingError,
    );
  });

  it("updates by id, and reports a coupon that is gone", async () => {
    const saved = row();
    const { db, queries } = fakeDb(ok(saved), ok(null));
    expect(await updateCoupon(db, saved.id, input)).toEqual(saved);
    expect(queries[0].calls).toEqual([
      ["update", input],
      ["eq", "id", saved.id],
      ["select", COUPON_COLUMNS],
      ["maybeSingle"],
    ]);
    await expect(updateCoupon(db, saved.id, input)).rejects.toBeInstanceOf(CouponNotFoundError);
    await expect(updateCoupon(db, "nope", input)).rejects.toBeInstanceOf(CouponNotFoundError);
  });

  it("publishes and unpublishes, and reports a coupon that is gone", async () => {
    const { db, queries } = fakeDb(ok([{ id: SALE }]), ok([]));
    await updateCouponPublished(db, SALE, true);
    expect(queries[0].calls).toEqual([
      ["update", { published: true }],
      ["eq", "id", SALE],
      ["select", "id"],
    ]);
    await expect(updateCouponPublished(db, SALE, false)).rejects.toBeInstanceOf(
      CouponNotFoundError,
    );
  });

  it("deletes by id; an id that cannot exist is a no-op", async () => {
    const { db, queries } = fakeDb();
    await removeCoupon(db, SALE);
    await removeCoupon(db, "nope");
    expect(queries).toHaveLength(1);
    expect(queries[0].calls).toEqual([["delete"], ["eq", "id", SALE]]);
  });
});
