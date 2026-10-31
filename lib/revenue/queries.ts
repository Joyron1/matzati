// The admin's revenue page (owner request 2026-10-19): AliExpress's orders for our links and the
// clicks to AliExpress we counted, over a range of Israel days (lib/revenue/range.ts, owner
// request 2026-10-29). Server-only; admin pages only.
import "server-only";
import { unstable_cache } from "next/cache";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import { listOrders, type AffiliateOrder } from "@/lib/aliexpress/orders";
import { aliexpressConfig, usdIlsFallback } from "@/lib/env";
import { fetchUsdIlsRate, type UsdIlsRate } from "@/lib/fx/boi";
import { serviceClient } from "@/lib/supabase/server";
import { orderWindows, rangeInstants, type RevenueRange } from "./range";

/**
 * Orders paid between two instants, a WINDOW_DAYS window at a time (4 order.list calls a window
 * when there are none), cached an hour per range so reloading the page does not call AliExpress
 * again. A failure throws, so it is never cached: the next load asks again (2026-10-29: a failed
 * read was cached as "unavailable" for an hour, and the page showed no orders and no commission).
 */
const cachedOrders = unstable_cache(
  async (startIso: string, endIso: string): Promise<AffiliateOrder[]> => {
    const client = new AliExpressClient(aliexpressConfig());
    const seen = new Map<string, AffiliateOrder>();
    for (const w of orderWindows(new Date(startIso), new Date(endIso))) {
      for (const o of await listOrders(client, w)) seen.set(o.id, o);
    }
    return [...seen.values()].sort((a, b) => (b.paidTime ?? "").localeCompare(a.paidTime ?? ""));
  },
  // Key version 3: a range per entry (2026-10-29).
  ["affiliate-orders", "3"],
  { revalidate: 3600 },
);

/** Why the orders could not be read, for the page: the error's kind only, never its details. */
export type OrdersError = "rate_limit" | "auth" | "network" | "other";

function ordersErrorOf(err: unknown): OrdersError {
  if (err instanceof AliExpressError) {
    if (err.kind === "rate_limit" || err.kind === "auth") return err.kind;
    if (err.kind === "network" || err.kind === "server") return "network";
  }
  return "other";
}

/** Clicks to AliExpress through our links (/go) on the live site, not the owner's; null on error. */
async function clickCount(start: Date, end: Date): Promise<number | null> {
  const { count, error } = await serviceClient()
    .from("clicks")
    .select("id", { count: "exact", head: true })
    .eq("env", "production")
    .eq("owner", false)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (error) {
    console.error(`[revenue] clicks: ${error.message.slice(0, 300)}`);
    return null;
  }
  return count ?? 0;
}

/** Our Hebrew (or stored) titles of the ordered products, by product id. */
async function titlesOf(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data, error } = await serviceClient()
    .from("products")
    .select("product_id, title_he, data->>title")
    .in("product_id", ids);
  if (error || !data) return {};
  return Object.fromEntries(
    (data as { product_id: string; title_he: string | null; title: string | null }[]).map((r) => [
      r.product_id,
      r.title_he ?? r.title ?? "",
    ]),
  );
}

/** USD_ILS_FALLBACK, or its default when the configured value is invalid. */
function fallbackRate(): number {
  try {
    return usdIlsFallback();
  } catch {
    return usdIlsFallback({ ...process.env, USD_ILS_FALLBACK: undefined });
  }
}

export interface RevenueData {
  orders: AffiliateOrder[] | null;
  /** Set when `orders` is null. */
  ordersError: OrdersError | null;
  clicks: number | null;
  titles: Record<string, string>;
  /** The day's USD→ILS rate, for the amounts in shekels (lib/fx/boi.ts, never throws). */
  fx: UsdIlsRate;
}

export async function loadRevenue(range: RevenueRange, now = new Date()): Promise<RevenueData> {
  const { start, end } = rangeInstants(range, now);
  // A range that ends today ends now, which changes every second; the cache key ends at the hour.
  const endKey =
    end.getTime() >= now.getTime()
      ? new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000)
      : end;
  const ordersRead = cachedOrders(start.toISOString(), endKey.toISOString()).then(
    (orders) => ({ orders, ordersError: null }),
    (err: unknown) => {
      const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`[revenue] order.list failed: ${text.slice(0, 300)}`);
      return { orders: null, ordersError: ordersErrorOf(err) };
    },
  );
  const [{ orders, ordersError }, clicks, fx] = await Promise.all([
    ordersRead,
    clickCount(start, end),
    fetchUsdIlsRate(fallbackRate()),
  ]);
  const ids = [...new Set((orders ?? []).flatMap((o) => (o.productId ? [o.productId] : [])))];
  return { orders, ordersError, clicks, titles: await titlesOf(ids), fx };
}
