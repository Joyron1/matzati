// One-off probes for product-page extras, coupons, sales and attribution (2026-09-28).
// Answers: which affiliate methods give a long description, video, specs, SKUs, coupons and sale
// dates; whether dropshipping/order methods are open to this app; and whether our links carry our
// tracking id. At most 15 AliExpress requests (API calls + redirect hops), spaced >= 1.6 s apart,
// no retries. Never prints or saves a value from .env.local; masked fixtures go to
// fixtures/aliexpress/probe-extras/. No review scraping: reviews are not in the affiliate API.
// Usage: npx tsx --env-file=.env.local scripts/probe-product-extras.ts
//        ... scripts/probe-product-extras.ts --detail-only --max=1   (only the productdetail
//        fields= probe; used after the first run lost both productdetail calls to ApiCallLimit)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AliExpressClient, parseJsonKeepingIds, type ParamValue } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import { unwrapList } from "@/lib/aliexpress/unwrap";
import { aliexpressConfig } from "@/lib/env";

type Row = Record<string, unknown>;

const maxArg = Number(
  /^--max=(\d+)$/.exec(process.argv.find((a) => a.startsWith("--max=")) ?? "")?.[1],
);
const MAX_REQUESTS = Number.isInteger(maxArg) && maxArg > 0 ? Math.min(maxArg, 15) : 15;
const DETAIL_ONLY = process.argv.includes("--detail-only");
const SPACING_MS = 1_600;
const OUT_DIR = "fixtures/aliexpress/probe-extras";
const FIXTURE_ID = "1005006338829917"; // fixtures/aliexpress/aliexpress.affiliate.productdetail.get.json
const FAKE_TRACKING_ID = "matzati_fake_test";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";

const config = aliexpressConfig();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- masking
// Every value in .env.local, not only the AliExpress ones.
function envValues(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (value.length >= 3) out.push([m[1], value]);
  }
  return out;
}
const SECRETS = envValues();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Long values are masked wherever they appear. Short ones (e.g. a 4-digit cap) are masked only as
// a standalone token, so they don't corrupt unrelated ids that happen to contain the same digits.
const MASKERS = SECRETS.map(([key, value]) => ({
  key,
  value,
  re:
    value.length >= 8
      ? new RegExp(escapeRe(value), "g")
      : new RegExp(`(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])`, "g"),
}));

function maskText(text: string): string {
  let out = text;
  for (const m of MASKERS) out = out.replace(m.re, `<masked:${m.key}>`);
  return out;
}

function maskTree(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (typeof value === "number" || typeof value === "boolean") {
    const masked = maskText(String(value));
    return masked === String(value) ? value : masked;
  }
  if (Array.isArray(value)) return value.map(maskTree);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskTree(v)]));
  }
  return value;
}

/** Remaining .env.local hits after masking: standalone hits are leaks; others are coincidental. */
function leakReport(text: string): { leaks: string[]; coincidental: string[] } {
  const leaks: string[] = [];
  const coincidental: string[] = [];
  for (const m of MASKERS) {
    if (!text.includes(m.value)) continue;
    m.re.lastIndex = 0;
    if (m.re.test(text)) leaks.push(m.key);
    else coincidental.push(m.key);
    m.re.lastIndex = 0;
  }
  return { leaks, coincidental };
}

function saveFixture(name: string, raw: unknown) {
  const text = `${JSON.stringify(maskTree(raw), null, 2)}\n`;
  const { leaks, coincidental } = leakReport(text);
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

const show = (v: unknown, max = 90) => {
  const s = maskText(typeof v === "string" ? v : JSON.stringify(v));
  return s.length > max ? `${s.slice(0, max)}…(${s.length} chars)` : s;
};

// ---------------------------------------------------------------- field summaries
function isRecord(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** path -> first non-empty sample, merged over every array element. */
function flatten(value: unknown, path = "", out = new Map<string, unknown>(), depth = 0) {
  if (depth > 10) return out;
  const setSample = (v: unknown) => {
    const cur = out.get(path);
    if (!out.has(path) || cur === "" || cur === null || cur === "(empty array)") out.set(path, v);
  };
  if (Array.isArray(value)) {
    if (!value.length) setSample("(empty array)");
    for (const item of value.slice(0, 50)) flatten(item, `${path}[]`, out, depth + 1);
    return out;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (!entries.length) setSample("{}");
    for (const [k, v] of entries) flatten(v, path ? `${path}.${k}` : k, out, depth + 1);
    return out;
  }
  setSample(value);
  return out;
}

function printFields(value: unknown, prefixToStrip = "", maxLines = 70) {
  const rows = [...flatten(value)];
  for (const [path, sample] of rows.slice(0, maxLines)) {
    const p = path.startsWith(prefixToStrip) ? path.slice(prefixToStrip.length) : path;
    console.log(`         ${p} = ${show(sample)}`);
  }
  if (rows.length > maxLines) console.log(`         … ${rows.length - maxLines} more paths`);
}

// ---------------------------------------------------------------- counted client
let requests = 0;
let apiCalls = 0;
let redirectGets = 0;
let lastRequestAt = 0;
let lastBody: string | undefined;

const countingFetch: typeof fetch = async (input, init) => {
  apiCalls++;
  requests++;
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

async function spaced() {
  const wait = lastRequestAt + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
}

interface Probe {
  ok: boolean;
  raw: unknown; // full parsed body (ids kept exact)
  inner: unknown; // <method>_response, or the body
  result: unknown; // resp_result.result when present
  error?: string;
}

async function probe(
  label: string,
  method: string,
  params: Record<string, ParamValue>,
): Promise<Probe | undefined> {
  if (requests >= MAX_REQUESTS) {
    console.log(`SKIP  ${label}: request budget used`);
    return undefined;
  }
  await spaced();
  let result: unknown;
  let error: string | undefined;
  let ok = false;
  try {
    result = (await client.call(method, params)).result;
    ok = true;
  } catch (err) {
    // Non-standard envelopes (result/code/success instead of resp_result) land here as
    // bad_response; the raw body below tells us what came back.
    error =
      err instanceof AliExpressError
        ? `[${err.kind}] ${err.message}${err.details.code ? ` (code ${err.details.code})` : ""}`
        : String(err);
  } finally {
    lastRequestAt = Date.now();
  }

  let raw: unknown;
  try {
    raw = lastBody ? parseJsonKeepingIds(lastBody) : undefined;
  } catch {
    raw = lastBody ? { unparsed_body_prefix: lastBody.slice(0, 300) } : undefined;
  }
  const key = `${method.replaceAll(".", "_")}_response`;
  const inner = isRecord(raw) && isRecord(raw[key]) ? raw[key] : raw;
  const gatewayError = isRecord(raw) && isRecord(raw.error_response) ? raw.error_response : null;

  if (gatewayError) {
    const e = gatewayError;
    console.log(
      `ERROR ${label}: gateway type=${e.type ?? "-"} code=${e.code ?? "-"} sub_code=${e.sub_code ?? "-"} msg=${show(e.msg ?? e.message ?? "-", 160)} sub_msg=${show(e.sub_msg ?? "-", 160)}`,
    );
    return { ok: false, raw, inner, result: undefined, error };
  }
  if (!ok && isRecord(inner) && !("resp_result" in inner)) {
    // Envelope without resp_result: report it as a response, not a failure.
    const code = inner.code ?? (isRecord(inner.result) ? inner.result.code : undefined);
    const success = inner.success ?? (isRecord(inner.result) ? inner.result.success : undefined);
    console.log(
      `RESP  ${label}: non-resp_result envelope, code=${show(code ?? "-")} success=${show(success ?? "-")} msg=${show(inner.msg ?? inner.message ?? "-", 160)}`,
    );
    return { ok: true, raw, inner, result: inner.result, error };
  }
  if (!ok) {
    console.log(`ERROR ${label}: ${show(error, 300)}`);
    return { ok: false, raw, inner, result: undefined, error };
  }
  console.log(`OK    ${label}`);
  return { ok: true, raw, inner, result };
}

// ---------------------------------------------------------------- helpers
function products(result: unknown): Row[] {
  return unwrapList(isRecord(result) ? result.products : undefined, "product") as Row[];
}

function pstStamp(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function fixtureIds(): string[] {
  try {
    const raw = parseJsonKeepingIds(
      readFileSync("fixtures/aliexpress/aliexpress.affiliate.product.query.json", "utf8"),
    ) as Row;
    const inner = raw.aliexpress_affiliate_product_query_response as Row;
    const result = (inner.resp_result as Row).result;
    return products(result).map((p) => String(p.product_id));
  } catch {
    return [];
  }
}

function linksOf(result: unknown): Row[] {
  return unwrapList(
    isRecord(result) ? result.promotion_links : undefined,
    "promotion_link",
  ) as Row[];
}

// ---------------------------------------------------------------- redirect chain
interface Hop {
  status: number;
  host: string;
  path_shape: string;
  query_param_names: string[];
  any_param_value_equals_tracking_id: boolean;
  url_contains_tracking_id: boolean;
  aff_platform?: string;
  set_cookie_names: string[];
  content_type: string | null;
}

async function followChain(start: string, maxHops: number) {
  const tid = config.trackingId;
  const hops: Hop[] = [];
  let current = start;
  let stopReason = "hop limit";
  let jsTarget: {
    host: string;
    query_param_names: string[];
    contains_tracking_id: boolean;
  } | null = null;
  for (let i = 0; i < maxHops; i++) {
    if (requests >= MAX_REQUESTS) {
      stopReason = "request budget";
      break;
    }
    if (i > 0) await sleep(1_000);
    requests++;
    redirectGets++;
    const url = new URL(current);
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(15_000),
    });
    const values = [...url.searchParams.values()];
    let decoded = current;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      /* keep raw */
    }
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    hops.push({
      status: res.status,
      host: url.host,
      // Path segments longer than 12 chars (link codes, tokens) shown only by length.
      path_shape: url.pathname.replace(/[^/]{13,}/g, (s) => `<${s.length} chars>`),
      query_param_names: [...new Set(url.searchParams.keys())],
      any_param_value_equals_tracking_id: values.some((v) => v === tid),
      url_contains_tracking_id: current.includes(tid) || decoded.includes(tid),
      aff_platform: url.searchParams.get("aff_platform") ?? undefined,
      set_cookie_names: (headers.getSetCookie?.() ?? []).map((c) => c.split("=")[0].trim()),
      content_type: res.headers.get("content-type"),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    // 200 on an intermediate click host: look for a script/meta redirect target without
    // requesting it. A product page body is not read.
    const clickHost = /^(s\.click|star)\./.test(url.host);
    const body = res.status === 200 && clickHost ? await res.text() : "";
    if (!body) await res.body?.cancel().catch(() => undefined);
    const m =
      /(?:location(?:\.href)?\s*=\s*|location\.replace\(\s*|content=["']\d+;\s*url=)["']?(https?:\/\/[^"'\s)<>]+)/i.exec(
        body,
      );
    if (m) {
      const target = new URL(m[1].replaceAll("&amp;", "&"));
      jsTarget = {
        host: target.host,
        query_param_names: [...new Set(target.searchParams.keys())],
        contains_tracking_id: m[1].includes(tid),
      };
    }
    stopReason = `status ${res.status}${m ? " with script/meta redirect (not followed)" : ""}`;
    break;
  }
  return { hops, stopReason, jsTarget };
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(`tracking_id from config: set (${config.trackingId.length} chars, masked)\n`);
  const queryIds = fixtureIds();
  const videoId = "1005006861238003"; // product.query fixture row with product_video_url
  const common = { target_currency: "ILS", target_language: "HE" };

  if (DETAIL_ONLY) {
    await sleep(3_000); // let any frequency ban from other callers of this app key expire
    await detailWithFields(videoId);
    printTotals();
    return;
  }

  // 1. productdetail.get, default fields, for the fixture product and one known to have a video.
  const d1 = await probe(
    "1 productdetail.get ILS/HE/IL (2 ids)",
    "aliexpress.affiliate.productdetail.get",
    {
      product_ids: `${FIXTURE_ID},${videoId}`,
      ...common,
      country: "IL",
      tracking_id: config.trackingId,
    },
  );
  if (d1?.ok) {
    const rows = products(d1.result);
    console.log(`       ${rows.length} products; field union:`);
    printFields(rows);
    for (const p of rows) {
      console.log(
        `       ${p.product_id}: video=${p.product_video_url ? show(p.product_video_url, 70) : "(empty)"} promo_code_info=${p.promo_code_info ? "yes" : "no"} promotion_link=${p.promotion_link ? "yes" : "no"}`,
      );
    }
    saveFixture("aliexpress.affiliate.productdetail.get", d1.raw);
  }

  // 1b. fields param: are unknown names (description/specs/sku) rejected, ignored, or served?
  await detailWithFields(videoId);

  // 2. product.sku.detail.get (documented 2025-03, no session needed per docs).
  const s = await probe(
    "3 product.sku.detail.get IL/ILS/HE",
    "aliexpress.affiliate.product.sku.detail.get",
    { product_id: FIXTURE_ID, ship_to_country: "IL", ...common, need_deliver_info: "Yes" },
  );
  if (s?.raw) {
    printFields(s.inner, "", 80);
    if (s.ok) saveFixture("aliexpress.affiliate.product.sku.detail.get", s.raw);
  }

  // 3. ds.product.get without access_token.
  const ds = await probe("4 ds.product.get (no access_token)", "aliexpress.ds.product.get", {
    product_id: FIXTURE_ID,
    ship_to_country: "IL",
    target_currency: "ILS",
    target_language: "he",
  });
  if (ds?.raw) {
    if (ds.ok) printFields(ds.inner, "", 40);
    saveFixture("aliexpress.ds.product.get.no-session", ds.raw);
  }

  // 4. featuredpromo.get + featuredpromo.products.get.
  const fp = await probe("5 featuredpromo.get", "aliexpress.affiliate.featuredpromo.get", {});
  let promoName: string | undefined;
  if (fp?.ok) {
    const promos = unwrapList(isRecord(fp.result) ? fp.result.promos : undefined, "promo") as Row[];
    console.log(`       ${promos.length} promos; field union:`);
    printFields(promos);
    for (const p of promos) {
      console.log(
        `       - ${show(p.promo_name, 50)} | products ${show(p.product_num)} | ${show(p.promo_desc, 60)}`,
      );
    }
    promoName =
      String((promos.find((p) => Number(p.product_num) > 0) ?? promos[0])?.promo_name ?? "") ||
      undefined;
    saveFixture("aliexpress.affiliate.featuredpromo.get", fp.raw);
  }
  if (promoName) {
    const fpp = await probe(
      `6 featuredpromo.products.get "${promoName}"`,
      "aliexpress.affiliate.featuredpromo.products.get",
      {
        promotion_name: promoName,
        page_no: 1,
        page_size: 5,
        sort: "promotionTimeAsc",
        ...common,
        country: "IL",
        tracking_id: config.trackingId,
      },
    );
    if (fpp?.ok) {
      const rows = products(fpp.result);
      const r = isRecord(fpp.result) ? fpp.result : {};
      console.log(
        `       ${rows.length} products (total_record_count ${show(r.total_record_count)}, is_finished ${show(r.is_finished)}); field union:`,
      );
      printFields(rows);
      const timeFields = [...flatten(rows).keys()].filter((k) => /time|date|start|end/i.test(k));
      console.log(`       time/date fields on products: ${timeFields.join(", ") || "none"}`);
      saveFixture("aliexpress.affiliate.featuredpromo.products.get", fpp.raw);
    }
  } else {
    console.log("SKIP  6 featuredpromo.products.get: no promo name");
  }

  // Coupons: promotion.info.get (documented ship_to_country list does not include IL).
  const promoIds = [...new Set([FIXTURE_ID, videoId, ...queryIds])].slice(0, 10).join(",");
  const pi = await probe(
    "7 promotion.info.get IL/ILS/HE (10 ids)",
    "aliexpress.affiliate.promotion.info.get",
    { product_id: promoIds, ship_to_country: "IL", currency: "ILS", target_language: "HE" },
  );
  if (pi?.raw) {
    printFields(pi.inner, "", 50);
    if (pi.ok) saveFixture("aliexpress.affiliate.promotion.info.get.IL", pi.raw);
  }

  // 5. order.list: permission only; counts, never order data. No fixture.
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
  const ol = await probe(
    "8 order.list last 7 days, Payment Completed",
    "aliexpress.affiliate.order.list",
    {
      start_time: pstStamp(start),
      end_time: pstStamp(end),
      status: "Payment Completed",
      page_no: 1,
      page_size: 50,
    },
  );
  if (ol?.ok) {
    const r = isRecord(ol.result) ? ol.result : {};
    const orders = unwrapList(r.orders, "order");
    console.log(
      `       window ${pstStamp(start)} .. ${pstStamp(end)} PT | total_record_count ${show(r.total_record_count ?? "-")} | current_record_count ${show(r.current_record_count ?? "-")} | orders on page ${orders.length}`,
    );
    console.log(`       result keys: ${Object.keys(r).join(", ")}`);
    if (orders.length && isRecord(orders[0])) {
      console.log(`       order field names: ${Object.keys(orders[0]).join(", ")}`);
    }
  } else if (ol && isRecord(ol.inner) && isRecord(ol.inner.resp_result)) {
    const rr = ol.inner.resp_result;
    console.log(`       resp_code ${show(rr.resp_code)} resp_msg ${show(rr.resp_msg, 120)}`);
  }

  // 6a. link.generate with our tracking id.
  const source = `https://www.aliexpress.com/item/${FIXTURE_ID}.html`;
  const ours = await probe(
    "9 link.generate (our tracking id)",
    "aliexpress.affiliate.link.generate",
    {
      promotion_link_type: 0,
      source_values: source,
      tracking_id: config.trackingId,
    },
  );
  let ourLink: string | undefined;
  if (ours?.ok) {
    const r = isRecord(ours.result) ? ours.result : {};
    const l = linksOf(ours.result)[0] ?? {};
    ourLink = typeof l.promotion_link === "string" ? l.promotion_link : undefined;
    console.log(
      `       link host ${ourLink ? new URL(ourLink).host : "-"} path ${ourLink ? new URL(ourLink).pathname.slice(0, 4) + "…" : "-"} | message ${show(l.message ?? "-")} | echoed tracking_id equals ours: ${r.tracking_id === config.trackingId ? "yes" : "no"}`,
    );
    saveFixture("aliexpress.affiliate.link.generate.ours", ours.raw);
  }

  // 6b. link.generate with a tracking id this account never created.
  const fake = await probe(
    `10 link.generate (made-up tracking id "${FAKE_TRACKING_ID}")`,
    "aliexpress.affiliate.link.generate",
    { promotion_link_type: 0, source_values: source, tracking_id: FAKE_TRACKING_ID },
  );
  if (fake?.raw) {
    if (fake.ok) {
      const r = isRecord(fake.result) ? fake.result : {};
      const l = linksOf(fake.result)[0] ?? {};
      console.log(
        `       promotion_link ${l.promotion_link ? `returned (host ${new URL(String(l.promotion_link)).host})` : "not returned"} | message ${show(l.message ?? "-")} | echoed tracking_id ${show(r.tracking_id ?? "-")} | same link as ours: ${l.promotion_link && l.promotion_link === ourLink ? "yes" : "no"}`,
      );
    } else if (isRecord(fake.inner) && isRecord(fake.inner.resp_result)) {
      const rr = fake.inner.resp_result;
      console.log(`       resp_code ${show(rr.resp_code)} resp_msg ${show(rr.resp_msg, 160)}`);
    }
    saveFixture("aliexpress.affiliate.link.generate.fake-tracking-id", fake.raw);
  }

  // 6c. Follow our promotion link: one GET per hop, no cookies, manual redirects, max 5 hops.
  if (ourLink) {
    const hopBudget = Math.min(5, MAX_REQUESTS - requests);
    console.log(`\nREDIRECT chain of our link.generate link (max ${hopBudget} hops, no cookies):`);
    const chain = await followChain(ourLink, hopBudget);
    chain.hops.forEach((h, i) => {
      console.log(
        `  hop ${i + 1}: ${h.status} ${h.host}${h.path_shape} | params: ${h.query_param_names.join(", ") || "(none)"} | value==tracking_id: ${h.any_param_value_equals_tracking_id ? "yes" : "no"} | url contains tracking_id: ${h.url_contains_tracking_id ? "yes" : "no"}${h.aff_platform ? ` | aff_platform=${maskText(h.aff_platform)}` : ""} | set-cookie names: ${h.set_cookie_names.join(", ") || "-"}`,
      );
    });
    if (chain.jsTarget) {
      console.log(
        `  script/meta target (not fetched): ${chain.jsTarget.host} | params: ${chain.jsTarget.query_param_names.join(", ")} | contains tracking_id: ${chain.jsTarget.contains_tracking_id ? "yes" : "no"}`,
      );
    }
    console.log(`  stopped: ${chain.stopReason}`);
    saveFixture("redirect-chain.summary", { probed_at: new Date().toISOString(), ...chain });
  }

  // Coupons fallback: IL answered but empty; does a documented country return coupons?
  // (A permission error for IL is app-wide, so it is not retried with another country.)
  const piEmpty =
    pi?.ok === true &&
    (!isRecord(pi.result) ||
      unwrapList(pi.result.promotion_results, "promotion_result").length === 0);
  if (piEmpty && requests < MAX_REQUESTS) {
    const pu = await probe(
      "11 promotion.info.get US/USD/EN (documented country, permission check)",
      "aliexpress.affiliate.promotion.info.get",
      { product_id: promoIds, ship_to_country: "US", currency: "USD", target_language: "EN" },
    );
    if (pu?.raw) {
      printFields(pu.inner, "", 50);
      if (pu.ok) saveFixture("aliexpress.affiliate.promotion.info.get.US", pu.raw);
    }
  }

  printTotals();
}

function printTotals() {
  console.log(
    `\nTOTAL requests to AliExpress: ${requests} (API calls ${apiCalls}, redirect GETs ${redirectGets}); limit ${MAX_REQUESTS}`,
  );
}

/** productdetail.get with fields=: documented names plus names for data the docs don't list. */
async function detailWithFields(videoId: string) {
  const fields = [
    "product_id",
    "product_title",
    "target_sale_price",
    "target_sale_price_currency",
    "product_video_url",
    "promo_code_info",
    "ean_code",
    "product_description",
    "description",
    "detail",
    "product_properties",
    "sku_info",
    "ae_item_sku_info",
  ].join(",");
  const d = await probe(
    "2 productdetail.get with fields= (2 ids)",
    "aliexpress.affiliate.productdetail.get",
    {
      product_ids: `${FIXTURE_ID},${videoId}`,
      fields,
      target_currency: "ILS",
      target_language: "HE",
      country: "IL",
      tracking_id: config.trackingId,
    },
  );
  if (!d?.ok) return;
  const rows = products(d.result);
  console.log(`       requested: ${fields}`);
  console.log(`       ${rows.length} products; field union:`);
  printFields(rows);
  for (const p of rows) {
    console.log(
      `       ${p.product_id}: video=${p.product_video_url ? show(p.product_video_url, 70) : "(empty)"} promo_code_info=${p.promo_code_info ? "yes" : "no"}`,
    );
  }
  saveFixture("aliexpress.affiliate.productdetail.get.fields", d.raw);
}

main().catch((err) => {
  console.error(maskText(err instanceof Error ? `${err.name}: ${err.message}` : String(err)));
  console.log(
    `requests made before the failure: ${requests} (API ${apiCalls}, redirect ${redirectGets})`,
  );
  process.exit(1);
});
