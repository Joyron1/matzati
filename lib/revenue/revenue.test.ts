import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "@/lib/aliexpress/client";
import {
  amountOf,
  listOrders,
  ORDER_STATUSES,
  pacificTime,
  parseOrder,
  parseOrderPage,
  type AffiliateOrder,
} from "@/lib/aliexpress/orders";
import { orderStatusLabel, summarizeRevenue } from "./report";

// Shaped as doc 1913 describes order.list's result (no real order exists yet, 2026-10-19).
const RAW = {
  sub_order_id: "8100000000001",
  order_id: "8100000000000",
  order_status: "Payment Completed",
  paid_time: "2026-10-18 10:11:12",
  product_id: "1005001",
  product_title: "RC car",
  product_count: 2,
  paid_amount: "25.50",
  estimated_paid_commission: "1.79",
  estimated_finished_commission: "",
  commission_rate: "7.0%",
  settled_currency: "USD",
  is_new_buyer: "Y",
};

const order = (over: Partial<AffiliateOrder> = {}): AffiliateOrder => ({
  id: "1",
  status: "Payment Completed",
  paidTime: "2026-10-18 10:00:00",
  productId: "1",
  productTitle: null,
  productCount: 1,
  paidAmount: 10,
  estimatedCommission: 1,
  finishedCommission: null,
  commissionRatePct: 10,
  currency: "USD",
  isNewBuyer: null,
  ...over,
});

describe("order.list parsing", () => {
  it("reads amounts and rates from strings, and an empty one as null", () => {
    expect(amountOf("25.50")).toBe(25.5);
    expect(amountOf("1,025.50 USD")).toBe(1025.5);
    expect(amountOf("7.0%")).toBe(7);
    expect(amountOf("")).toBeNull();
    expect(amountOf(undefined)).toBeNull();
    expect(amountOf(Number.NaN)).toBeNull();
  });

  it("parses an order as the docs describe it", () => {
    expect(parseOrder(RAW)).toEqual({
      id: "8100000000001",
      status: "Payment Completed",
      paidTime: "2026-10-18 10:11:12",
      productId: "1005001",
      productTitle: "RC car",
      productCount: 2,
      paidAmount: 25.5,
      estimatedCommission: 1.79,
      finishedCommission: null,
      commissionRatePct: 7,
      currency: "USD",
      isNewBuyer: true,
    });
    expect(parseOrder({})).toBeNull();
  });

  it("reads a page in either list shape", () => {
    expect(parseOrderPage({ total_page_no: 3, orders: { order: [RAW] } })).toMatchObject({
      totalPages: 3,
      orders: [{ id: "8100000000001" }],
    });
    expect(parseOrderPage({ orders: [RAW, RAW] }).orders).toHaveLength(2);
    expect(parseOrderPage(null)).toEqual({ orders: [], totalPages: 0 });
  });

  it("writes times in US Pacific time", () => {
    // 2026-10-19 08:00 UTC is 01:00 PDT.
    expect(pacificTime(new Date("2026-10-19T08:00:00Z"))).toBe("2026-10-19 01:00:00");
  });
});

describe("listOrders", () => {
  function client(answer: (status: string, page: number) => unknown) {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const p = new URLSearchParams(String(init?.body));
      const body = answer(p.get("status")!, Number(p.get("page_no")));
      return new Response(JSON.stringify(body));
    });
    const c = new AliExpressClient(
      { appKey: "k", appSecret: "s", trackingId: "t", gateway: "https://g.test/sync" },
      { fetch: fetchMock, sleep: async () => {} },
    );
    return { c, fetchMock };
  }
  const envelope = (resp: Record<string, unknown>) => ({
    aliexpress_affiliate_order_list_response: { resp_result: resp },
  });

  it("asks every status, takes 'the result is empty' as none, and dedupes", async () => {
    const { c, fetchMock } = client((status) =>
      status === "Payment Completed"
        ? envelope({ resp_code: 200, result: { total_page_no: 1, orders: { order: [RAW, RAW] } } })
        : envelope({ resp_code: 405, resp_msg: "The result is empty" }),
    );
    const orders = await listOrders(
      c,
      { start: new Date("2026-09-19"), end: new Date("2026-10-19") },
      { sleep: async () => {} },
    );
    expect(orders).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(ORDER_STATUSES.length);
  });

  it("reads further pages, at most MAX_ORDER_PAGES", async () => {
    const { c, fetchMock } = client((status, page) =>
      status === "Completed Settlement"
        ? envelope({
            resp_code: 200,
            result: {
              total_page_no: 9,
              orders: { order: [{ ...RAW, sub_order_id: `s${page}`, order_status: status }] },
            },
          })
        : envelope({ resp_code: 405, resp_msg: "The result is empty" }),
    );
    const orders = await listOrders(
      c,
      { start: new Date("2026-09-19"), end: new Date("2026-10-19") },
      { sleep: async () => {} },
    );
    expect(orders).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(ORDER_STATUSES.length - 1 + 5);
  });

  it("throws any other failure", async () => {
    const { c } = client(() => envelope({ resp_code: 402, resp_msg: "Invalid parameter" }));
    await expect(
      listOrders(c, { start: new Date(), end: new Date() }, { sleep: async () => {} }),
    ).rejects.toThrow(/402/);
  });
});

describe("summarizeRevenue", () => {
  it("counts every order but the invalid ones, by currency, with the settled share", () => {
    const s = summarizeRevenue(
      [
        order({ id: "a", productCount: 2 }),
        order({ id: "b", status: "Completed Settlement", finishedCommission: 3, paidAmount: 30 }),
        order({ id: "c", status: "Invalid", paidAmount: 99, estimatedCommission: 9 }),
      ],
      200,
    );
    expect(s).toEqual({
      orders: 2,
      items: 3,
      invalid: 1,
      totals: [{ currency: "USD", sales: 40, commission: 4, settled: 3 }],
      conversion: 0.01,
    });
  });

  it("has no conversion without clicks, and no totals without orders", () => {
    expect(summarizeRevenue([], 0)).toEqual({
      orders: 0,
      items: 0,
      invalid: 0,
      totals: [],
      conversion: null,
    });
  });

  it("names the statuses in Hebrew", () => {
    expect(orderStatusLabel("Completed Settlement")).toBe("אושר לתשלום עמלה");
    expect(orderStatusLabel("Something new")).toBe("Something new");
  });
});
