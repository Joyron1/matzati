// One-off probe (2026-10-24, photo/link "match" search): does one productdetail.get return HE
// titles for 20 ids at once? 1 request. Ids from the committed product.query fixture.
// Usage: npx tsx --env-file=.env.local scripts/probe-details-batch.ts
import { readFileSync } from "node:fs";
import { getProductDetails } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { aliexpressConfig } from "@/lib/env";

async function main() {
  const text = readFileSync("fixtures/aliexpress/aliexpress.affiliate.product.query.json", "utf8");
  const ids = [
    ...new Set([...text.matchAll(/"product_id":\s*"?(\d{10,20})/g)].map((m) => m[1])),
  ].slice(0, 20);
  const client = new AliExpressClient(aliexpressConfig(), { retries: 0 });
  const page = await getProductDetails(client, ids, "HE");
  const hebrew = page.products.filter((p) => /[֐-׿]/.test(p.title)).length;
  console.log(
    `asked ${ids.length}, got ${page.products.length}, Hebrew titles ${hebrew}, skipped ${page.skipped}`,
  );
  for (const p of page.products.slice(0, 3)) console.log(`  ${p.title.slice(0, 70)}`);
}

void main();
