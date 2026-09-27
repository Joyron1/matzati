// M3 evaluation through the real search pipeline (lib/search/pipeline.ts) with an in-memory
// cache store. 15 queries from the first round plus 5 held-out ones that no prompt example
// resembles, to measure generalization. Everything is recorded to fixtures/llm/ so tests can
// run offline. Hard cap on LLM calls: 45 (owner approved ~40, 2026-09-27).
// Usage:
//   npx tsx --env-file=.env.local scripts/eval-llm.ts
//     Paid run (about 40 LLM calls and 20-30 AliExpress calls). Writes
//     fixtures/llm/eval-v3-<date>.json and prints a per-query table and a summary.
//   npx tsx --env-file=.env.local scripts/eval-llm.ts --only gift-cook,tech-charger
//     Paid run of those queries only (2 LLM calls each). Writes eval-v3-<date>-subset.json.
//   npx tsx scripts/eval-llm.ts --replay fixtures/llm/eval-v2-2026-09-27.json
//     The same table and summary for an earlier recording. No API calls, no env needed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { aliexpressConfig, llmConfig, usdIlsFallback } from "@/lib/env";
import { fetchUsdIlsRate } from "@/lib/fx/boi";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { costUsd } from "@/lib/llm/pricing";
import type { LlmProvider } from "@/lib/llm/provider";
import { queryKey } from "@/lib/search/cache-key";
import { runSearch, SearchError, type SearchMeta } from "@/lib/search/pipeline";
import { MemoryStore } from "@/lib/search/store";
import type { SearchResponse } from "@/lib/types";

export const EVAL_QUERIES = [
  { id: "gift-cook", topic: "gifts", q: "מתנה לאבא שאוהב לבשל עד 200 ש״ח" },
  { id: "kids-toy", topic: "kids", q: "צעצוע לילד בן 3 שמלמד צבעים" },
  { id: "car-holder", topic: "car", q: "מחזיק טלפון לרכב עם טעינה אלחוטית" },
  { id: "home-drawer", topic: "home", q: "מארגן מגירות למטבח" },
  { id: "tech-charger", topic: "tech", q: "מטען מהיר 65W לטלפון ולמחשב נייד" },
  { id: "price-watch", topic: "price", q: "שעון חכם עם דופק בפחות מ־150 שקל" },
  { id: "typo-earbuds", topic: "typos", q: "אוזניות בלוטות לריצה עמידות למיים" },
  { id: "slang-mouse", topic: "slang", q: "משהו שווה לגיימינג, עכבר שקט שלא מרעיש" },
  { id: "kids-bottle", topic: "kids", q: "בקבוק מים לגן שלא נוזל" },
  { id: "home-nightlight", topic: "home", q: "מנורת לילה לחדר ילדים עם חיישן תנועה" },
  { id: "price-range-bag", topic: "price", q: "תיק גב לטיולים בין 80 ל־200 ש״ח עמיד למים" },
  { id: "cheapest-cable", topic: "price", q: "הכי זול: כבל USB-C לאייפון 15" },
  { id: "pair-a", topic: "paraphrase", q: "אוזניות לריצה, עמידות למים, עד 100 ש״ח" },
  { id: "pair-a2", topic: "paraphrase", q: "אוזניות ריצה עמידות במים עד 100 שקל" },
  { id: "pair-b2", topic: "paraphrase", q: "מעמד לפלאפון לאוטו עם טעינה אלחוטית" },
  // Held out: written after the prompts, unlike any prompt example.
  { id: "ho-neck-pillow", topic: "held-out", q: "כרית לצוואר לטיסות ארוכות" },
  { id: "ho-gift-garden", topic: "held-out", q: "מתנה לסבתא שאוהבת לגנן עד 120 ש״ח" },
  { id: "ho-powerbank", topic: "held-out", q: "סוללת גיבוי קטנה לטלפון 10000 מיליאמפר" },
  { id: "ho-slippers", topic: "held-out", q: "נעלי בית חמות לחורף" },
  { id: "ho-speaker", topic: "held-out", q: "רמקול בלוטוס עמיד למים לים בין 50 ל־150 שקל" },
] as const;

const MAX_LLM_CALLS = 45;
/** The most one search can use: a parse, its one retry, and the explain call. */
const MAX_CALLS_PER_SEARCH = 3;
/** The explain line hedge that may only name a stated requirement (lib/llm/explain.ts). */
const CAVEAT = "הכותרת לא מציינת";

/** One LLM call with its token counts and cost. */
interface CallRecord {
  kind: "parse" | "explain";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Null for a model lib/llm/pricing.ts has no price for. */
  usd: number | null;
}

interface EvalRecord {
  id: string;
  topic: string;
  query: string;
  ms?: number;
  parsed?: unknown;
  meta?: SearchMeta;
  response?: SearchResponse;
  /** Every LLM call of this search (round 3 on; a replay derives them from meta). */
  calls?: CallRecord[];
  /** AliExpress categories of the products shown, for tuning the type gate (round 3 on). */
  categories?: { product_id: string; first: string | null; second: string | null }[];
  error?: string;
}

class CappedLlm implements LlmProvider {
  calls = 0;
  constructor(private inner: LlmProvider) {}
  get name() {
    return this.inner.name;
  }
  get model() {
    return this.inner.model;
  }
  generateStructured: LlmProvider["generateStructured"] = (req) => {
    if (this.calls >= MAX_LLM_CALLS) throw new Error(`LLM call cap ${MAX_LLM_CALLS} reached`);
    this.calls++;
    return this.inner.generateStructured(req);
  };
}

const round = (n: number, digits: number) => Number(n.toFixed(digits));
const sum = (ns: number[]) => ns.reduce((s, n) => s + n, 0);
const avg = (ns: number[]) => (ns.length ? round(sum(ns) / ns.length, 1) : 0);

function callsOf(meta: SearchMeta): CallRecord[] {
  return meta.llmUsage.map(({ kind, model, usage }) => {
    const usd = costUsd(model, usage);
    return { kind, model, ...usage, usd: usd === null ? null : round(usd, 6) };
  });
}

const callsIn = (r: EvalRecord) => r.calls ?? (r.meta ? callsOf(r.meta) : []);
const usdOf = (calls: CallRecord[]) => sum(calls.map((c) => c.usd ?? 0));

/** Shown lines the model wrote that passed every check (the rest fell back to a data sentence). */
function linesKept(r: EvalRecord): number {
  const rejected = new Set(r.meta?.explainRejected.map((x) => x.product_id) ?? []);
  return r.response?.results.filter((x) => !rejected.has(x.product_id)).length ?? 0;
}

const caveats = (r: EvalRecord) =>
  r.response?.results.filter((x) => x.why_he.includes(CAVEAT)).length ?? 0;

function summarize(records: EvalRecord[], model: string, usdIls: number | null) {
  const done = records.filter((r) => r.meta && r.response);
  const calls = done.flatMap(callsIn);
  const fresh = done.filter((r) => r.meta?.cache === "none");
  const total = usdOf(calls);
  const tokens = (kind: CallRecord["kind"]) => {
    const cs = calls.filter((c) => c.kind === kind);
    return {
      calls: cs.length,
      avgInputTokens: avg(cs.map((c) => c.inputTokens)),
      avgOutputTokens: avg(cs.map((c) => c.outputTokens)),
      maxInputTokens: Math.max(0, ...cs.map((c) => c.inputTokens)),
      usd: round(usdOf(cs), 5),
    };
  };
  const shown = done.flatMap((r) => r.response?.results ?? []);
  return {
    model,
    searches: done.length,
    errors: records.length - done.length,
    llmCalls: calls.length,
    aliexpressCalls: sum(done.map((r) => r.meta?.aliCalls ?? 0)),
    cacheHits: done.length - fresh.length,
    tokens: { parse: tokens("parse"), explain: tokens("explain") },
    totalUsd: round(total, 5),
    /** Every search run, cache hits included: what a search costs on average. */
    avgUsdPerSearch: done.length ? round(total / done.length, 5) : 0,
    /** Searches that paid for both a parse and an explain call. */
    avgUsdPerFreshSearch: fresh.length ? round(usdOf(fresh.flatMap(callsIn)) / fresh.length, 5) : 0,
    ...(usdIls !== null ? { totalIls: round(total * usdIls, 4), usdIls } : {}),
    queriesWith3: done.filter((r) => (r.response?.results.length ?? 0) >= 3).length,
    queriesWith0: done.filter((r) => r.response?.results.length === 0).length,
    linesShown: shown.length,
    linesKept: sum(done.map(linesKept)),
    caveats: sum(done.map(caveats)),
  };
}

const COLUMNS = [
  ["query", 16],
  ["res", 3],
  ["pass/chk", 8],
  ["type", 4],
  ["req", 4],
  ["cache", 7],
  ["calls", 5],
  ["in tok", 6],
  ["out tok", 7],
  ["usd", 8],
  ["kept", 4],
  ["cav", 3],
] as const;

function tableRow(r: EvalRecord): string {
  if (!r.meta || !r.response) return `${r.id.padEnd(16)} ERROR ${r.error ?? "no result"}`;
  const calls = callsIn(r);
  const cells = [
    r.id,
    String(r.response.results.length),
    `${r.response.passed_count}/${r.response.checked_count}`,
    String(r.meta.rejected?.type ?? "-"),
    String(r.meta.rejected?.requirement ?? "-"),
    r.meta.cache,
    String(calls.length),
    String(sum(calls.map((c) => c.inputTokens))),
    String(sum(calls.map((c) => c.outputTokens))),
    usdOf(calls).toFixed(5),
    `${linesKept(r)}/${r.response.results.length}`,
    String(caveats(r)),
  ];
  return cells.map((c, i) => c.padEnd(COLUMNS[i][1])).join(" | ");
}

function printHeader() {
  const header = COLUMNS.map(([name, width]) => name.padEnd(width)).join(" | ");
  console.log(`\n${header}\n${"-".repeat(header.length)}`);
}

function printReport(records: EvalRecord[], summary: ReturnType<typeof summarize>) {
  printHeader();
  for (const r of records) console.log(tableRow(r));
  console.log(`\n${JSON.stringify(summary, null, 2)}`);
}

function replay(file: string) {
  const { summary, records } = JSON.parse(readFileSync(file, "utf8")) as {
    summary?: { model?: string; usdIls?: number };
    records: EvalRecord[];
  };
  printReport(records, summarize(records, summary?.model ?? "?", summary?.usdIls ?? null));
}

async function main() {
  const cfg = llmConfig();
  const llm = new CappedLlm(new AnthropicProvider(cfg.apiKey, cfg.model, { maxRetries: 0 }));
  const ali = new AliExpressClient(aliexpressConfig());
  const store = new MemoryStore();
  const records: EvalRecord[] = [];
  let lastAli = 0;

  const onlyAt = process.argv.indexOf("--only");
  const only = onlyAt >= 0 ? new Set((process.argv[onlyAt + 1] ?? "").split(",")) : null;
  const queries = only ? EVAL_QUERIES.filter((x) => only.has(x.id)) : EVAL_QUERIES;
  if (only && queries.length !== only.size) throw new Error("--only names an unknown query id");

  printHeader();
  for (const { id, topic, q } of queries) {
    if (llm.calls + MAX_CALLS_PER_SEARCH > MAX_LLM_CALLS) {
      console.log(`${id}: skipped, ${MAX_LLM_CALLS - llm.calls} LLM calls left under the cap`);
      records.push({ id, topic, query: q, error: "skipped: LLM call cap" });
      continue;
    }
    // Space searches too: AliExpress bans bursts across calls, not just within one search.
    const wait = lastAli + 1_500 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const t0 = Date.now();
    try {
      const { response, meta } = await runSearch({ q }, { llm, ali, store, aliSpacingMs: 1_500 });
      if (meta.aliCalls) lastAli = Date.now();
      const parsed = await store.getParse(queryKey(q), new Date());
      const cached = response.filters_key
        ? await store.getResults(response.filters_key, new Date())
        : null;
      const byId = new Map(cached?.products.map((p) => [p.productId, p.category]) ?? []);
      const categories = response.results.map((x) => ({
        product_id: x.product_id,
        first: byId.get(x.product_id)?.firstName ?? null,
        second: byId.get(x.product_id)?.secondName ?? null,
      }));
      const record: EvalRecord = {
        id,
        topic,
        query: q,
        ms: Date.now() - t0,
        parsed,
        meta,
        response,
        calls: callsOf(meta),
        categories,
      };
      records.push(record);
      console.log(tableRow(record));
    } catch (err) {
      const message = err instanceof SearchError ? `${err.code}: ${err.message}` : String(err);
      records.push({ id, topic, query: q, error: message });
      console.log(`${id}: ERROR ${message}`);
      if (String(err).includes("call cap")) break;
    }
  }

  const fx = await fetchUsdIlsRate(usdIlsFallback());
  const summary = { ...summarize(records, cfg.model, fx.rate), llmCalls: llm.calls };
  mkdirSync("fixtures/llm", { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = `fixtures/llm/eval-v3-${date}${only ? "-subset" : ""}.json`;
  writeFileSync(file, `${JSON.stringify({ summary, records }, null, 2)}\n`);
  printReport(records, summary);
  console.log(`saved ${file}`);
}

const replayAt = process.argv.indexOf("--replay");
if (replayAt >= 0) {
  replay(process.argv[replayAt + 1] ?? "");
} else {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exit(1);
  });
}
