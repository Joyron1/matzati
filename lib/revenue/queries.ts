// The admin's revenue page (owner request 2026-10-19): AliExpress's orders for our links and the
// clicks to AliExpress we counted, over REVENUE_DAYS. Server-only; admin pages only.
import "server-only";
import { unstable_cache } from "next/cache";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { listOrders, type AffiliateOrder } from "@/lib/aliexpress/orders";
import { aliexpressConfig } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";

export const REVENUE_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * Orders paid in the last REVENUE_DAYS (4 order.list calls when there are none), cached an hour so
 * reloading the page does not call AliExpress again; null when AliExpress could not be read.
 */
const cachedOrders = unstable_cache(
  async (): Promise<AffiliateOrder[] | null> => {
    const end = new Date();
    try {
      return await listOrders(new AliExpressClient(aliexpressConfig()), {
        start: new Date(end.getTime() - REVENUE_DAYS * DAY_MS),
        end,
      });
    } catch (err) {
      const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error(`[revenue] order.list failed: ${text.slice(0, 300)}`);
      return null;
    }
  },
  ["affiliate-orders", "2"] // 2: amounts in cents (2026-10-23),
  { revalidate: 3600 },
);

export interface ClickCounts {
  days30: number;
  days7: number;
}

/** Clicks to AliExpress through our links (/go) on the live site, not the owner's; null on error. */
async function clickCounts(now: Date): Promise<ClickCounts | null> {
  const db = serviceClient();
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const count = async (days: number) => {
    const { count, error } = await db
      .from("clicks")
      .select("id", { count: "exact", head: true })
      .eq("env", "production")
      .eq("owner", false)
      .gte("created_at", since(days));
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  try {
    const [days30, days7] = await Promise.all([count(REVENUE_DAYS), count(7)]);
    return { days30, days7 };
  } catch (err) {
    console.error(`[revenue] clicks: ${String(err).slice(0, 300)}`);
    return null;
  }
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

export interface RevenueData {
  orders: AffiliateOrder[] | null;
  clicks: ClickCounts | null;
  titles: Record<string, string>;
  /** When the orders were read (the cache may be up to an hour old: then "now" is earlier). */
  loadedAt: string;
}

export async function loadRevenue(now = new Date()): Promise<RevenueData> {
  const [orders, clicks] = await Promise.all([cachedOrders(), clickCounts(now)]);
  const ids = [...new Set((orders ?? []).flatMap((o) => (o.productId ? [o.productId] : [])))];
  return { orders, clicks, titles: await titlesOf(ids), loadedAt: now.toISOString() };
}
