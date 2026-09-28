import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ serviceClient: () => ({}) }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

import type { AliPromoCode } from "@/lib/aliexpress/promo-code";
import {
  API_CODES_COLUMNS,
  ApiCodesDbError,
  selectApiCodes,
  toApiCodeProducts,
  type ProductsClient,
} from "./api-codes";

const NOW = new Date("2026-10-01T09:00:00.000Z");

const PROMO: AliPromoCode = {
  code: "ILSALE3",
  offerText: "On order over ILS 62.2 , get ILS 3.11 off",
  offer: { kind: "amount", off: 3.11, minSpend: 62.2, currency: "ILS" },
  minSpend: 62.2,
  startsAt: "2026-09-30T07:00:00.000Z",
  endsAt: "2026-10-05T06:59:59.000Z",
  promotionUrl: null,
};

let seq = 0;
function row(over: Record<string, unknown> = {}, promo: unknown = PROMO) {
  seq += 1;
  return {
    product_id: `100500000000${seq}`,
    title_he: "מחזיק טלפון לרכב",
    updated_at: "2026-10-01T08:00:00+00:00",
    title: "Car Phone Holder",
    image: "https://ae-pic-a1.aliexpress-media.com/kf/x.jpg",
    currency: "ILS",
    promo,
    ...over,
  };
}
const productIds = (data: unknown[]) => toApiCodeProducts(data, NOW).map((i) => i.productId);

describe("toApiCodeProducts", () => {
  it("maps a row to the product, its code and when it was checked", () => {
    const r = row();
    expect(toApiCodeProducts([r], NOW)).toEqual([
      {
        productId: r.product_id,
        title: "מחזיק טלפון לרכב",
        titleIsHebrew: true,
        machineTranslated: false,
        imageUrl: r.image,
        checkedAt: "2026-10-01T08:00:00.000Z",
        promoCode: PROMO,
      },
    ]);
  });

  it("falls back to the AliExpress title, and keeps a code whose offer it cannot read", () => {
    const [item] = toApiCodeProducts(
      [row({ title_he: null, image: null }, { ...PROMO, offer: { kind: "bogo" } })],
      NOW,
    );
    expect(item).toMatchObject({
      title: "Car Phone Holder",
      titleIsHebrew: false,
      machineTranslated: false,
      imageUrl: null,
      promoCode: { code: "ILSALE3", offer: null, offerText: PROMO.offerText },
    });
  });

  it("reads AliExpress's Hebrew title of a hot product as Hebrew, machine-translated", () => {
    // Saved from a hot list: data.title is AliExpress's Hebrew and there is no title_he. It used to
    // be laid out left to right, which reversed "Joyroom 125W" and the words around it.
    const [item] = toApiCodeProducts(
      [row({ title_he: null, title: "מטען רכב Joyroom 125W עם 3 יציאות" })],
      NOW,
    );
    expect(item).toMatchObject({
      title: "מטען רכב Joyroom 125W עם 3 יציאות",
      titleIsHebrew: true,
      machineTranslated: true,
    });
    // Its known transliterated loan words are fixed, as on the hot cards and /p.
    const [loan] = toApiCodeProducts([row({ title_he: null, title: "מחזיק וויירלס לרכב" })], NOW);
    expect(loan).toMatchObject({ title: "מחזיק בחיבור אלחוטי לרכב", machineTranslated: true });
  });

  it("shows a code only while valid by both of its dates (as on /p)", () => {
    const keep = row();
    expect(
      productIds([
        keep,
        row({}, { ...PROMO, endsAt: NOW.toISOString() }),
        row({}, { ...PROMO, endsAt: null }),
        row({}, { ...PROMO, startsAt: null }),
        row({}, { ...PROMO, startsAt: "2026-10-02T00:00:00Z" }),
      ]),
    ).toEqual([keep.product_id]);
  });

  it("drops stale rows, other currencies, malformed rows and duplicates", () => {
    const keep = row();
    expect(
      productIds([
        keep,
        { ...keep },
        row({ updated_at: "2026-09-29T08:59:59Z" }),
        row({ currency: "USD" }),
        row({ currency: null }),
        row({}, { ...PROMO, code: "SAVE 5" }),
        row({}, null),
        row({ title_he: null, title: " " }),
        row({ product_id: "abc" }),
        "not a row",
      ]),
    ).toEqual([keep.product_id]);
    expect(toApiCodeProducts(null, NOW)).toEqual([]);
  });

  it("orders the soonest to end first", () => {
    const later = row({}, { ...PROMO, endsAt: "2026-10-20T00:00:00.000Z" });
    const sooner = row({}, { ...PROMO, endsAt: "2026-10-02T00:00:00.000Z" });
    expect(productIds([later, sooner])).toEqual([sooner.product_id, later.product_id]);
  });
});

describe("selectApiCodes", () => {
  function fakeDb(result: { data: unknown; error: { message: string } | null }) {
    const calls: unknown[][] = [];
    const query = {
      select: (...a: unknown[]) => (calls.push(["select", ...a]), query),
      not: (...a: unknown[]) => (calls.push(["not", ...a]), query),
      gte: (...a: unknown[]) => (calls.push(["gte", ...a]), query),
      order: (...a: unknown[]) => (calls.push(["order", ...a]), query),
      limit: (...a: unknown[]) => (calls.push(["limit", ...a]), Promise.resolve(result)),
    };
    const db = { from: (table: string) => (calls.push(["from", table]), query) };
    return { db: db as unknown as ProductsClient, calls };
  }

  it("reads the newest products refreshed in the last 48 hours that have a code", async () => {
    const { db, calls } = fakeDb({ data: [row()], error: null });
    expect(await selectApiCodes(db, NOW)).toHaveLength(1);
    expect(calls).toEqual([
      ["from", "products"],
      ["select", API_CODES_COLUMNS],
      ["not", "data->>promoCode", "is", null],
      ["gte", "updated_at", "2026-09-29T09:00:00.000Z"],
      ["order", "updated_at", { ascending: false }],
      ["limit", 200],
    ]);
  });

  it("throws ApiCodesDbError when the query fails", async () => {
    const { db } = fakeDb({ data: null, error: { message: "timeout" } });
    await expect(selectApiCodes(db, NOW)).rejects.toBeInstanceOf(ApiCodesDbError);
  });
});
