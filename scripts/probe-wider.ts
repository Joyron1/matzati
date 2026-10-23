// One-off experiment (2026-10-24, "wider fetch"): for stored searches (fixtures/snapshots), which
// extra call adds passing products the current fetch does not find? Per query, 3 calls on the
// parse's primary keywords, EN, page 1 of 50, the price bounds: (A) product.query by 30-day sales
// (what the search sends today), (B) product.query with no sort (AliExpress's own relevance order),
// (C) hotproduct.query with the keywords. At most 24 requests, 1.5 s apart, no retries, no LLM.
// Prints per query: products, passers (FILTERS), passers B and C add beyond A; then totals.
// Usage: npx tsx --env-file=.env.local scripts/probe-wider.ts
import { readFileSync } from "node:fs";
import { AliExpressClient, type ParamValue } from "@/lib/aliexpress/client";
import { parseProductPage, type AliProduct } from "@/lib/aliexpress/schemas";
import { aliexpressConfig } from "@/lib/env";
import { parseSnapshot } from "@/lib/eval/snapshot";
import { passesFilters } from "@/lib/ranking/rank";
import { keywordSteps } from "@/lib/search/fetch-policy";

const QUERIES = [
  "car-holder",
  "ho-speaker",
  "ho-powerbank",
  "home-nightlight",
  "kids-toy",
  "kids-bottle",
  "live-sonic-doll",
  "price-watch",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = aliexpressConfig();
  const client = new AliExpressClient(config, { retries: 0 });
  const totals = { A: 0, B: 0, C: 0, newB: 0, newC: 0 };
  let first = true;
  for (const id of QUERIES) {
    const snap = parseSnapshot(
      JSON.parse(readFileSync(`fixtures/snapshots/${id}.json`, "utf8")),
      id,
    );
    const f = snap.parse.parsed;
    const keywords = keywordSteps(f)[0].keywords;
    const base: Record<string, ParamValue> = {
      keywords,
      page_no: 1,
      page_size: 50,
      target_currency: "ILS",
      target_language: "EN",
      ship_to_country: "IL",
      tracking_id: config.trackingId,
      ...(f.min_price_ils !== undefined
        ? { min_sale_price: Math.round(f.min_price_ils * 100) }
        : {}),
      ...(f.max_price_ils !== undefined
        ? { max_sale_price: Math.round(f.max_price_ils * 100) }
        : {}),
    };
    const run = async (method: string, params: Record<string, ParamValue>) => {
      if (!first) await sleep(1_500);
      first = false;
      try {
        const res = await client.call(method, params);
        return parseProductPage(res.result).products;
      } catch (err) {
        console.log(`  ${method} failed: ${String(err).slice(0, 160)}`);
        return [] as AliProduct[];
      }
    };
    const a = await run("aliexpress.affiliate.product.query", {
      ...base,
      sort: "LAST_VOLUME_DESC",
    });
    const b = await run("aliexpress.affiliate.product.query", base);
    const c = await run("aliexpress.affiliate.hotproduct.query", {
      ...base,
      sort: "LAST_VOLUME_DESC",
    });
    const pass = (ps: AliProduct[]) => ps.filter((p) => passesFilters(p, f));
    const passA = new Set(pass(a).map((p) => p.productId));
    const newOf = (ps: AliProduct[]) => pass(ps).filter((p) => !passA.has(p.productId));
    const nb = newOf(b);
    const nc = newOf(c);
    totals.A += passA.size;
    totals.B += pass(b).length;
    totals.C += pass(c).length;
    totals.newB += nb.length;
    totals.newC += nc.length;
    console.log(
      `${id} "${keywords}": A ${a.length}/${passA.size} pass | B (relevance) ${b.length}/${pass(b).length} pass, +${nb.length} new | C (hot) ${c.length}/${pass(c).length} pass, +${nc.length} new`,
    );
    for (const p of [...nb.slice(0, 2), ...nc.slice(0, 2)]) {
      console.log(`    new: ${p.title.slice(0, 80)} (${p.positiveFeedbackPct}%, ${p.unitsSold})`);
    }
  }
  console.log(
    `\nTOTAL passers: A ${totals.A} | B ${totals.B} (+${totals.newB} new) | C ${totals.C} (+${totals.newC} new)`,
  );
}

void main();
