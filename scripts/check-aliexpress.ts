// Credential and API check (CLAUDE.md §5.4). Makes exactly 3 AliExpress calls.
// Usage: npm run check:ali            prints PASS/FAIL per step
//        npm run check:ali -- --save  also writes the raw responses to fixtures/aliexpress/,
//                                     with every .env.local value (the tracking id in
//                                     link.generate's result) replaced by <KEY>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { productQueryParams } from "@/lib/aliexpress/affiliate";
import { AliExpressClient, type CallResult } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import { unwrapList } from "@/lib/aliexpress/unwrap";
import { aliexpressConfig, ConfigError, type AliExpressConfig } from "@/lib/env";
import {
  findEnvValues,
  maskEnvValues,
  maskEnvValuesDeep,
  parseEnvFile,
  secretEnv,
  type EnvValues,
} from "@/lib/mask";

const SAVE = process.argv.includes("--save");
const FIXTURES = "fixtures/aliexpress";

type Row = Record<string, unknown>;

const readIfExists = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

// Every .env.local value, not only the AliExpress ones; the config values in case the variables
// came from somewhere else.
let secrets: EnvValues = {};
function loadSecrets(config: AliExpressConfig) {
  secrets = {
    ...secretEnv(
      parseEnvFile(readIfExists(".env.local")),
      parseEnvFile(readIfExists(".env.example")),
    ),
    ALIEXPRESS_APP_KEY: config.appKey,
    ALIEXPRESS_APP_SECRET: config.appSecret,
    ALIEXPRESS_TRACKING_ID: config.trackingId,
  };
}

function saveFixture(method: string, res: CallResult) {
  if (!SAVE) return;
  const text = `${JSON.stringify(maskEnvValuesDeep(res.raw, secrets), null, 2)}\n`;
  const { leaks } = findEnvValues(text, secrets);
  if (leaks.length) {
    console.log(`       NOT SAVED ${FIXTURES}/${method}.json: still contains ${leaks.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(`${FIXTURES}/${method}.json`, text);
  console.log(`       saved ${FIXTURES}/${method}.json (.env.local values masked)`);
}

function describeError(err: unknown): string {
  let text: string;
  if (err instanceof AliExpressError) {
    const d = err.details;
    text = `[${err.kind}] ${err.message}${d.requestId ? ` (request_id ${d.requestId})` : ""}`;
  } else {
    text = err instanceof Error ? err.message : String(err);
  }
  return maskEnvValues(text, secrets);
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await fn();
    console.log(`PASS  ${name}`);
    return value;
  } catch (err) {
    console.log(`FAIL  ${name}\n       ${describeError(err)}`);
    process.exitCode = 1;
    return undefined;
  }
}

async function main() {
  let config;
  try {
    config = aliexpressConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.log(`FAIL  config: missing or invalid ${err.missing.join(", ")} in .env.local`);
      process.exit(1);
    }
    throw err;
  }

  loadSecrets(config);
  console.log(`app_key     set (${config.appKey.length} chars)`);
  console.log(`app_secret  set (${config.appSecret.length} chars)`);
  console.log(`tracking_id set (${config.trackingId.length} chars)`);
  console.log(`gateway     ${config.gateway}\n`);

  const client = new AliExpressClient(config);

  await step("1/3 aliexpress.affiliate.category.get", async () => {
    const res = await client.call("aliexpress.affiliate.category.get");
    saveFixture("aliexpress.affiliate.category.get", res);
    const categories = unwrapList((res.result as Row | undefined)?.categories, "category");
    if (!categories.length) throw new Error("no categories returned");
    console.log(`       ${categories.length} categories`);
  });

  const product = await step("2/3 aliexpress.affiliate.product.query (usb cable)", async () => {
    // Same params the search pipeline sends, so the saved fixture matches production.
    const res = await client.call(
      "aliexpress.affiliate.product.query",
      productQueryParams({ keywords: "usb cable" }, config.trackingId),
    );
    saveFixture("aliexpress.affiliate.product.query", res);
    const result = res.result as Row | undefined;
    const products = unwrapList(result?.products, "product") as Row[];
    if (!products.length) throw new Error("no products returned");
    const p = products[0];
    console.log(
      `       ${products.length} products (total_record_count ${result?.total_record_count})`,
    );
    console.log(`       first: ${p.product_id} | ${String(p.product_title).slice(0, 60)}`);
    console.log(
      `       price ${p.target_sale_price} ${p.target_sale_price_currency} | evaluate_rate ${p.evaluate_rate} | lastest_volume ${p.lastest_volume} | promotion_link ${p.promotion_link ? "yes" : "no"}`,
    );
    return p;
  });

  await step("3/3 aliexpress.affiliate.link.generate", async () => {
    const source =
      (product?.product_detail_url as string | undefined) ??
      "https://www.aliexpress.com/item/1005006123450001.html";
    const res = await client.call("aliexpress.affiliate.link.generate", {
      promotion_link_type: 0,
      source_values: source,
      tracking_id: config.trackingId,
    });
    saveFixture("aliexpress.affiliate.link.generate", res);
    const links = unwrapList(
      (res.result as Row | undefined)?.promotion_links,
      "promotion_link",
    ) as Row[];
    const link = links[0]?.promotion_link;
    if (typeof link !== "string" || !link.startsWith("http")) {
      throw new Error(
        `no promotion_link returned (message: ${String(links[0]?.message ?? "none")})`,
      );
    }
    console.log(`       ${new URL(link).host} link generated`);
  });
}

main().catch((err) => {
  console.error(describeError(err));
  process.exit(1);
});
