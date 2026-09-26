// One-off probes for behaviors the docs leave open (CLAUDE.md §5.3). Makes exactly 5 AliExpress
// calls and saves fixtures for productdetail.get and hotproduct.query (check:ali owns the
// product.query fixture). Kept to re-verify these findings; see docs/aliexpress-api.md.
// Usage: npx tsx --env-file=.env.local scripts/probe-aliexpress.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { AliExpressClient, type CallResult, type ParamValue } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import { unwrapList } from "@/lib/aliexpress/unwrap";
import { aliexpressConfig } from "@/lib/env";

type Row = Record<string, unknown>;
const FIXTURES = "fixtures/aliexpress";
const config = aliexpressConfig();
const client = new AliExpressClient(config);
const base = { keywords: "usb cable", page_no: 1, target_language: "HE", ship_to_country: "IL" };

function save(name: string, res: CallResult) {
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(`${FIXTURES}/${name}.json`, `${JSON.stringify(res.raw, null, 2)}\n`);
}

function products(res: CallResult): Row[] {
  return unwrapList((res.result as Row | undefined)?.products, "product") as Row[];
}

function priceStats(rows: Row[]) {
  const prices = rows.map((p) => Number(p.target_sale_price)).filter(Number.isFinite);
  const currencies = [...new Set(rows.map((p) => p.target_sale_price_currency))];
  return { count: rows.length, min: Math.min(...prices), max: Math.max(...prices), currencies };
}

async function run(label: string, method: string, params: Record<string, ParamValue>) {
  try {
    const res = await client.call(method, { tracking_id: config.trackingId, ...params });
    console.log(`OK    ${label}`);
    return res;
  } catch (err) {
    const msg = err instanceof AliExpressError ? `[${err.kind}] ${err.message}` : String(err);
    console.log(`ERROR ${label}: ${msg}`);
    return undefined;
  }
}

async function main() {
  // 1. Relevance with LAST_VOLUME_DESC, ILS. This is the config the search pipeline will use.
  const sorted = await run(
    "1/5 product.query ILS sort=LAST_VOLUME_DESC",
    "aliexpress.affiliate.product.query",
    {
      ...base,
      page_size: 50,
      sort: "LAST_VOLUME_DESC",
      target_currency: "ILS",
    },
  );
  if (sorted) {
    const rows = products(sorted);
    console.log("      ", priceStats(rows));
    for (const p of rows.slice(0, 8)) {
      console.log(
        `       ${p.lastest_volume} sold | ${p.evaluate_rate || "-"} | ${p.target_sale_price} ${p.target_sale_price_currency} | ${String(p.product_title).slice(0, 55)}`,
      );
    }
  }

  // 2 + 3. Units/currency of max_sale_price: 1000 means ₪10 (ILS cents), $10 (USD cents),
  // ₪1000 or $1000 (whole units). Compare the observed maximum under each target currency.
  const ilsCap = await run(
    "2/5 product.query ILS max_sale_price=1000",
    "aliexpress.affiliate.product.query",
    {
      ...base,
      page_size: 50,
      sort: "LAST_VOLUME_DESC",
      target_currency: "ILS",
      max_sale_price: 1000,
    },
  );
  if (ilsCap) console.log("      ", priceStats(products(ilsCap)));
  const usdCap = await run(
    "3/5 product.query USD max_sale_price=1000",
    "aliexpress.affiliate.product.query",
    {
      ...base,
      page_size: 50,
      sort: "LAST_VOLUME_DESC",
      target_currency: "USD",
      max_sale_price: 1000,
    },
  );
  if (usdCap) console.log("      ", priceStats(products(usdCap)));

  // 4. productdetail.get: is ILS honored there too?
  const topId = sorted ? String(products(sorted)[0]?.product_id ?? "") : "";
  const detail = await run("4/5 productdetail.get ILS", "aliexpress.affiliate.productdetail.get", {
    product_ids: topId,
    target_currency: "ILS",
    target_language: "HE",
    country: "IL",
  });
  if (detail) {
    save("aliexpress.affiliate.productdetail.get", detail);
    console.log("      ", priceStats(products(detail)));
  }

  // 5. hotproduct.query: is ILS honored there too?
  const hot = await run("5/5 hotproduct.query ILS", "aliexpress.affiliate.hotproduct.query", {
    ...base,
    page_size: 10,
    target_currency: "ILS",
  });
  if (hot) {
    save("aliexpress.affiliate.hotproduct.query", hot);
    console.log("      ", priceStats(products(hot)));
  }
}

main();
