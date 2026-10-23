// One-off probe (2026-10-23): does aliexpress.affiliate.product.shipping.get answer for this app,
// and what does it return for Israel? Owner request: the product finder should keep free-shipping
// products only. At most 2 requests, 2 s apart, no retries. Prints the error code or the masked
// response; never prints a secret from .env.local.
// Usage: npx tsx --env-file=.env.local scripts/probe-shipping.ts
import { existsSync, readFileSync } from "node:fs";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import { aliexpressConfig } from "@/lib/env";
import { maskEnvValuesDeep, parseEnvFile, secretEnv } from "@/lib/mask";

const PRODUCT_ID = "1005006338829917"; // fixtures/aliexpress/aliexpress.affiliate.productdetail.get.json
const SECRETS = secretEnv(
  parseEnvFile(readFileSync(".env.local", "utf8")),
  parseEnvFile(existsSync(".env.example") ? readFileSync(".env.example", "utf8") : ""),
);
const client = new AliExpressClient(aliexpressConfig());

const attempts: Record<string, string | number>[] = [
  {
    product_id: PRODUCT_ID,
    sku_id: "12000036815593862",
    ship_to_country: "IL",
    target_currency: "ILS",
    target_language: "EN",
    target_sale_price: "15.68",
    tax_rate: "0",
  },
];

async function main() {
  for (const [i, params] of attempts.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2_000));
    console.log(`--- attempt ${i + 1}: ${JSON.stringify(params)}`);
    try {
      const res = await client.call("aliexpress.affiliate.product.shipping.get", params);
      console.log(JSON.stringify(maskEnvValuesDeep(res.result, SECRETS), null, 2).slice(0, 3000));
      break;
    } catch (err) {
      if (err instanceof AliExpressError)
        console.log(`error: ${err.name} ${err.message}`.slice(0, 400));
      else console.log(`error: ${String(err)}`.slice(0, 400));
    }
  }
}

void main();
