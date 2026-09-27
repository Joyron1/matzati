import { describe, expect, it } from "vitest";
import type { Deal, DealInput } from "@/lib/types";
import {
  DEAL_COLUMNS,
  DealNotFoundError,
  DealsDbError,
  insertDeal,
  isDealId,
  removeDeal,
  selectAllDeals,
  selectCouponForProduct,
  selectDeal,
  selectNextSale,
  selectPublishedDeals,
  selectPublishedSale,
  selectSalesCalendar,
  toDeal,
  updateDeal,
  updatePublished,
  type DealsClient,
} from "./db";

type Result = { data: unknown; error: { message: string } | null };
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
  not(...a: unknown[]) {
    return this.add("not", a);
  }
  lte(...a: unknown[]) {
    return this.add("lte", a);
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

function fakeDb(result: Result = { data: [], error: null }) {
  const queries: FakeQuery[] = [];
  const db = {
    from(table: string) {
      const q = new FakeQuery(table, result);
      queries.push(q);
      return q;
    },
  };
  return { db: db as unknown as DealsClient, queries };
}

const NOW = new Date("2026-10-01T09:00:00.000Z");
const ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const NOT_ENDED = "ends_at.is.null,ends_at.gt.2026-10-01T09:00:00.000Z";

let seq = 0;
function row(over: Partial<Deal> = {}): Record<string, unknown> {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    type: "deal",
    title: `דיל ${seq}`,
    body: "",
    product_id: null,
    coupon_code: null,
    starts_at: null,
    ends_at: null,
    published: true,
    created_at: "2026-09-27T10:00:00+00:00",
    ...over,
  };
}

describe("toDeal", () => {
  it("normalizes timestamps and a null body", () => {
    const deal = toDeal(row({ starts_at: "2026-11-11T00:00:00+02:00", body: null as never }));
    expect(deal).toMatchObject({
      starts_at: "2026-11-10T22:00:00.000Z",
      created_at: "2026-09-27T10:00:00.000Z",
      body: "",
    });
  });

  it("skips rows without the expected shape", () => {
    expect(toDeal(row({ type: "coupon" as never }))).toBeNull();
    expect(toDeal(row({ created_at: "yesterday" }))).toBeNull();
    expect(toDeal(null)).toBeNull();
  });
});

describe("public reads", () => {
  it("lists published, not-ended deals newest first", async () => {
    const { db, queries } = fakeDb();
    await selectPublishedDeals(db, NOW);
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("deals");
    expect(queries[0].calls).toEqual([
      ["select", DEAL_COLUMNS],
      ["eq", "published", true],
      ["or", NOT_ENDED],
      ["order", "created_at", { ascending: false }],
      ["limit", 100],
    ]);
  });

  it("drops ended, unpublished and malformed rows even if the database returns them", async () => {
    const keep = row({ ends_at: "2026-10-01T09:00:01Z" });
    const { db } = fakeDb({
      data: [
        keep,
        row({ ends_at: "2026-10-01T09:00:00Z" }),
        row({ published: false }),
        row({ title: 42 as never }),
      ],
      error: null,
    });
    const deals = await selectPublishedDeals(db, NOW);
    expect(deals.map((d) => d.id)).toEqual([keep.id]);
  });

  it("throws DealsDbError when the query fails", async () => {
    const { db } = fakeDb({ data: null, error: { message: "permission denied" } });
    await expect(selectPublishedDeals(db, NOW)).rejects.toBeInstanceOf(DealsDbError);
  });

  it("next sale: the earliest-starting published holiday that has not ended", async () => {
    const running = row({
      type: "holiday",
      starts_at: "2026-09-30T00:00:00Z",
      ends_at: "2026-10-02T00:00:00Z",
    });
    const later = row({ type: "holiday", starts_at: "2026-11-11T00:00:00+02:00" });
    const { db, queries } = fakeDb({ data: [running, later], error: null });
    expect((await selectNextSale(db, NOW))?.id).toBe(running.id);
    expect(queries[0].calls).toEqual([
      ["select", DEAL_COLUMNS],
      ["eq", "published", true],
      ["eq", "type", "holiday"],
      ["not", "starts_at", "is", null],
      ["or", NOT_ENDED],
      ["order", "starts_at", { ascending: true }],
      ["limit", 10],
    ]);
  });

  it("next sale: skips rows that do not qualify, null when none do", async () => {
    const future = row({ type: "holiday", starts_at: "2026-11-27T00:00:00+02:00" });
    const { db } = fakeDb({
      data: [
        row({
          type: "holiday",
          starts_at: "2026-09-01T00:00:00Z",
          ends_at: "2026-09-02T00:00:00Z",
        }),
        row({ type: "holiday", starts_at: null }),
        row({ type: "deal", starts_at: "2026-10-05T00:00:00Z" }),
        future,
      ],
      error: null,
    });
    expect((await selectNextSale(db, NOW))?.id).toBe(future.id);
    expect(await selectNextSale(fakeDb().db, NOW)).toBeNull();
  });

  it("sales calendar: published holidays not ended and starting within a year", async () => {
    const running = row({
      type: "holiday",
      starts_at: "2026-09-30T00:00:00Z",
      ends_at: "2026-10-02T00:00:00Z",
    });
    const later = row({ type: "holiday", starts_at: "2026-11-11T00:00:00+02:00" });
    const { db, queries } = fakeDb({ data: [running, later], error: null });
    expect((await selectSalesCalendar(db, NOW)).map((d) => d.id)).toEqual([running.id, later.id]);
    expect(queries[0].calls).toEqual([
      ["select", DEAL_COLUMNS],
      ["eq", "published", true],
      ["eq", "type", "holiday"],
      ["not", "starts_at", "is", null],
      ["lte", "starts_at", "2027-10-01T09:00:00.000Z"],
      ["or", NOT_ENDED],
      ["order", "starts_at", { ascending: true }],
      ["limit", 100],
    ]);
  });

  it("sales calendar: a shorter horizon moves the cutoff", async () => {
    const { db, queries } = fakeDb();
    await selectSalesCalendar(db, NOW, 30);
    expect(queries[0].calls).toContainEqual(["lte", "starts_at", "2026-10-31T09:00:00.000Z"]);
  });

  it("sales calendar: drops rows that do not qualify even if the database returns them", async () => {
    const keep = row({ type: "holiday", starts_at: "2027-09-30T00:00:00Z", ends_at: null });
    const { db } = fakeDb({
      data: [
        row({ type: "holiday", starts_at: "2026-09-01T00:00:00Z", ends_at: NOW.toISOString() }),
        row({ type: "holiday", starts_at: "2027-10-01T09:00:01Z" }),
        row({ type: "holiday", starts_at: null }),
        row({ type: "holiday", starts_at: "2026-11-11T00:00:00Z", published: false }),
        row({ type: "deal", starts_at: "2026-11-11T00:00:00Z" }),
        row({ type: "holiday", starts_at: "someday" }),
        keep,
      ],
      error: null,
    });
    expect((await selectSalesCalendar(db, NOW)).map((d) => d.id)).toEqual([keep.id]);
    await expect(
      selectSalesCalendar(fakeDb({ data: null, error: { message: "boom" } }).db, NOW),
    ).rejects.toBeInstanceOf(DealsDbError);
  });

  it("published sale: one holiday by uuid; other ids never reach the database", async () => {
    const sale = row({ id: ID, type: "holiday", starts_at: "2026-11-11T00:00:00Z" });
    const { db, queries } = fakeDb({ data: sale, error: null });
    expect((await selectPublishedSale(db, ID))?.id).toBe(ID);
    expect(queries[0].calls).toEqual([
      ["select", DEAL_COLUMNS],
      ["eq", "id", ID],
      ["eq", "published", true],
      ["eq", "type", "holiday"],
      ["maybeSingle"],
    ]);
    expect(await selectPublishedSale(db, "../etc")).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it("published sale: null for a missing row, a draft, another type or no start", async () => {
    expect(await selectPublishedSale(fakeDb({ data: null, error: null }).db, ID)).toBeNull();
    for (const over of [
      { published: false },
      { type: "deal" as const },
      { starts_at: null },
      { id: "9b1deb4d-3b7d-4bad-9bdd-000000000000" },
    ]) {
      const data = row({ id: ID, type: "holiday", starts_at: "2026-11-11T00:00:00Z", ...over });
      expect(await selectPublishedSale(fakeDb({ data, error: null }).db, ID)).toBeNull();
    }
  });

  it("coupon: newest current published deal for the product with a code", async () => {
    const notStarted = row({
      product_id: "1005001",
      coupon_code: "LATER",
      starts_at: "2026-10-10T00:00:00Z",
    });
    const current = row({ product_id: "1005001", coupon_code: "NOW5" });
    const { db, queries } = fakeDb({ data: [notStarted, current], error: null });
    expect((await selectCouponForProduct(db, "1005001", NOW))?.coupon_code).toBe("NOW5");
    expect(queries[0].calls).toEqual([
      ["select", DEAL_COLUMNS],
      ["eq", "published", true],
      ["eq", "product_id", "1005001"],
      ["not", "coupon_code", "is", null],
      ["or", NOT_ENDED],
      ["order", "created_at", { ascending: false }],
      ["limit", 20],
    ]);
  });

  it("coupon: no query for an id that cannot exist, null when nothing is current", async () => {
    const { db, queries } = fakeDb();
    expect(await selectCouponForProduct(db, "1,2", NOW)).toBeNull();
    expect(await selectCouponForProduct(db, "abc", NOW)).toBeNull();
    expect(queries).toHaveLength(0);
    const other = fakeDb({ data: [row({ product_id: "9", coupon_code: "X" })], error: null });
    expect(await selectCouponForProduct(other.db, "1005001", NOW)).toBeNull();
  });
});

describe("admin", () => {
  const input: DealInput = {
    type: "dont_buy",
    title: "לא לקנות: כרטיסי זיכרון 1TB",
    body: "",
    product_id: null,
    coupon_code: null,
    starts_at: null,
    ends_at: null,
  };

  it("lists every deal, drafts included, newest first", async () => {
    const { db, queries } = fakeDb({ data: [row({ published: false })], error: null });
    expect(await selectAllDeals(db)).toHaveLength(1);
    expect(queries[0].calls).toEqual([
      ["select", DEAL_COLUMNS],
      ["order", "created_at", { ascending: false }],
      ["limit", 500],
    ]);
  });

  it("gets one deal by uuid; other ids never reach the database", async () => {
    const found = row({ id: ID });
    const { db, queries } = fakeDb({ data: found, error: null });
    expect((await selectDeal(db, ID))?.id).toBe(ID);
    expect(queries[0].calls).toEqual([["select", DEAL_COLUMNS], ["eq", "id", ID], ["maybeSingle"]]);
    expect(await selectDeal(db, "1; drop table deals")).toBeNull();
    expect(queries).toHaveLength(1);
    expect(await selectDeal(fakeDb({ data: null, error: null }).db, ID)).toBeNull();
  });

  it("inserts and returns the saved row", async () => {
    const saved = row({ ...input, id: ID, published: false });
    const { db, queries } = fakeDb({ data: saved, error: null });
    expect((await insertDeal(db, input)).id).toBe(ID);
    expect(queries[0].calls).toEqual([["insert", input], ["select", DEAL_COLUMNS], ["single"]]);
  });

  it("updates by id, and reports a deal that is gone", async () => {
    const { db, queries } = fakeDb({ data: row({ ...input, id: ID }), error: null });
    await updateDeal(db, ID, input);
    expect(queries[0].calls).toEqual([
      ["update", input],
      ["eq", "id", ID],
      ["select", DEAL_COLUMNS],
      ["maybeSingle"],
    ]);
    await expect(
      updateDeal(fakeDb({ data: null, error: null }).db, ID, input),
    ).rejects.toBeInstanceOf(DealNotFoundError);
    await expect(updateDeal(db, "nope", input)).rejects.toBeInstanceOf(DealNotFoundError);
  });

  it("publishes and unpublishes by id", async () => {
    const { db, queries } = fakeDb({ data: [{ id: ID }], error: null });
    await updatePublished(db, ID, true);
    expect(queries[0].calls).toEqual([
      ["update", { published: true }],
      ["eq", "id", ID],
      ["select", "id"],
    ]);
    await expect(
      updatePublished(fakeDb({ data: [], error: null }).db, ID, false),
    ).rejects.toBeInstanceOf(DealNotFoundError);
  });

  it("deletes by id and ignores ids that cannot exist", async () => {
    const { db, queries } = fakeDb({ data: null, error: null });
    await removeDeal(db, ID);
    expect(queries[0].calls).toEqual([["delete"], ["eq", "id", ID]]);
    await removeDeal(db, "../etc");
    expect(queries).toHaveLength(1);
    await expect(
      removeDeal(fakeDb({ data: null, error: { message: "boom" } }).db, ID),
    ).rejects.toBeInstanceOf(DealsDbError);
  });

  it("recognizes deal ids", () => {
    expect(isDealId(ID)).toBe(true);
    expect(isDealId(ID.toUpperCase())).toBe(true);
    expect(isDealId("d1")).toBe(false);
    expect(isDealId(undefined)).toBe(false);
  });
});
