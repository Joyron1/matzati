// The admin's revenue page (owner request 2026-10-19): what our links earned. Pure: the orders
// from AliExpress (lib/aliexpress/orders.ts) and the clicks we counted ourselves.
import type { AffiliateOrder } from "@/lib/aliexpress/orders";

/** An order that counts: anything but "Invalid" (refunded, risk, unsettled after 180 days). */
export const isCounted = (o: AffiliateOrder) => o.status !== "Invalid";

export interface CurrencyTotals {
  currency: string;
  /** Paid by buyers, counted orders only. */
  sales: number;
  /** AliExpress's estimate for the counted orders (finished estimate when there is one). */
  commission: number;
  /** Of that, orders already "Completed Settlement" (verified and paid in a monthly payout). */
  settled: number;
}

export interface RevenueSummary {
  /** Counted orders (sub-orders), and the products in them. */
  orders: number;
  items: number;
  invalid: number;
  /** One per settlement currency (normally USD only). */
  totals: CurrencyTotals[];
  /** Counted orders per click to AliExpress in the same window; null without clicks. */
  conversion: number | null;
}

export function summarizeRevenue(
  orders: readonly AffiliateOrder[],
  clicks: number,
): RevenueSummary {
  const counted = orders.filter(isCounted);
  const byCurrency = new Map<string, CurrencyTotals>();
  for (const o of counted) {
    const currency = o.currency ?? "USD";
    const t = byCurrency.get(currency) ?? { currency, sales: 0, commission: 0, settled: 0 };
    const commission = o.finishedCommission ?? o.estimatedCommission ?? 0;
    t.sales += o.paidAmount ?? 0;
    t.commission += commission;
    if (o.status === "Completed Settlement") t.settled += commission;
    byCurrency.set(currency, t);
  }
  return {
    orders: counted.length,
    items: counted.reduce((n, o) => n + (o.productCount ?? 1), 0),
    invalid: orders.length - counted.length,
    totals: [...byCurrency.values()],
    conversion: clicks > 0 ? counted.length / clicks : null,
  };
}

/** Hebrew names of the order statuses (the docs' meaning, doc 1913). */
export function orderStatusLabel(status: string): string {
  switch (status) {
    case "Payment Completed":
      return "שולם";
    case "Buyer Confirmed Receipt":
      return "הקונה אישר קבלה";
    case "Completed Settlement":
      return "אושר לתשלום עמלה";
    case "Invalid":
      return "בוטל (החזר או לא אושר)";
    default:
      return status || "לא ידוע";
  }
}
