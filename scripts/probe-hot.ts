// One-off probe for the hot-products feature (2026-09-28). Answers: is
// aliexpress.affiliate.hotproduct.query open now that the Advanced API group is active; which
// fields it returns next to product.query's; whether its HE titles are usable; how many hot
// products pass FILTERS; whether a category filter and EN titles behave; and whether
// link.generate's hot link type (promotion_link_type=2, "hot product commission" per doc 921)
// works for hot and non-hot products. At most 6 AliExpress calls, spaced >= 1.6 s apart; one retry
// after an ApiCallLimit ban, counted in the 6. Links are never followed. Never prints or saves a
// secret from .env.local; masked fixtures go to fixtures/aliexpress/probe-hot/.
// Usage: npx tsx --env-file=.env.local scripts/probe-hot.ts [--max=N]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AliExpressClient, parseJsonKeepingIds, type ParamValue } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import { parsePromoCode } from "@/lib/aliexpress/promo-code";
import { parsePercent, parseProductPage } from "@/lib/aliexpress/schemas";
import { unwrapList } from "@/lib/aliexpress/unwrap";
import { aliexpressConfig } from "@/lib/env";
import {
  findEnvValues,
  maskEnvValues,
  maskEnvValuesDeep,
  parseEnvFile,
  secretEnv,
} from "@/lib/mask";
import { FILTERS } from "@/lib/ranking/config";
import { trustTierOf } from "@/lib/ranking/rank";

type Row = Record<string, unknown>;

const maxArg = Number(
  /^--max=(\d+)$/.exec(process.argv.find((a) => a.startsWith("--max=")) ?? "")?.[1],
);
const MAX_CALLS = Number.isInteger(maxArg) && maxArg > 0 ? Math.min(maxArg, 6) : 6;
const SPACING_MS = 1_600;
const BAN_WAIT_MS = 2_500;
const OUT_DIR = "fixtures/aliexpress/probe-hot";
const HOT = "aliexpress.affiliate.hotproduct.query";
const LINK = "aliexpress.affiliate.link.generate";
const CATEGORY_ID = "44"; // Consumer Electronics (fixtures/aliexpress/aliexpress.affiliate.category.get.json)

const config = aliexpressConfig();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- masking
const SECRETS = secretEnv(
  parseEnvFile(readFileSync(".env.local", "utf8")),
  parseEnvFile(existsSync(".env.example") ? readFileSync(".env.example", "utf8") : ""),
);
const maskText = (text: string) => maskEnvValues(text, SECRETS);

function saveFixture(name: string, raw: unknown) {
  const text = `${JSON.stringify(maskEnvValuesDeep(raw, SECRETS), null, 2)}\n`;
  const { leaks, coincidental } = findEnvValues(text, SECRETS);
  if (leaks.length) {
    console.log(`       NOT SAVED ${name}: still contains ${leaks.join(", ")}`);
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/${name}.json`, text);
  const note = coincidental.length
    ? ` (digits of ${coincidental.join(", ")} occur only inside longer ids)`
    : "";
  console.log(`       saved ${OUT_DIR}/${name}.json${note}`);
}

const show = (v: unknown, max = 110) => {
  const s = maskText(typeof v === "string" ? v : JSON.stringify(v));
  return s.length > max ? `${s.slice(0, max)}…(${s.length} chars)` : s;
};

function isRecord(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------- counted client
let calls = 0;
let lastRequestAt = 0;
let lastBody: string | undefined;

const countingFetch: typeof fetch = async (input, init) => {
  calls++;
  lastBody = undefined;
  const res = await fetch(input, init);
  lastBody = await res.clone().text();
  return res;
};
const client = new AliExpressClient(config, {
  fetch: countingFetch,
  retries: 0,
  timeoutMs: 15_000,
});

interface Probe {
  ok: boolean;
  raw: unknown;
  result: unknown;
}

async function probe(
  label: string,
  method: string,
  params: Record<string, ParamValue>,
): Promise<Probe | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (calls >= MAX_CALLS) {
      console.log(`SKIP  ${label}: call budget used`);
      return undefined;
    }
    const wait = lastRequestAt + (attempt ? BAN_WAIT_MS : SPACING_MS) - Date.now();
    if (wait > 0) await sleep(wait);
    let result: unknown;
    let error: AliExpressError | Error | undefined;
    try {
      result = (await client.call(method, params)).result;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    } finally {
      lastRequestAt = Date.now();
    }
    let raw: unknown;
    try {
      raw = lastBody ? parseJsonKeepingIds(lastBody) : undefined;
    } catch {
      raw = lastBody ? { unparsed_body_prefix: lastBody.slice(0, 300) } : undefined;
    }
    if (!error) {
      console.log(`OK    ${label} (call ${calls})`);
      return { ok: true, raw, result };
    }
    const kind = error instanceof AliExpressError ? error.kind : "unknown";
    const code = error instanceof AliExpressError ? error.details.code : undefined;
    console.log(
      `ERROR ${label} (call ${calls}): [${kind}] ${show(error.message, 300)}${code ? ` (code ${code})` : ""}`,
    );
    const key = `${method.replaceAll(".", "_")}_response`;
    const inner = isRecord(raw) && isRecord(raw[key]) ? raw[key] : raw;
    if (isRecord(inner) && isRecord(inner.resp_result)) {
      console.log(
        `       resp_code ${show(inner.resp_result.resp_code)} resp_msg ${show(inner.resp_result.resp_msg, 200)}`,
      );
    }
    if (isRecord(raw) && isRecord(raw.error_response)) {
      const e = raw.error_response;
      console.log(
        `       gateway code=${show(e.code)} sub_code=${show(e.sub_code ?? "-")} request_id=${show(e.request_id ?? "-")}`,
      );
    }
    if (kind !== "rate_limit") return { ok: false, raw, result: undefined };
    console.log(`       ApiCallLimit: retrying once after ${BAN_WAIT_MS} ms`);
  }
  return undefined;
}

// ---------------------------------------------------------------- analysis
function rowsOf(result: unknown): Row[] {
  return unwrapList(isRecord(result) ? result.products : undefined, "product") as Row[];
}

const nonEmpty = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
const hasHebrew = (s: string) => /[א-ת]/.test(s);
const hasLatinWord = (s: string) => /[A-Za-z]{3,}/.test(s);

function stats(nums: number[]): string {
  if (!nums.length) return "none";
  const s = [...nums].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  return `min ${s[0]} / median ${median} / max ${s[s.length - 1]} (n=${s.length})`;
}

function fixtureRows(): Row[] {
  try {
    const raw = parseJsonKeepingIds(
      readFileSync("fixtures/aliexpress/aliexpress.affiliate.product.query.json", "utf8"),
    ) as Row;
    const inner = raw.aliexpress_affiliate_product_query_response as Row;
    return rowsOf((inner.resp_result as Row).result);
  } catch {
    return [];
  }
}

function fieldUnion(rows: Row[]): Set<string> {
  return new Set(rows.flatMap((r) => Object.keys(r)));
}

function linkForm(link: unknown): string {
  if (typeof link !== "string" || !link) return "(none)";
  try {
    const u = new URL(link);
    return `${u.host}/${u.pathname.split("/")[1] ?? ""}/`;
  } catch {
    return "(not a URL)";
  }
}

function commonPrefix(values: string[]): number {
  if (values.length < 2) return values[0]?.length ?? 0;
  let n = 0;
  for (;;) {
    const c = values[0][n];
    if (c === undefined || values.some((v) => v[n] !== c)) return n;
    n++;
  }
}

function countBy<T>(items: T[], key: (t: T) => string): string {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
    .join(" | ");
}

function analyze(label: string, result: unknown, queryFields: Set<string>) {
  const r = isRecord(result) ? result : {};
  const rows = rowsOf(result);
  console.log(`\n== ${label}`);
  console.log(
    `   result keys: ${Object.keys(r).join(", ")} | current_page_no ${show(r.current_page_no ?? "-")} current_record_count ${show(r.current_record_count ?? "-")} total_record_count ${show(r.total_record_count ?? "-")} total_page_no ${show(r.total_page_no ?? "-")}`,
  );
  console.log(`   products: ${rows.length}`);
  if (!rows.length) return { rows, parsed: [] as ReturnType<typeof parseProductPage>["products"] };

  const fields = fieldUnion(rows);
  const extra = [...fields].filter((f) => !queryFields.has(f));
  const missing = [...queryFields].filter((f) => !fields.has(f));
  console.log(`   fields (${fields.size}): ${[...fields].sort().join(", ")}`);
  console.log(`   not in product.query fixture: ${extra.join(", ") || "none"}`);
  console.log(`   in product.query fixture but absent here: ${missing.join(", ") || "none"}`);

  const page = parseProductPage(result);
  console.log(`   our productSchema: ${page.products.length} parsed, ${page.skipped} skipped`);

  const count = (pred: (p: Row) => boolean) => rows.filter(pred).length;
  console.log(
    `   present: evaluate_rate ${count((p) => nonEmpty(p.evaluate_rate))} | lastest_volume ${count((p) => typeof p.lastest_volume === "number")} | promotion_link ${count((p) => nonEmpty(p.promotion_link))} | product_video_url ${count((p) => nonEmpty(p.product_video_url))} | promo_code_info ${count((p) => p.promo_code_info !== undefined)} (usable ${count((p) => parsePromoCode(p.promo_code_info) !== null)}) | ship_to_days ${count((p) => nonEmpty(p.ship_to_days))} | discount ${count((p) => nonEmpty(p.discount))} | target_original_price ${count((p) => nonEmpty(p.target_original_price))}`,
  );
  console.log(`   currency: ${countBy(rows, (p) => String(p.target_sale_price_currency))}`);
  console.log(
    `   price (target_sale_price): ${stats(rows.map((p) => Number(p.target_sale_price)).filter(Number.isFinite))}`,
  );
  console.log(`   link form: ${countBy(rows, (p) => linkForm(p.promotion_link))}`);

  const cr = rows
    .map((p) => parsePercent(p.commission_rate))
    .filter((n): n is number => n !== null);
  const hr = rows
    .map((p) => parsePercent(p.hot_product_commission_rate))
    .filter((n): n is number => n !== null);
  console.log(`   commission_rate %: ${stats(cr)}`);
  console.log(`   hot_product_commission_rate %: ${stats(hr)}`);
  console.log(
    `   hot > commission: ${count((p) => (parsePercent(p.hot_product_commission_rate) ?? 0) > (parsePercent(p.commission_rate) ?? 0))} | hot == 0: ${count((p) => parsePercent(p.hot_product_commission_rate) === 0)} | hot missing: ${count((p) => !nonEmpty(p.hot_product_commission_rate))}`,
  );
  console.log(
    `   hot/commission pairs (first 8): ${rows
      .slice(0, 8)
      .map((p) => `${show(p.hot_product_commission_rate)}/${show(p.commission_rate)}`)
      .join(", ")}`,
  );

  const tiers = page.products.map((p) => trustTierOf(p));
  const reasons = page.products.map((p) =>
    p.positiveFeedbackPct === null
      ? "feedback missing"
      : p.positiveFeedbackPct < FILTERS.minPositiveFeedbackPct
        ? "feedback < 90"
        : p.unitsSold === null
          ? "volume missing"
          : p.unitsSold < FILTERS.minUnitsSold
            ? "volume < 100"
            : "pass",
  );
  console.log(
    `   FILTERS (>= ${FILTERS.minPositiveFeedbackPct}%, >= ${FILTERS.minUnitsSold} in 30 days): pass ${tiers.filter((t) => t === "standard").length} of ${page.products.length} | ${countBy(reasons, (r) => r)} | fill tier only ${tiers.filter((t) => t === "fill").length}`,
  );
  console.log(
    `   evaluate_rate: ${stats(page.products.map((p) => p.positiveFeedbackPct).filter((n): n is number => n !== null))}`,
  );
  console.log(
    `   lastest_volume: ${stats(page.products.map((p) => p.unitsSold).filter((n): n is number => n !== null))}`,
  );
  const vols = rows.map((p) => (typeof p.lastest_volume === "number" ? p.lastest_volume : -1));
  let inversions = 0;
  for (let i = 1; i < vols.length; i++) if (vols[i] > vols[i - 1]) inversions++;
  console.log(`   LAST_VOLUME_DESC order: ${inversions} adjacent inversions of ${vols.length - 1}`);
  console.log(
    `   first-level categories: ${countBy(rows, (p) => `${show(p.first_level_category_id)} ${show(p.first_level_category_name, 40)}`)}`,
  );
  console.log(
    `   second-level (top 8): ${countBy(rows, (p) => show(p.second_level_category_name, 40))
      .split(" | ")
      .slice(0, 8)
      .join(" | ")}`,
  );

  const titles = rows.map((p) => String(p.product_title ?? ""));
  console.log(
    `   titles: Hebrew letters in ${titles.filter(hasHebrew).length}, Latin words (3+ letters) in ${titles.filter(hasLatinWord).length}, length ${stats(titles.map((t) => t.length))}`,
  );
  for (const p of rows.slice(0, 3)) {
    console.log(`     - ${show(p.product_id)}: ${show(p.product_title, 200)}`);
  }
  return { rows, parsed: page.products };
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(
    `tracking_id from config: set (${config.trackingId.length} chars, masked); max ${MAX_CALLS} calls\n`,
  );
  await sleep(2_000); // let a frequency ban from another caller of this app key expire
  const queryRows = fixtureRows();
  const queryFields = fieldUnion(queryRows);
  const base = {
    page_no: 1,
    page_size: 50,
    sort: "LAST_VOLUME_DESC",
    target_currency: "ILS",
    ship_to_country: "IL",
    tracking_id: config.trackingId,
  };

  // 1. No category, HE.
  const all = await probe("1 hotproduct.query no category ILS/HE/IL 50", HOT, {
    ...base,
    target_language: "HE",
  });
  if (!all?.ok) {
    if (all?.raw) saveFixture("aliexpress.affiliate.hotproduct.query.error", all.raw);
    printTotals();
    return;
  }
  saveFixture("aliexpress.affiliate.hotproduct.query.all-HE", all.raw);
  const a = analyze("1 no category, HE", all.result, queryFields);

  // 2. + 3. One first-level category, HE then EN (same list, so titles can be paired).
  const he = await probe(`2 hotproduct.query category ${CATEGORY_ID} ILS/HE/IL 50`, HOT, {
    ...base,
    category_ids: CATEGORY_ID,
    target_language: "HE",
  });
  let heRows: Row[] = [];
  if (he?.ok) {
    saveFixture(`aliexpress.affiliate.hotproduct.query.cat${CATEGORY_ID}-HE`, he.raw);
    heRows = analyze(`2 category ${CATEGORY_ID}, HE`, he.result, queryFields).rows;
  }
  const en = await probe(`3 hotproduct.query category ${CATEGORY_ID} ILS/EN/IL 50`, HOT, {
    ...base,
    category_ids: CATEGORY_ID,
    target_language: "EN",
  });
  let enRows: Row[] = [];
  if (en?.ok) {
    saveFixture(`aliexpress.affiliate.hotproduct.query.cat${CATEGORY_ID}-EN`, en.raw);
    enRows = analyze(`3 category ${CATEGORY_ID}, EN`, en.result, queryFields).rows;
  }
  if (heRows.length && enRows.length) {
    const enById = new Map(enRows.map((p) => [String(p.product_id), p]));
    const shared = heRows.filter((p) => enById.has(String(p.product_id)));
    const samePos = heRows.filter((p, i) => String(enRows[i]?.product_id) === String(p.product_id));
    const samePrice = shared.filter(
      (p) =>
        String(p.target_sale_price) === String(enById.get(String(p.product_id))?.target_sale_price),
    );
    console.log(
      `\n== HE vs EN (category ${CATEGORY_ID}): ${shared.length} shared ids, ${samePos.length} at the same position, ${samePrice.length} same price`,
    );
    for (const p of shared.slice(0, 5)) {
      const e = enById.get(String(p.product_id)) as Row;
      console.log(`   ${show(p.product_id)}`);
      console.log(`     HE: ${show(p.product_title, 220)}`);
      console.log(`     EN: ${show(e.product_title, 220)}`);
    }
  }
  const allIds = new Set(a.rows.map((p) => String(p.product_id)));
  const catIds = new Set(heRows.map((p) => String(p.product_id)));
  console.log(
    `\n== overlap: no-category list vs category ${CATEGORY_ID}: ${[...catIds].filter((id) => allIds.has(id)).length} shared ids`,
  );

  // Long /s/ links: an encrypted blob whose shared prefix is the same for every link of one
  // request type. Compare hot-query links with product.query links (fixture of 2026-09-26).
  const qLinks = queryRows.map((p) => String(p.promotion_link ?? "")).filter(Boolean);
  const hLinks = [...a.rows, ...heRows, ...enRows]
    .map((p) => String(p.promotion_link ?? ""))
    .filter(Boolean);
  if (qLinks.length && hLinks.length) {
    console.log(
      `\n== /s/ link prefixes: product.query links share ${commonPrefix(qLinks)} chars; hot links share ${commonPrefix(hLinks)}; across both ${commonPrefix([...qLinks, ...hLinks])} (lengths: query ${stats(qLinks.map((l) => l.length))}, hot ${stats(hLinks.map((l) => l.length))})`,
    );
  }

  // 4. link.generate with the hot link type for two hot products and one non-hot product.
  const pool = [...a.parsed];
  const byHot = [...a.rows]
    .filter((p) => (parsePercent(p.hot_product_commission_rate) ?? 0) > 0)
    .sort(
      (x, y) =>
        (parsePercent(y.hot_product_commission_rate) ?? 0) -
        (parsePercent(x.hot_product_commission_rate) ?? 0),
    );
  const hotPicks = byHot.slice(0, 2);
  const nonHot =
    a.rows.find((p) => parsePercent(p.hot_product_commission_rate) === 0) ??
    queryRows.find((p) => parsePercent(p.hot_product_commission_rate) === 0);
  const picks = [...hotPicks, ...(nonHot ? [nonHot] : [])];
  if (!picks.length || !pool.length) {
    console.log("SKIP  link.generate: no products to link");
    printTotals();
    return;
  }
  const src = (p: Row) => `https://www.aliexpress.com/item/${String(p.product_id)}.html`;
  console.log(
    `\n   link picks: ${picks.map((p) => `${show(p.product_id)} hot ${show(p.hot_product_commission_rate)} / normal ${show(p.commission_rate)}`).join(" ; ")}`,
  );
  const l2 = await probe(`4 link.generate type 2 (${picks.length} products)`, LINK, {
    promotion_link_type: 2,
    source_values: picks.map(src).join(","),
    tracking_id: config.trackingId,
  });
  const hotLinkOf = new Map<string, string>();
  if (l2?.ok) {
    const r = isRecord(l2.result) ? l2.result : {};
    console.log(
      `       total_result_count ${show(r.total_result_count ?? "-")} | echoed tracking_id equals ours: ${r.tracking_id === config.trackingId ? "yes" : "no"}`,
    );
    for (const l of unwrapList(r.promotion_links, "promotion_link") as Row[]) {
      const id = /item\/(\d+)\.html/.exec(String(l.source_value ?? ""))?.[1] ?? "?";
      const link = typeof l.promotion_link === "string" ? l.promotion_link : "";
      if (link) hotLinkOf.set(id, link);
      const fromQuery = a.rows.find((p) => String(p.product_id) === id)?.promotion_link;
      console.log(
        `       ${id}: ${link ? `${linkForm(link)} (${link.length} chars)` : "no link"} | message ${show(l.message ?? "-")} | same as hotproduct.query link: ${link && link === fromQuery ? "yes" : "no"}`,
      );
    }
    saveFixture("aliexpress.affiliate.link.generate.type2", l2.raw);
  } else if (l2?.raw) {
    saveFixture("aliexpress.affiliate.link.generate.type2.error", l2.raw);
  }

  // 5. The same first hot product with the normal link type, to compare with its type-2 link.
  const first = hotPicks[0] ?? picks[0];
  const l0 = await probe("5 link.generate type 0 (first pick)", LINK, {
    promotion_link_type: 0,
    source_values: src(first),
    tracking_id: config.trackingId,
  });
  if (l0?.ok) {
    const l = (unwrapList(
      isRecord(l0.result) ? l0.result.promotion_links : undefined,
      "promotion_link",
    )[0] ?? {}) as Row;
    const link = typeof l.promotion_link === "string" ? l.promotion_link : "";
    const hot = hotLinkOf.get(String(first.product_id));
    console.log(
      `       ${show(first.product_id)}: ${link ? `${linkForm(link)} (${link.length} chars)` : "no link"} | message ${show(l.message ?? "-")} | same as its type-2 link: ${link && hot ? (link === hot ? "yes" : "no") : "n/a"}`,
    );
    saveFixture("aliexpress.affiliate.link.generate.type0", l0.raw);
  }

  // 6. Page 2 of the category list: is a second page worth fetching? (Only if budget remains.)
  const p2 = await probe(`6 hotproduct.query category ${CATEGORY_ID} ILS/HE/IL page 2`, HOT, {
    ...base,
    page_no: 2,
    category_ids: CATEGORY_ID,
    target_language: "HE",
  });
  if (p2?.ok) {
    saveFixture(`aliexpress.affiliate.hotproduct.query.cat${CATEGORY_ID}-HE.page2`, p2.raw);
    const rows2 = analyze(`6 category ${CATEGORY_ID}, HE, page 2`, p2.result, queryFields).rows;
    const dup = rows2.filter((p) => catIds.has(String(p.product_id))).length;
    console.log(`   ids already on page 1: ${dup}`);
  }
  printTotals();
}

function printTotals() {
  console.log(`\nTOTAL AliExpress calls: ${calls} (limit ${MAX_CALLS})`);
}

main().catch((err) => {
  console.error(maskText(err instanceof Error ? `${err.name}: ${err.message}` : String(err)));
  console.log(`calls made before the failure: ${calls}`);
  process.exit(1);
});
