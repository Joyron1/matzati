// Orders our affiliate links earned (aliexpress.affiliate.order.list, docs 1913 and 1914), for the
// admin's revenue page (owner request 2026-10-19). Owner-side only: never shown to visitors.
// The method is open to this app (probed 2026-09-28 and 2026-10-19: resp_code 405 "The result is
// empty" for every status over 30 days, i.e. no orders yet). Field names follow the docs; amounts
// come as strings in the settlement currency, so every number is parsed defensively and a value
// that is not a number is null, never 0.
import type { AliExpressClient } from "./client";
import { AliExpressError } from "./errors";
import { unwrapList } from "./unwrap";

/** Every order status, queried one by one (doc 1913: one status per call). */
export const ORDER_STATUSES = [
  "Payment Completed",
  "Buyer Confirmed Receipt",
  "Completed Settlement",
  "Invalid",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Pages of 50 read per status at most: 250 orders a window, far above today's numbers. */
export const MAX_ORDER_PAGES = 5;

export interface AffiliateOrder {
  /** The sub-order (one product line), else the order id. */
  id: string;
  status: string;
  /** "YYYY-MM-DD HH:mm:ss" as AliExpress sends it (US Pacific time), or null. */
  paidTime: string | null;
  productId: string | null;
  productTitle: string | null;
  productCount: number | null;
  paidAmount: number | null;
  /** Commission AliExpress estimates on the paid amount. */
  estimatedCommission: number | null;
  /** Commission AliExpress estimates once the order is finished (after refunds). */
  finishedCommission: number | null;
  commissionRatePct: number | null;
  currency: string | null;
  isNewBuyer: boolean | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** "12.34", "12.34 USD", 12.34 or "7.0%" → the number; anything else → null. */
export function amountOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const m = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : null;

function boolOf(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "Y" || value === "1") return true;
  if (value === "false" || value === "N" || value === "0") return false;
  return null;
}

export function parseOrder(raw: unknown): AffiliateOrder | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.sub_order_id) ?? text(raw.order_id) ?? text(raw.order_number);
  if (!id) return null;
  return {
    id,
    status: text(raw.order_status) ?? "",
    paidTime: text(raw.paid_time) ?? text(raw.created_time),
    productId: text(raw.product_id),
    productTitle: text(raw.product_title),
    productCount: amountOf(raw.product_count),
    paidAmount: amountOf(raw.paid_amount),
    estimatedCommission: amountOf(raw.estimated_paid_commission),
    finishedCommission: amountOf(raw.estimated_finished_commission),
    commissionRatePct: amountOf(raw.commission_rate),
    currency: text(raw.settled_currency),
    isNewBuyer: boolOf(raw.is_new_buyer),
  };
}

/** One page of order.list's result: its orders and how many pages there are. */
export function parseOrderPage(result: unknown): { orders: AffiliateOrder[]; totalPages: number } {
  if (!isRecord(result)) return { orders: [], totalPages: 0 };
  const orders = unwrapList(result.orders, "order")
    .map(parseOrder)
    .filter((o): o is AffiliateOrder => o !== null);
  const totalPages = amountOf(result.total_page_no) ?? (orders.length ? 1 : 0);
  return { orders, totalPages };
}

/** "YYYY-MM-DD HH:mm:ss" in US Pacific time, the time order.list's start and end are read in. */
export function pacificTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * Every order paid between `start` and `end`, whatever its status now: each status in turn, page
 * by page (up to MAX_ORDER_PAGES), spaced `spacingMs` apart (AliExpress's frequency ban). "The
 * result is empty" (resp_code 405) is no orders; any other failure throws.
 */
export async function listOrders(
  client: AliExpressClient,
  { start, end }: { start: Date; end: Date },
  {
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    spacingMs = 1_100,
  }: { sleep?: (ms: number) => Promise<void>; spacingMs?: number } = {},
): Promise<AffiliateOrder[]> {
  const seen = new Map<string, AffiliateOrder>();
  let calls = 0;
  for (const status of ORDER_STATUSES) {
    for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
      if (calls++ > 0) await sleep(spacingMs);
      let parsed: { orders: AffiliateOrder[]; totalPages: number };
      try {
        const res = await client.call("aliexpress.affiliate.order.list", {
          start_time: pacificTime(start),
          end_time: pacificTime(end),
          status,
          time_type: "Payment Completed Time",
          page_no: page,
          page_size: 50,
        });
        parsed = parseOrderPage(res.result);
      } catch (err) {
        if (err instanceof AliExpressError && err.kind === "no_results") break;
        throw err;
      }
      for (const o of parsed.orders) seen.set(o.id, { ...o, status: o.status || status });
      if (page >= parsed.totalPages) break;
    }
  }
  return [...seen.values()].sort((a, b) => (b.paidTime ?? "").localeCompare(a.paidTime ?? ""));
}
