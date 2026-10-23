// One-off probe (2026-10-23): the raw amount fields of order.list, to check their unit (the revenue
// page showed a USB cable paid "$283"). One request; prints only amount, currency and rate fields
// plus a short title per order, never a secret from .env.local. Nothing is saved.
// Usage: npx tsx --env-file=.env.local scripts/probe-orders.ts
import { AliExpressClient } from "@/lib/aliexpress/client";
import { pacificTime } from "@/lib/aliexpress/orders";
import { unwrapList } from "@/lib/aliexpress/unwrap";
import { aliexpressConfig } from "@/lib/env";

async function main() {
  const client = new AliExpressClient(aliexpressConfig());
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 24 * 3600 * 1000);
  const res = await client.call("aliexpress.affiliate.order.list", {
    start_time: pacificTime(start),
    end_time: pacificTime(end),
    status: "Payment Completed",
    time_type: "Payment Completed Time",
    page_no: 1,
    page_size: 50,
  });
  const result = res.result as Record<string, unknown>;
  const orders = unwrapList(result.orders, "order") as Record<string, unknown>[];
  console.log(`orders: ${orders.length}`);
  if (orders[0]) console.log(`keys: ${Object.keys(orders[0]).sort().join(", ")}`);
  for (const o of orders.slice(0, 12)) {
    const pick = Object.fromEntries(
      Object.entries(o).filter(([k]) => /amount|commission|currency|price|rate|count|fee/i.test(k)),
    );
    console.log(String(o.product_title ?? "").slice(0, 40), JSON.stringify(pick));
  }
}

void main();
