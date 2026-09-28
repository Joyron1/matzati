// M3 evaluation through the real search pipeline (lib/search/pipeline.ts) with an in-memory
// cache store. 15 queries from the first round plus 5 held-out ones that no prompt example
// resembles, to measure generalization. Everything is recorded to fixtures/llm/ so tests can
// run offline. Hard cap on LLM calls: 45 (owner approved ~40, 2026-09-27).
// Usage (without one of these flags the script only prints its usage: no paid run by default):
//   npx tsx --env-file=.env.local scripts/eval-llm.ts --v3
//     Paid run (about 40 LLM calls and 20-30 AliExpress calls). Writes
//     fixtures/llm/eval-v3-<date>.json and prints a per-query table and a summary.
//   npx tsx --env-file=.env.local scripts/eval-llm.ts --v3 --only gift-cook,tech-charger
//     Paid run of those queries only (2 LLM calls each). Writes eval-v3-<date>-subset.json.
//   npx tsx scripts/eval-llm.ts --replay fixtures/llm/eval-v2-2026-09-27.json
//     The same table and summary for an earlier recording. No API calls, no env needed.
//
// Final check (docs/search-quality-plan.md A11; owner-approved, run by the owner session):
//   npx tsx scripts/eval-llm.ts --final --plan
//     Dry run: the 29 queries (the 20 above and the 9 home examples of components/search-guide.tsx,
//     read as text), which are searched and which copy an earlier query with the same parse key,
//     and the exact maximum of LLM and AliExpress requests the run may make. No call, no env.
//   npx tsx --env-file=.env.local scripts/eval-llm.ts --final [--only id,id]
//     Paid run. Prints the plan first, then searches through the real pipeline with an in-memory
//     store (no database), under hard caps that count every retry (lib/eval/final-check.ts): at
//     most 60 LLM and 87 AliExpress requests for the whole check, over all its runs and days; the
//     request past a cap is never sent, and the run stops there. Every request is written to
//     fixtures/llm/eval-final-ledger.json before it is sent. Start with one query (--only; a query
//     that copies another searches that one, as the full run would), then run again for the rest:
//     a rerun resumes the check's results file, skips the queries already recorded and counts
//     every request already made. Writes fixtures/llm/eval-final-<date of the first run>.json (env
//     values masked) after every query, then the table and the metrics the offline replay reports
//     (lead product, same shop in the top 3, zero and partial results, 6+ passed), next to the
//     offline replay of the same queries, and the Hebrew line checks. A new check (a new approval)
//     starts once the ledger and the results file are moved out of fixtures/llm.
//   npx tsx scripts/eval-llm.ts --replay fixtures/llm/eval-final-<date>.json
//     The final check's report again, from the file. No call, no env.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { aliexpressConfig, llmConfig, usdIlsFallback } from "@/lib/env";
import {
  ALI_RETRIES,
  CappedLlm as RequestCappedLlm,
  EXAMPLES_FILE,
  FINAL_CAPS,
  RequestCap,
  cappedFetch,
  exampleQueries,
  finalQueries,
  formatPlan,
  isDone,
  keptProducts,
  ledgerFromResults,
  liveQueryResult,
  parseLedger,
  planFinalRun,
  recordLines,
  snapshotForQuery,
  summarizeLines,
  type Caps,
  type FinalLedger,
  type FinalRecord,
  type LedgerRun,
  type PlannedQuery,
} from "@/lib/eval/final-check";
import { loadLabels, loadSnapshots } from "@/lib/eval/files";
import { formatComparison, formatTotals } from "@/lib/eval/format";
import { labelLetter, labelsFor } from "@/lib/eval/labels";
import { CURRENT_POLICY } from "@/lib/eval/policies";
import { evaluateQuery, renormalizeParse, type QueryResult, type Variant } from "@/lib/eval/replay";
import {
  compareRuns,
  summarize as summarizeRun,
  variantInfo,
  type EvalRun,
} from "@/lib/eval/report";
import { fetchUsdIlsRate } from "@/lib/fx/boi";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { EXPLAIN_VERSION } from "@/lib/llm/explain";
import { PARSE_VERSION } from "@/lib/llm/parse";
import { costUsd } from "@/lib/llm/pricing";
import type { LlmProvider } from "@/lib/llm/provider";
import { findEnvValues, maskEnvValuesDeep, parseEnvFile, secretEnv } from "@/lib/mask";
import { RANKING_VERSION } from "@/lib/ranking/config";
import { queryKey } from "@/lib/search/cache-key";
import { runSearch, SearchError, type SearchMeta } from "@/lib/search/pipeline";
import { MemoryStore } from "@/lib/search/store";
import type { LlmUsageRecord } from "@/lib/stats/usage";
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
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    kind?: string;
    summary?: { model?: string; usdIls?: number };
    records: EvalRecord[];
  };
  if (json.kind === FINAL_KIND) {
    printFinalReport(readFinalFile(file).records);
    return;
  }
  const { summary, records } = json;
  printReport(records, summarize(records, summary?.model ?? "?", summary?.usdIls ?? null));
}

// ---------------------------------------------------------------- final check (A11)

const FINAL_KIND = "final-check";
const FINAL_FORMAT = 1;
/** Gap after a search's last AliExpress request before the next search (their frequency ban). */
const SEARCH_GAP_MS = 1_500;
const FINAL_DIR = "fixtures/llm";
/** Every request of the final check, over all its runs and days (FinalLedger, final-check.ts). */
const LEDGER_PATH = `${FINAL_DIR}/eval-final-ledger.json`;
/** The check's results file, named after the day of its first run. */
const RESULTS_FILE = /^eval-final-\d{4}-\d{2}-\d{2}\.json$/;

interface FinalFile {
  format: number;
  kind: typeof FINAL_KIND;
  /** The day of the check's first run. */
  date: string;
  model: string | null;
  caps: Caps;
  versions: { parse: number; ranking: number; explain: number };
  /** The ledger when this file was last written (LEDGER_PATH is the one that counts). */
  ledger: { llmRequests: number; aliRequests: number; runs: LedgerRun[] };
  summary: ReturnType<typeof finalSummary>;
  records: FinalRecord[];
}

/** The final check's results files, oldest first. */
function resultsFiles(): string[] {
  if (!existsSync(FINAL_DIR)) return [];
  return readdirSync(FINAL_DIR)
    .filter((f) => RESULTS_FILE.test(f))
    .sort()
    .map((f) => `${FINAL_DIR}/${f}`);
}

/** The check's ledger; before the ledger file existed, the sum of the results files' counts. */
function readLedger(): FinalLedger {
  if (existsSync(LEDGER_PATH)) return parseLedger(readFileSync(LEDGER_PATH, "utf8"), LEDGER_PATH);
  return ledgerFromResults(resultsFiles().map(readFinalFile));
}

/** Counts, times and query ids only: nothing in it can hold an env value. */
function writeLedger(ledger: FinalLedger) {
  mkdirSync(FINAL_DIR, { recursive: true });
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

function readFinalFile(path: string): FinalFile {
  const file = JSON.parse(readFileSync(path, "utf8")) as Partial<FinalFile>;
  if (
    file.kind !== FINAL_KIND ||
    file.format !== FINAL_FORMAT ||
    !Array.isArray(file.records) ||
    typeof file.ledger?.llmRequests !== "number" ||
    typeof file.ledger?.aliRequests !== "number"
  ) {
    // Never guess the requests an unreadable file recorded: they count against today's caps.
    throw new Error(`${path} is not a final-check file of format ${FINAL_FORMAT}`);
  }
  return file as FinalFile;
}

let secrets: Record<string, string> | null = null;
function envSecrets(): Record<string, string> {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  secrets ??= secretEnv(parseEnvFile(read(".env.local")), parseEnvFile(read(".env.example")));
  return secrets;
}

/** Writes the file with every .env.local value masked; refuses when one would still be in it. */
function saveFinalFile(path: string, file: FinalFile) {
  const text = `${JSON.stringify(maskEnvValuesDeep(file, envSecrets()), null, 2)}\n`;
  const { leaks } = findEnvValues(text, envSecrets());
  if (leaks.length) throw new Error(`NOT SAVED ${path}: still contains ${leaks.join(", ")}`);
  mkdirSync("fixtures/llm", { recursive: true });
  writeFileSync(path, text);
}

const usdOfUsage = (records: LlmUsageRecord[]) =>
  sum(records.map(({ model, usage }) => costUsd(model, usage) ?? 0));

/** Totals for the file: requests, cost and outcomes of the searches themselves (not copies). */
function finalSummary(records: FinalRecord[]) {
  const own = records.filter((r) => !r.sameAs);
  return {
    queries: records.length,
    searched: own.filter((r) => r.llmRequests !== undefined).length,
    finished: own.filter(isDone).length,
    copies: records.length - own.length,
    capped: own.filter((r) => r.capped).map((r) => r.id),
    errors: own.filter((r) => !isDone(r)).map((r) => r.id),
    llmRequests: sum(own.map((r) => r.llmRequests ?? 0)),
    aliRequests: sum(own.map((r) => r.aliRequests ?? 0)),
    usd: round(sum(own.map((r) => r.usd ?? 0)), 5),
  };
}

/** A copy of `source`'s search for a query with the same parse key: no request of its own. */
function copyRecord(q: PlannedQuery, source: FinalRecord | undefined): FinalRecord {
  const base = { id: q.id, group: q.group, query: q.q, from: q.from, sameAs: q.sameAs ?? "" };
  if (!source || !isDone(source)) {
    return { ...base, error: `same as ${q.sameAs}, which has no result` };
  }
  const { parsed, meta, response, kept } = source;
  return { ...base, parsed, meta, response, kept, llmRequests: 0, aliRequests: 0, usd: 0 };
}

function onlyIds(): Set<string> | null {
  const at = process.argv.indexOf("--only");
  return at >= 0 ? new Set((process.argv[at + 1] ?? "").split(",").filter(Boolean)) : null;
}

async function finalCheck() {
  const planOnly = process.argv.includes("--plan");
  const all = finalQueries(EVAL_QUERIES, exampleQueries(readFileSync(EXAMPLES_FILE, "utf8")));

  // One check, one results file and one ledger, over every run and day: the caps are the owner's
  // approval for the whole check. The latest results file is resumed, whatever its date.
  const existing = resultsFiles().at(-1) ?? null;
  const date = new Date().toISOString().slice(0, 10);
  const path = existing ?? `${FINAL_DIR}/eval-final-${date}.json`;
  const saved = existing ? readFinalFile(existing) : null;
  const ledger = readLedger();
  const records = new Map((saved?.records ?? []).map((r) => [r.id, r]));
  const used = { llm: ledger.llmRequests, ali: ledger.aliRequests };
  const done = new Set([...records.values()].filter(isDone).map((r) => r.id));
  // Copies are decided over the whole list, so --only searches what the full run would.
  const plan = planFinalRun(all, { used, done, only: onlyIds() });
  console.log(formatPlan(plan));
  console.log(saved ? `  Resumes ${path}.` : `  Writes ${path}.`);
  console.log(
    `  Ledger ${LEDGER_PATH}: ${ledger.runs.length} earlier runs, written at every request.`,
  );
  if (planOnly) return;
  if (!plan.toRun.length) {
    console.log("Nothing left to search in this check.");
    return;
  }
  if (!plan.llm.left || !plan.ali.left) {
    console.log(
      "A cap of this check is used up: nothing is searched. A new check needs the owner's " +
        `approval, and starts once ${LEDGER_PATH} and ${path} are moved out of ${FINAL_DIR}.`,
    );
    return;
  }

  // Paid part: every request below goes through the caps, and reaches the ledger before it is
  // sent (a run cut short, or a results file refused for a leak, still counts what it sent).
  const cfg = llmConfig();
  const startedAt = new Date().toISOString();
  const ledgerRun: LedgerRun = {
    startedAt,
    updatedAt: startedAt,
    llmRequests: 0,
    aliRequests: 0,
    ids: [],
  };
  ledger.runs.push(ledgerRun);
  const record = () => {
    ledgerRun.updatedAt = new Date().toISOString();
    ledgerRun.llmRequests = llmCap.used - used.llm;
    ledgerRun.aliRequests = aliCap.used - used.ali;
    ledger.llmRequests = llmCap.used;
    ledger.aliRequests = aliCap.used;
    writeLedger(ledger);
  };
  const llmCap = new RequestCap("LLM", FINAL_CAPS.llmRequests, used.llm, record);
  const aliCap = new RequestCap("AliExpress", FINAL_CAPS.aliRequests, used.ali, record);
  writeLedger(ledger);
  const llm = new RequestCappedLlm(
    new AnthropicProvider(cfg.apiKey, cfg.model, { maxRetries: 0 }),
    llmCap,
  );
  const ali = new AliExpressClient(aliexpressConfig(), {
    fetch: cappedFetch(aliCap),
    retries: ALI_RETRIES,
  });
  const store = new MemoryStore();
  const file: FinalFile = {
    format: FINAL_FORMAT,
    kind: FINAL_KIND,
    date: saved?.date ?? date,
    model: cfg.model,
    caps: FINAL_CAPS,
    versions: { parse: PARSE_VERSION, ranking: RANKING_VERSION, explain: EXPLAIN_VERSION },
    ledger: { llmRequests: used.llm, aliRequests: used.ali, runs: ledger.runs },
    summary: finalSummary([]),
    records: [],
  };
  // After every query: the records so far, with the ledger as it stands.
  const save = () => {
    record();
    file.ledger = {
      llmRequests: ledger.llmRequests,
      aliRequests: ledger.aliRequests,
      runs: ledger.runs,
    };
    file.records = all.flatMap((x) => records.get(x.id) ?? []);
    file.summary = finalSummary(file.records);
    saveFinalFile(path, file);
  };

  printFinalHeader();
  const byId = new Map(plan.queries.map((p) => [p.id, p]));
  let stopped = false;
  let lastAli = 0;
  for (const id of plan.toRun) {
    const q = byId.get(id)!;
    const base = { id, group: q.group, query: q.q, from: q.from };
    if (stopped) {
      records.set(id, { ...base, error: "skipped: a cap was reached earlier in this run" });
      continue;
    }
    const wait = lastAli + SEARCH_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const before = {
      llm: llmCap.used,
      ali: aliCap.used,
      llmRefused: llmCap.refused,
      aliRefused: aliCap.refused,
      usage: store.usage.length,
    };
    const t0 = Date.now();
    let rec: FinalRecord;
    try {
      const { response, meta } = await runSearch(
        { q: q.q },
        { llm, ali, store, aliSpacingMs: SEARCH_GAP_MS },
      );
      const cached = response.filters_key
        ? await store.getResults(response.filters_key, new Date())
        : null;
      rec = {
        ...base,
        parsed: cached?.filters ?? (await store.getParse(queryKey(q.q), new Date())),
        meta,
        response,
        kept: keptProducts(cached?.products ?? []),
      };
    } catch (err) {
      const message = err instanceof SearchError ? `${err.code}: ${err.message}` : String(err);
      rec = { ...base, parsed: await store.getParse(queryKey(q.q), new Date()), error: message };
    }
    rec.ms = Date.now() - t0;
    rec.llmRequests = llmCap.used - before.llm;
    rec.aliRequests = aliCap.used - before.ali;
    // Every call's usage, a failed search's too (the pipeline writes it either way).
    rec.usd = round(usdOfUsage(store.usage.slice(before.usage)), 6);
    if (llmCap.refused > before.llmRefused) rec.capped = "llm";
    else if (aliCap.refused > before.aliRefused) rec.capped = "aliexpress";
    if (rec.aliRequests) lastAli = Date.now();
    if (rec.capped) stopped = true;
    records.set(id, rec);
    ledgerRun.ids.push(id);
    save();
    console.log(finalRow(rec));
  }
  // A copy is recorded once its source has a result; one whose source has none is recorded as such
  // only when this run was asked for it (a run of other --only ids leaves it for later).
  const selected = plan.selected ? new Set(plan.selected) : null;
  for (const q of plan.queries) {
    if (!q.sameAs || q.done) continue;
    const source = records.get(q.sameAs);
    if ((source && isDone(source)) || !selected || selected.has(q.id)) {
      records.set(q.id, copyRecord(q, source));
    }
  }
  save();
  console.log(`\nsaved ${path}`);
  printFinalReport(file.records);
}

const FINAL_COLUMNS = [
  ["id", 16],
  ["res", 3],
  ["pass/chk", 8],
  ["lead", 4],
  ["top3", 4],
  ["shop", 4],
  ["cache", 7],
  ["llm", 3],
  ["ali", 3],
  ["usd", 8],
  ["model", 5],
  ["defects", 7],
] as const;

function printFinalHeader() {
  const header = FINAL_COLUMNS.map(([name, width]) => name.padEnd(width)).join(" | ");
  console.log(`\n${header}\n${"-".repeat(header.length)}`);
}

/** One ASCII row per query (the Hebrew query is in the file: it breaks column alignment). */
function finalRow(rec: FinalRecord, result?: QueryResult): string {
  const notes = [
    rec.sameAs ? `= ${rec.sameAs}` : "",
    rec.capped ? `CAPPED (${rec.capped})` : "",
    rec.error && !rec.sameAs ? `ERROR ${rec.error}` : "",
    rec.meta?.explainFailed ? "explain failed" : "",
    rec.meta?.demoted?.length ? `${rec.meta.demoted.length} moved down` : "",
  ].filter(Boolean);
  if (!isDone(rec) || !rec.response || !rec.meta) {
    return `${rec.id.padEnd(16)} | ${notes.join("; ") || "no result"}`;
  }
  const lines = recordLines(rec);
  const r = result ?? liveQueryResult(rec, null);
  // "-": no snapshot of this query (or no results); "?": its lead has no label yet.
  const lead = !r.labels
    ? "-"
    : r.labels.leadCorrect === null
      ? r.top3.length
        ? "?"
        : "-"
      : r.labels.leadCorrect
        ? "yes"
        : "NO";
  const cells = [
    rec.id,
    String(rec.response.results.length),
    `${rec.response.passed_count}/${rec.response.checked_count}`,
    lead,
    r.labels ? r.top3.map((l) => labelLetter(l.label)).join("") : "-",
    rec.response.results.length ? String(r.sameShopTop3) : "-",
    rec.meta.cache,
    String(rec.llmRequests ?? 0),
    String(rec.aliRequests ?? 0),
    (rec.usd ?? 0).toFixed(5),
    `${lines.filter((l) => !l.problems.includes("data_line")).length}/${lines.length}`,
    String(lines.filter((l) => l.problems.some((p) => p !== "data_line")).length),
  ];
  const row = cells.map((c, i) => c.padEnd(FINAL_COLUMNS[i][1])).join(" | ");
  return notes.length ? `${row} | ${notes.join("; ")}` : row;
}

const LIVE_VARIANT: EvalRun["variant"] = {
  name: "live",
  policy: "pipeline",
  policyDescription: "the real pipeline, fresh parses (scripts/eval-llm.ts --final)",
  rank: "pipeline",
  sort: null,
  without: [],
  adjustedParse: false,
};

/**
 * The table, the offline report's totals for the live run, the offline replay of the same queries
 * against it (lib/eval/report.ts compareRuns), the Hebrew line checks and the A11 gate. Free: the
 * snapshots and labels are local files. Labels and replays are matched by query text.
 */
function printFinalReport(records: FinalRecord[]) {
  const snapshots = loadSnapshots();
  const labels = loadLabels();
  const snapOf = (r: FinalRecord) => snapshotForQuery(snapshots, r.query);
  const live = records.map((r) => {
    const snap = snapOf(r);
    return liveQueryResult(r, snap ? labelsFor(labels.book, snap) : null);
  });
  const liveRun: EvalRun = { variant: LIVE_VARIANT, summary: summarizeRun(live), queries: live };
  // The closest free stand-in for today's parses: each stored parse through today's guards.
  const variant: Variant = {
    name: "offline",
    policy: CURRENT_POLICY,
    adjustParse: renormalizeParse,
  };
  const offline = records.flatMap((r) => {
    const snap = snapOf(r);
    if (!snap) return [];
    const replayed = evaluateQuery(snap, labels.book, variant);
    return [{ ...replayed, id: r.id, group: r.group, sameQueryAs: r.sameAs ?? null }];
  });
  const offlineRun: EvalRun = {
    variant: variantInfo(variant),
    summary: summarizeRun(offline),
    queries: offline,
  };

  printFinalHeader();
  records.forEach((r, i) => console.log(finalRow(r, live[i])));
  console.log(
    "\nlead/top3: labels of the snapshot with the same query (E exact, R reasonable, w weak, X wrong, " +
      "? unlabelled; - no snapshot or no results). model: shown lines the model wrote (the rest are " +
      "built from the data). defects: cards with a Hebrew line problem.\n",
  );
  console.log(formatTotals(liveRun));
  console.log(`\n${formatComparison(compareRuns(offlineRun, liveRun))}`);

  const lines = summarizeLines(records);
  console.log(
    `\nHebrew lines (${lines.queries} searches, copies left out): ${lines.cards} cards, ` +
      `${lines.cardsWithDefect} with a defect (${lines.defectRate === null ? "-" : `${(lines.defectRate * 100).toFixed(1)}%`}), ` +
      `${lines.dataLines} lines built from the data, ${lines.englishTitles} English titles.`,
  );
  const counts = Object.entries(lines.byProblem)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  if (counts) console.log(`  by problem: ${counts}`);
  for (const d of lines.defects) console.log(`  ${d.id} ${d.productId}: ${d.problems.join(", ")}`);

  const s = liveRun.summary;
  const own = records.filter((r) => !r.sameAs);
  const sixPlus = own.filter((r) => (r.response?.passed_count ?? 0) >= 6).length;
  const unlabelledLeads = live.filter(
    (r) => !r.sameQueryAs && r.top3.length && r.top3[0].label === null,
  );
  console.log(
    [
      "\nA11 gate (docs/search-quality-plan.md; labels written by agents, in-sample, owner review pending):",
      `  lead exact or reasonable: ${s.labels.leadCorrect} of ${s.labels.leadLabelled} labelled leads ` +
        `(plan: at least 18 of 19); unlabelled leads: ${unlabelledLeads.map((r) => r.id).join(", ") || "none"}`,
      `  wrong products in the top 3: ${s.labels.queries ? s.labels.wrongTop3 : "-"} (plan: 0)`,
      `  6 or more passed: ${sixPlus} of ${own.length} searches (plan: at least 90%)`,
      `  cards with a Hebrew defect: ${lines.cardsWithDefect} of ${lines.cards} (plan: at most 10%)`,
      `  2+ from one shop in the top 3: ${s.sameShopTop3.join(", ") || "none"}`,
      `  no results: ${s.noResults.join(", ") || "none"}; 1-2 results: ${s.underOnePage.join(", ") || "none"}`,
      '  Still by eye: the home example\'s 3 cards and its "עוד 3" (owner sign-off).',
    ].join("\n"),
  );
  const summary = finalSummary(records);
  console.log(`\n${JSON.stringify(summary, null, 2)}`);
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

const fail = (err: unknown) => {
  console.error("FAILED:", err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
};

const replayAt = process.argv.indexOf("--replay");
if (replayAt >= 0) {
  try {
    replay(process.argv[replayAt + 1] ?? "");
  } catch (err) {
    fail(err);
  }
} else if (process.argv.includes("--final") || process.argv.includes("--plan")) {
  finalCheck().catch(fail);
} else if (process.argv.includes("--v3")) {
  main().catch(fail);
} else {
  // A paid run is never the default: a mistyped final-check command must not start the older eval.
  console.error(
    "Usage: --final --plan (dry run), --final [--only id,id] (paid final check), " +
      "--replay <file>, or --v3 [--only id,id] (the older paid M3 eval).",
  );
  process.exit(1);
}
