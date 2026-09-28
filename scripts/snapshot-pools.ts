// Product-pool snapshot (docs/search-quality-plan.md, item 1). For 32 queries (the 20 EVAL_QUERIES
// of scripts/eval-llm.ts, the 9 home page examples of components/search-guide.tsx and 3 queries
// seen on the live site) it saves every product AliExpress returned, so ranking and type-gate
// changes can be replayed offline, for free, over a pool larger than the pipeline's.
//
// Parses, cheapest first: (a) the current parse_cache row (queryKey with the current
// PARSE_VERSION; one read-only SELECT with the service role), (b) the recorded parse in
// fixtures/llm (the round-3 subset, then round 3; its PARSE_VERSION is noted), (c) one live
// parseQuery. Live parse calls are hard capped at MAX_LLM_CALLS in total, retries included: the
// next call throws. Explain is never called. Before all of these, a query that already has a
// snapshot for the same query text keeps its parse, so a refresh costs no LLM call and the pools
// stay comparable across refreshes; --reparse drops that step (after a PARSE_VERSION bump, for
// example), and a home page example whose text changed is parsed again.
//
// Fetch: the pipeline's product.query (queryProducts: the same params, sort LAST_VOLUME_DESC,
// price bounds in agorot) and keyword steps (keywordSteps in lib/search/fetch-policy.ts), up to 3
// calls per query: first exactly the calls the live pipeline makes (nextFetch, until it stops),
// so the offline replay of today's policy is complete; then, while calls are left, page 2 of
// keywords_en (skipped when page 1 was not full, i.e. total_record_count has nothing beyond it)
// and the broader keyword steps in order, for other policies to replay. Steps are named
// "primary-p1", "primary-p2" and "ladder-<i>" for keywordLadder(parsed)[i] (the snapshots of
// 2026-09-28 used the ladder of that day: p1, p2, ladder-1).
// At most MAX_ALI_REQUESTS HTTP requests in total, each at least 1.6 s after the previous one; one
// retry after an ApiCallLimit ban, counted.
//
// Writes fixtures/snapshots/<id>.json (every .env.local value masked; promotion links replaced by a
// marker, see LINK_MARKER) and fixtures/snapshots/index.json (the run ledger: calls, cost, per-query
// stats). Never writes to the database. A rerun on the same UTC day resumes: ids already saved are
// skipped (unless --force) and the calls already made count against both caps.
//
// Never import scripts/eval-llm.ts: it starts a paid eval run when loaded. Its queries are read from
// the file text.
//
// Usage (from the repo root; supabase-js needs a WebSocket on Node 20, so NODE_OPTIONS as in the
// npm dev script):
//   NODE_OPTIONS=--experimental-websocket npx tsx --env-file=.env.local \
//     scripts/snapshot-pools.ts --plan
//     The parse each query would use and the most calls a run could make. Reads parse_cache and
//     fixtures only: no LLM and no AliExpress call.
//   NODE_OPTIONS=--experimental-websocket npx tsx --env-file=.env.local \
//     scripts/snapshot-pools.ts [--only id,id] [--force] [--reparse] [--max-llm N] [--max-ali N]
//     The capture run (at most 8 LLM calls and 100 AliExpress requests per UTC day, fewer with the
//     flags). Start with one query (--only), then run again for the rest.
//   npx tsx scripts/snapshot-pools.ts --report
//     Pool sizes and FILTERS / FILL_TIER pass counts of the saved snapshots under the current
//     ranking code. No API calls, no env needed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  MAX_PAGE_SIZE,
  productQueryParams,
  queryProducts,
  type ProductQuery,
  type ProductSort,
} from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import type { AliProduct, ProductPage } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { aliexpressConfig, llmConfig } from "@/lib/env";
import { AnthropicProvider } from "@/lib/llm/anthropic";
import { EXPLAIN_VERSION } from "@/lib/llm/explain";
import { PARSE_VERSION, parseQuery } from "@/lib/llm/parse";
import { costUsd } from "@/lib/llm/pricing";
import type { LlmProvider, LlmUsage } from "@/lib/llm/provider";
import {
  findEnvValues,
  maskEnvValuesDeep,
  maskEnvValues,
  parseEnvFile,
  secretEnv,
} from "@/lib/mask";
import { CURRENT_POLICY } from "@/lib/eval/policies";
import { rankLikePipeline, replayFetch } from "@/lib/eval/replay";
import { FILL_TIER, FILTERS, RANKING_VERSION } from "@/lib/ranking/config";
import {
  passesFilters,
  rankProducts,
  rejectionCounts,
  trustTierOf,
  type RejectReason,
} from "@/lib/ranking/rank";
import { isFresh, normalizeQuery, queryKey } from "@/lib/search/cache-key";
import {
  keywordLadder,
  lowestUnitsSold,
  nextFetch,
  type FetchedPage,
} from "@/lib/search/fetch-policy";
import type { ParsedQuery } from "@/lib/search/filters";

/** Bump when the file shape changes. */
const SNAPSHOT_FORMAT = 1;
const OUT_DIR = "fixtures/snapshots";
const INDEX_FILE = `${OUT_DIR}/index.json`;
/** Owner-approved budget for the whole snapshot (docs/search-quality-plan.md, paid runs). */
const MAX_LLM_CALLS = 8;
const MAX_ALI_REQUESTS = 100;
const MAX_CALLS_PER_QUERY = 3;
const SPACING_MS = 1_600;
const BAN_WAIT_MS = 2_500;
/** The pipeline's fetch sort (FETCH_SORT in lib/search/pipeline.ts, not exported). */
const FETCH_SORT: ProductSort = "LAST_VOLUME_DESC";
/**
 * Stands in for promotion_link (about 1,000 characters each). Ranking and replay only need to know
 * whether a product came with a link (ensureLinks drops products without one); links expire anyway.
 */
const LINK_MARKER = "<promotion_link omitted>";
const TRACKING_PLACEHOLDER = "<ALIEXPRESS_TRACKING_ID>";

/** Recorded parses, most recent prompt first (docs/eval-m3.md, round 3). */
const RECORDED_PARSES = [
  { file: "fixtures/llm/eval-v3-2026-09-27-subset.json", parseVersion: 5 },
  { file: "fixtures/llm/eval-v3-2026-09-27.json", parseVersion: 4 },
] as const;

/** Queries seen on the live site (docs/search-quality-plan.md: search_cache rows it examined). */
const LIVE_QUERIES = [
  { id: "live-soundbar", q: "סאונד בר" },
  { id: "live-drawer-organizer", q: "מארגן למגירות, עד 100 ש״ח" },
  { id: "live-sonic-doll", q: "בובת סוניק לילד" },
] as const;

type Group = "eval" | "example" | "live";

interface QuerySpec {
  id: string;
  group: Group;
  q: string;
  /** Where the query comes from, for the README and later refreshes. */
  from: string;
}

type ParseSource = "parse_cache" | "recorded" | "live";

interface LlmCallRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  usd: number | null;
}

interface ParseRecord {
  source: ParseSource;
  /** The PARSE_VERSION of the prompt that produced it. */
  parseVersion: number;
  /** parse_cache: the row's query_key and created_at. recorded: the fixture file. */
  detail: Record<string, string>;
  llmCalls: LlmCallRecord[];
  parsed: ParsedQuery;
}

interface CallRecord {
  n: number;
  step: string;
  keywords: string;
  pageNo: number;
  pageSize: number;
  sort: ProductSort;
  minPriceIls: number | null;
  maxPriceIls: number | null;
  /** The product.query params as sent (tracking id masked). */
  params: Record<string, unknown>;
  fetchedAt: string;
  /** HTTP requests this call took (2 after an ApiCallLimit retry). */
  httpRequests: number;
  requestId: string | null;
  /** Items AliExpress returned, before validation. */
  rawCount: number;
  /** Items that passed productSchema (the products below). */
  parsedCount: number;
  skipped: number;
  totalRecords: number | null;
  /**
   * total_record_count goes beyond this page, so a next page exists. Not the pipeline's rule, which
   * also needs parsedCount >= 50 (a page of 50 often brings 49 items; see simulatePipeline).
   */
  hasNextPage: boolean;
  error: string | null;
  products: AliProduct[];
}

interface PoolStats {
  /** Distinct products (first occurrence wins, as in the pipeline). */
  pool: number;
  trustStandard: number;
  trustFill: number;
  /** Distinct products that pass every filter with FILTERS (trust, price, type, requirements). */
  passFilters: number;
  /** Pass every filter with FILL_TIER but not with FILTERS. */
  passFillOnly: number;
  /** rankProducts length: FILTERS passers after near-duplicate removal. */
  ranked: number;
  rejected: Record<RejectReason, number>;
}

interface PipelineSim {
  /** The captured calls the current pipeline would make, in order. */
  steps: string[];
  /** A step the pipeline would take that the snapshot lacks (null when fully covered). */
  missing: string | null;
  checked: number;
  /** rankWithFill length: what "Y עברו" says. */
  passed: number;
  /** Of those, how many came from FILL_TIER. */
  fill: number;
  shown: number;
}

interface Snapshot {
  format: number;
  id: string;
  group: Group;
  query: string;
  queryNorm: string;
  from: string;
  /** Set when another snapshot has the same normalized query: its calls are copied, not refetched. */
  sameQueryAs: string | null;
  capturedAt: string;
  versions: { parse: number; ranking: number; explain: number };
  parse: ParseRecord;
  fetch: {
    ladder: string[];
    sort: ProductSort;
    pageSize: number;
    minPriceIls: number | null;
    maxPriceIls: number | null;
    skippedSteps: { step: string; reason: string }[];
  };
  calls: CallRecord[];
  /** Under the ranking code of the capture day (versions.ranking); --report recomputes. */
  baseline: { rankingVersion: number; snapshot: PoolStats; pipeline: PipelineSim };
}

interface IndexRow {
  id: string;
  group: Group;
  query: string;
  file: string;
  sameQueryAs: string | null;
  parseSource: ParseSource | "none";
  parseVersion: number | null;
  calls: number;
  error: string | null;
  stats: PoolStats | null;
  pipeline: PipelineSim | null;
}

interface RunRecord {
  startedAt: string;
  finishedAt: string | null;
  llmCalls: number;
  llmUsd: number;
  aliRequests: number;
  ids: string[];
}

interface Index {
  format: number;
  setDate: string;
  caps: { llmCalls: number; aliRequests: number };
  versions: { parse: number; ranking: number; explain: number };
  totals: { llmCalls: number; llmUsd: number; aliRequests: number };
  runs: RunRecord[];
  queries: IndexRow[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (n: number, digits: number) => Number(n.toFixed(digits));
const sum = (ns: number[]) => ns.reduce((s, n) => s + n, 0);
const argValue = (name: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};
const numberArg = (name: string, cap: number) => {
  const n = Number(argValue(name));
  return Number.isInteger(n) && n >= 0 ? Math.min(n, cap) : cap;
};

// ---------------------------------------------------------------- queries

function evalQueries(): QuerySpec[] {
  const text = readFileSync("scripts/eval-llm.ts", "utf8");
  const block = /export const EVAL_QUERIES = \[([\s\S]*?)\] as const;/.exec(text)?.[1] ?? "";
  const out = [...block.matchAll(/\{ id: "([^"]+)", topic: "[^"]+", q: "([^"]+)" \}/g)].map(
    (m): QuerySpec => ({ id: m[1], group: "eval", q: m[2], from: "scripts/eval-llm.ts" }),
  );
  if (out.length !== 20) throw new Error(`expected 20 EVAL_QUERIES, read ${out.length}`);
  return out;
}

function exampleQueries(): QuerySpec[] {
  const file = "components/search-guide.tsx";
  const text = readFileSync(file, "utf8");
  const full = /const FULL_EXAMPLE = "([^"]+)";/.exec(text)?.[1];
  const ideas = /const IDEAS\b[^=]*=\s*\[([\s\S]*?)\n\];/.exec(text)?.[1] ?? "";
  const qs = [...ideas.matchAll(/q: "([^"]+)"/g)].map((m) => m[1]);
  if (!full || qs.length !== 8) {
    throw new Error(
      `expected FULL_EXAMPLE and 8 IDEAS in ${file}, read ${full ? 1 : 0} + ${qs.length}`,
    );
  }
  return [full, ...qs].map((q, i) => ({
    id: `ex-${i + 1}`,
    group: "example",
    q,
    from: `${file} (${i === 0 ? "FULL_EXAMPLE" : `IDEAS[${i - 1}]`})`,
  }));
}

function allQueries(): QuerySpec[] {
  const live = LIVE_QUERIES.map((x): QuerySpec => ({
    ...x,
    group: "live",
    from: "live site (search_cache)",
  }));
  const all = [...evalQueries(), ...exampleQueries(), ...live];
  const only = argValue("--only");
  if (!only) return all;
  const ids = new Set(only.split(","));
  const picked = all.filter((x) => ids.has(x.id));
  if (picked.length !== ids.size) throw new Error("--only names an unknown query id");
  return picked;
}

// ---------------------------------------------------------------- parses (a) and (b)

const looksLikeParse = (v: unknown): v is ParsedQuery => {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.keywords_en === "string" &&
    Array.isArray(p.product_terms) &&
    Array.isArray(p.requirements) &&
    typeof p.sort_preference === "string"
  );
};

interface CachedParse {
  parsed: ParsedQuery;
  createdAt: string;
}

/** Read-only SELECT of the current parse_cache rows for these queries. */
async function readParseCache(queries: QuerySpec[]): Promise<Map<string, CachedParse>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key)
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const keys = [...new Set(queries.map((x) => queryKey(x.q)))];
  const { data, error } = await db
    .from("parse_cache")
    .select("query_key, parsed, created_at")
    .in("query_key", keys);
  if (error) throw new Error(`parse_cache read failed: ${error.message}`);
  const now = new Date();
  const out = new Map<string, CachedParse>();
  for (const row of (data ?? []) as { query_key: string; parsed: unknown; created_at: string }[]) {
    // Only what production would serve: a well-formed row within the 14-day TTL.
    if (looksLikeParse(row.parsed) && isFresh(new Date(row.created_at), now)) {
      out.set(row.query_key, { parsed: row.parsed, createdAt: row.created_at });
    }
  }
  return out;
}

interface RecordedParse {
  parsed: ParsedQuery;
  file: string;
  parseVersion: number;
  recordId: string;
}

/** normalizeQuery(query) → the most recent recorded parse of it. */
function readRecordedParses(): Map<string, RecordedParse> {
  const out = new Map<string, RecordedParse>();
  for (const { file, parseVersion } of RECORDED_PARSES) {
    const { records } = JSON.parse(readFileSync(file, "utf8")) as {
      records: { id: string; query: string; parsed?: unknown }[];
    };
    for (const r of records) {
      const norm = normalizeQuery(r.query);
      if (!out.has(norm) && looksLikeParse(r.parsed)) {
        out.set(norm, { parsed: r.parsed, file, parseVersion, recordId: r.id });
      }
    }
  }
  return out;
}

type PlannedParse =
  | { source: "kept"; record: ParseRecord; file: string; capturedAt: string }
  | { source: "parse_cache"; cached: CachedParse; key: string }
  | { source: "recorded"; recorded: RecordedParse }
  | { source: "live" };

/**
 * The parse saved in the query's existing snapshot, if any (a refresh keeps it: no LLM call). Only
 * when the snapshot was made for the same query: a home page example that changed (ex-1 held the
 * earbuds example when FULL_EXAMPLE became the smartwatch one) gets a parse of its own.
 */
function savedParse(spec: QuerySpec): Extract<PlannedParse, { source: "kept" }> | null {
  const file = `${OUT_DIR}/${spec.id}.json`;
  if (!existsSync(file)) return null;
  const snap = JSON.parse(readFileSync(file, "utf8")) as Partial<Snapshot>;
  if (snap.query === undefined || normalizeQuery(snap.query) !== normalizeQuery(spec.q))
    return null;
  return snap.parse && looksLikeParse(snap.parse.parsed)
    ? { source: "kept", record: snap.parse, file, capturedAt: snap.capturedAt ?? "?" }
    : null;
}

function planParse(
  spec: QuerySpec,
  cache: Map<string, CachedParse>,
  recorded: Map<string, RecordedParse>,
  reparse: boolean,
): PlannedParse {
  const kept = reparse ? null : savedParse(spec);
  if (kept) return kept;
  const q = spec.q;
  const key = queryKey(q);
  const cached = cache.get(key);
  if (cached) return { source: "parse_cache", cached, key };
  const rec = recorded.get(normalizeQuery(q));
  if (rec) return { source: "recorded", recorded: rec };
  return { source: "live" };
}

// ---------------------------------------------------------------- stats

function uniqueProducts(calls: Pick<CallRecord, "products">[]): AliProduct[] {
  const seen = new Map<string, AliProduct>();
  for (const c of calls)
    for (const p of c.products) if (!seen.has(p.productId)) seen.set(p.productId, p);
  return [...seen.values()];
}

function poolStats(parsed: ParsedQuery, calls: CallRecord[]): PoolStats {
  const pool = uniqueProducts(calls);
  const tiers = pool.map(trustTierOf);
  const standard = pool.filter((p) => passesFilters(p, parsed, FILTERS));
  const fillOnly = pool.filter(
    (p) => !passesFilters(p, parsed, FILTERS) && passesFilters(p, parsed, FILL_TIER),
  );
  return {
    pool: pool.length,
    trustStandard: tiers.filter((t) => t === "standard").length,
    trustFill: tiers.filter((t) => t === "fill").length,
    passFilters: standard.length,
    passFillOnly: fillOnly.length,
    ranked: rankProducts(pool, parsed).length,
    rejected: rejectionCounts(pool, parsed),
  };
}

/**
 * fetchAndRank of lib/search/pipeline.ts replayed over the captured calls: the live fetch policy
 * (CURRENT_POLICY, which runs nextFetch of lib/search/fetch-policy.ts; lib/eval/parity.test.ts
 * keeps it equal to the pipeline) and the pipeline's ranking, so this report never goes stale when
 * the fetch rules change.
 */
function simulatePipeline(parsed: ParsedQuery, calls: CallRecord[]): PipelineSim {
  const replay = replayFetch({ calls }, parsed, CURRENT_POLICY);
  const ranking = rankLikePipeline(replay.pool, parsed);
  return {
    steps: replay.calls.map((c) => c.step),
    missing: replay.missing ? `${replay.missing.keywords} (p${replay.missing.pageNo})` : null,
    checked: replay.pool.length,
    passed: ranking.passed,
    fill: ranking.fillIds.length,
    shown: Math.min(RESULTS_PER_PAGE, ranking.passed),
  };
}

// ---------------------------------------------------------------- output

/** Pretty JSON with one product per line, so a snapshot stays greppable and diffs stay small. */
function toJson(value: unknown, indent = ""): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((v) => inner + toJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    if ("productId" in value) return JSON.stringify(value);
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return "{}";
    const lines = entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${toJson(v, inner)}`);
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value) ?? "null";
}

let secrets: Record<string, string> | null = null;
function envSecrets(): Record<string, string> {
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  secrets ??= secretEnv(parseEnvFile(read(".env.local")), parseEnvFile(read(".env.example")));
  return secrets;
}
const maskText = (text: string) => maskEnvValues(text, envSecrets());

/** Writes masked JSON; refuses (and says which key) when a secret would still be in the file. */
function saveJson(path: string, value: unknown) {
  const text = `${toJson(maskEnvValuesDeep(value, envSecrets()))}\n`;
  const { leaks } = findEnvValues(text, envSecrets());
  if (leaks.length) throw new Error(`NOT SAVED ${path}: still contains ${leaks.join(", ")}`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path, text);
}

const today = () => new Date().toISOString().slice(0, 10);
const versions = () => ({
  parse: PARSE_VERSION,
  ranking: RANKING_VERSION,
  explain: EXPLAIN_VERSION,
});

function readIndex(): Index | null {
  if (!existsSync(INDEX_FILE)) return null;
  return JSON.parse(readFileSync(INDEX_FILE, "utf8")) as Index;
}

// ---------------------------------------------------------------- counted clients

class CappedLlm implements LlmProvider {
  calls = 0;
  constructor(
    private readonly inner: LlmProvider,
    readonly cap: number,
  ) {}
  get name() {
    return this.inner.name;
  }
  get model() {
    return this.inner.model;
  }
  generateStructured: LlmProvider["generateStructured"] = (req) => {
    if (this.calls >= this.cap) throw new Error(`LLM call cap ${this.cap} reached`);
    this.calls++;
    return this.inner.generateStructured(req);
  };
}

const callRecord = (model: string, usage: LlmUsage): LlmCallRecord => {
  const usd = costUsd(model, usage);
  return { model, ...usage, usd: usd === null ? null : round(usd, 6) };
};

class AliBudget {
  requests = 0;
  private lastEnd = 0;
  private lastRequestId: string | null = null;
  readonly client: AliExpressClient;

  constructor(readonly cap: number) {
    const counting: typeof fetch = async (input, init) => {
      if (this.requests >= this.cap) throw new Error(`AliExpress request cap ${this.cap} reached`);
      this.requests++;
      this.lastRequestId = null;
      try {
        const res = await fetch(input, init);
        const body = await res.clone().text();
        this.lastRequestId = /"request_id"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? null;
        return res;
      } finally {
        this.lastEnd = Date.now();
      }
    };
    // retries: 0, so every HTTP request goes through query() below and is spaced and counted.
    this.client = new AliExpressClient(aliexpressConfig(), { fetch: counting, retries: 0 });
  }

  get left() {
    return this.cap - this.requests;
  }

  /** One product.query; one retry after an ApiCallLimit ban. */
  async query(q: ProductQuery): Promise<{
    page: ProductPage | null;
    http: number;
    error: string | null;
    requestId: string | null;
  }> {
    let http = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.left <= 0)
        return { page: null, http, error: "AliExpress request cap reached", requestId: null };
      const wait = this.lastEnd + (attempt ? BAN_WAIT_MS : SPACING_MS) - Date.now();
      if (wait > 0) await sleep(wait);
      http++;
      try {
        const page = await queryProducts(this.client, q);
        return { page, http, error: null, requestId: this.lastRequestId };
      } catch (err) {
        const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        const rateLimited = err instanceof AliExpressError && err.kind === "rate_limit";
        if (rateLimited && attempt === 0) {
          console.log(`       ApiCallLimit, one retry in ${BAN_WAIT_MS} ms`);
          continue;
        }
        return {
          page: null,
          http,
          error: maskText(text).slice(0, 300),
          requestId: this.lastRequestId,
        };
      }
    }
    return { page: null, http, error: "unreachable", requestId: null };
  }
}

// ---------------------------------------------------------------- capture

async function capture(
  spec: QuerySpec,
  parse: ParseRecord,
  ali: AliBudget,
): Promise<{
  calls: CallRecord[];
  ladder: string[];
  skippedSteps: Snapshot["fetch"]["skippedSteps"];
}> {
  const parsed = parse.parsed;
  // Every keyword set the pipeline may use (keywordSteps), the parse's own keywords first.
  const ladder = keywordLadder(parsed);
  const calls: CallRecord[] = [];
  const skippedSteps: Snapshot["fetch"]["skippedSteps"] = [];
  /** "primary-p1", "primary-p2", "ladder-2" (ladder[2], page 1), "ladder-1-p2". */
  const stepName = (keywords: string, pageNo: number) => {
    const i = ladder.indexOf(keywords);
    if (i <= 0) return `primary-p${pageNo}`;
    return pageNo === 1 ? `ladder-${i}` : `ladder-${i}-p${pageNo}`;
  };

  const fetchStep = async (step: string, keywords: string, pageNo: number) => {
    const q: ProductQuery = {
      keywords,
      pageNo,
      minPriceIls: parsed.min_price_ils,
      maxPriceIls: parsed.max_price_ils,
      sort: FETCH_SORT,
    };
    const res = await ali.query(q);
    const page = res.page;
    const rawCount = page ? page.products.length + page.skipped : 0;
    const record: CallRecord = {
      n: calls.length + 1,
      step,
      keywords,
      pageNo,
      pageSize: MAX_PAGE_SIZE,
      sort: FETCH_SORT,
      minPriceIls: parsed.min_price_ils ?? null,
      maxPriceIls: parsed.max_price_ils ?? null,
      params: productQueryParams(q, TRACKING_PLACEHOLDER),
      fetchedAt: new Date().toISOString(),
      httpRequests: res.http,
      requestId: res.requestId,
      rawCount,
      parsedCount: page?.products.length ?? 0,
      skipped: page?.skipped ?? 0,
      totalRecords: page?.totalRecords ?? null,
      hasNextPage: rawCount > 0 && (page?.totalRecords ?? 0) > pageNo * MAX_PAGE_SIZE,
      error: res.error,
      products: (page?.products ?? []).map((p) => ({
        ...p,
        promotionLink: p.promotionLink ? LINK_MARKER : null,
      })),
    };
    calls.push(record);
    const status = record.error
      ? `ERROR ${record.error}`
      : `${record.parsedCount}/${record.rawCount} of ${record.totalRecords ?? "?"}`;
    console.log(
      `       ${step.padEnd(10)} "${keywords}" p${pageNo}: ${status} (${ali.requests} requests)`,
    );
    return record;
  };

  // 1. The calls the live pipeline makes (nextFetch, as fetchAndRank runs it), so the replay of
  //    today's fetch policy is never "incomplete" on a fresh snapshot.
  const pool = new Map<string, AliProduct>();
  const pages: FetchedPage[] = [];
  while (calls.length < MAX_CALLS_PER_QUERY) {
    const decision = nextFetch({ filters: parsed, calls: pages, pool: [...pool.values()] });
    if ("stop" in decision) {
      skippedSteps.push({ step: "pipeline", reason: `the live policy stops: ${decision.stop}` });
      break;
    }
    const { keywords, pageNo } = decision.step;
    const record = await fetchStep(stepName(keywords, pageNo), keywords, pageNo);
    if (record.error) return { calls, ladder, skippedSteps };
    for (const p of record.products) if (!pool.has(p.productId)) pool.set(p.productId, p);
    pages.push({
      keywords,
      pageNo,
      count: record.parsedCount,
      totalRecords: record.totalRecords,
      lowestUnitsSold: lowestUnitsSold(record.products),
    });
  }
  // 2. Up to MAX_CALLS_PER_QUERY, what other policies may ask for: page 2 of the parse's keywords
  //    (when page 1 had more records), then the broader keyword steps in order.
  const taken = (keywords: string, pageNo: number) =>
    calls.some((c) => c.keywords === keywords && c.pageNo === pageNo);
  const extras = [
    { keywords: ladder[0], pageNo: 2 },
    ...ladder.slice(1).map((keywords) => ({ keywords, pageNo: 1 })),
  ];
  for (const { keywords, pageNo } of extras) {
    if (taken(keywords, pageNo)) continue;
    const step = stepName(keywords, pageNo);
    if (calls.length >= MAX_CALLS_PER_QUERY) {
      skippedSteps.push({ step, reason: `${MAX_CALLS_PER_QUERY} calls per query` });
      continue;
    }
    const first = calls.find((c) => c.keywords === ladder[0] && c.pageNo === 1);
    if (pageNo === 2 && !first?.hasNextPage) {
      const total = first?.totalRecords ?? "?";
      skippedSteps.push({ step, reason: `page 1 was not full (${total} records)` });
      continue;
    }
    const record = await fetchStep(step, keywords, pageNo);
    if (record.error) break;
  }
  return { calls, ladder, skippedSteps };
}

function indexRow(
  spec: QuerySpec,
  snap: Snapshot | null,
  error: string | null,
  parse?: ParseRecord,
): IndexRow {
  return {
    id: spec.id,
    group: spec.group,
    query: spec.q,
    file: `${OUT_DIR}/${spec.id}.json`,
    sameQueryAs: snap?.sameQueryAs ?? null,
    parseSource: parse?.source ?? snap?.parse.source ?? "none",
    parseVersion: parse?.parseVersion ?? snap?.parse.parseVersion ?? null,
    calls: snap?.calls.length ?? 0,
    error,
    stats: snap?.baseline.snapshot ?? null,
    pipeline: snap?.baseline.pipeline ?? null,
  };
}

async function run(planOnly: boolean) {
  const specs = allQueries();
  const [cache, recorded] = [await readParseCache(specs), readRecordedParses()];
  const firstByNorm = new Map<string, string>();
  for (const s of allQueries())
    if (!firstByNorm.has(normalizeQuery(s.q))) firstByNorm.set(normalizeQuery(s.q), s.id);
  const sourceOf = (s: QuerySpec) => {
    const first = firstByNorm.get(normalizeQuery(s.q));
    return first && first !== s.id ? first : null;
  };

  const plans = specs.map((s) => ({
    spec: s,
    dupOf: sourceOf(s),
    plan: planParse(s, cache, recorded, process.argv.includes("--reparse")),
  }));
  const fresh = plans.filter((x) => !x.dupOf);
  console.log(
    `PARSE_VERSION ${PARSE_VERSION}, RANKING_VERSION ${RANKING_VERSION}, EXPLAIN_VERSION ${EXPLAIN_VERSION}`,
  );
  console.log(`\nid                     parse              version  query`);
  for (const { spec, dupOf, plan } of plans) {
    const version =
      plan.source === "kept"
        ? plan.record.parseVersion
        : plan.source === "recorded"
          ? plan.recorded.parseVersion
          : plan.source === "parse_cache"
            ? PARSE_VERSION
            : `${PARSE_VERSION}*`;
    const src = dupOf
      ? `= ${dupOf}`
      : plan.source === "kept"
        ? `${plan.record.source} (kept)`
        : plan.source;
    console.log(`${spec.id.padEnd(22)} ${src.padEnd(18)} ${String(version).padEnd(8)} ${spec.q}`);
  }
  const liveNeeded = fresh.filter((x) => x.plan.source === "live").length;
  console.log(
    `\n${plans.length} queries, ${fresh.length} to fetch (${plans.length - fresh.length} share a query). ` +
      `Live parses: ${liveNeeded} (${liveNeeded} to ${2 * liveNeeded} LLM calls with the one retry; cap ${MAX_LLM_CALLS}). ` +
      `AliExpress: at most ${fresh.length * MAX_CALLS_PER_QUERY} calls (cap ${MAX_ALI_REQUESTS} requests, retries included).`,
  );
  if (planOnly) return;

  // Resume: the same UTC day continues the set, and what it already spent counts against the caps.
  const prior = readIndex();
  const index: Index =
    prior && prior.setDate === today() && prior.format === SNAPSHOT_FORMAT
      ? prior
      : {
          format: SNAPSHOT_FORMAT,
          setDate: today(),
          caps: { llmCalls: MAX_LLM_CALLS, aliRequests: MAX_ALI_REQUESTS },
          versions: versions(),
          totals: { llmCalls: 0, llmUsd: 0, aliRequests: 0 },
          runs: [],
          queries: [],
        };
  const force = process.argv.includes("--force");
  const done = new Set(
    index.queries.filter((r) => !r.error && existsSync(r.file)).map((r) => r.id),
  );
  const llmCap = Math.max(0, numberArg("--max-llm", MAX_LLM_CALLS) - index.totals.llmCalls);
  const aliCap = Math.max(0, numberArg("--max-ali", MAX_ALI_REQUESTS) - index.totals.aliRequests);
  console.log(`This run: at most ${llmCap} LLM calls and ${aliCap} AliExpress requests.\n`);

  const ali = new AliBudget(aliCap);
  let llm: CappedLlm | null = null;
  const runRecord: RunRecord = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    llmCalls: 0,
    llmUsd: 0,
    aliRequests: 0,
    ids: [],
  };
  index.runs.push(runRecord);
  const base = {
    llm: index.totals.llmCalls,
    usd: index.totals.llmUsd,
    ali: index.totals.aliRequests,
  };
  const setRow = (row: IndexRow) => {
    index.queries = [...index.queries.filter((r) => r.id !== row.id), row];
    runRecord.ids.push(row.id);
  };
  const saveIndex = () => {
    runRecord.llmCalls = llm?.calls ?? 0;
    runRecord.aliRequests = ali.requests;
    index.totals = {
      llmCalls: base.llm + runRecord.llmCalls,
      llmUsd: round(base.usd + runRecord.llmUsd, 6),
      aliRequests: base.ali + runRecord.aliRequests,
    };
    index.versions = versions();
    saveJson(INDEX_FILE, index);
  };

  let failuresInARow = 0;
  try {
    for (const { spec, dupOf, plan } of plans) {
      if (dupOf) continue; // copied after its source below
      if (done.has(spec.id) && !force) {
        console.log(`${spec.id}: already saved today, skipped`);
        continue;
      }
      console.log(`${spec.id} (${plan.source}): ${spec.q}`);
      let parse: ParseRecord | null = null;
      if (plan.source === "kept") {
        // Its llmCalls were paid when the parse was made; this set's ledger does not count them.
        parse = {
          ...plan.record,
          detail: { ...plan.record.detail, keptFrom: `${plan.file} (${plan.capturedAt})` },
        };
      } else if (plan.source === "parse_cache") {
        parse = {
          source: "parse_cache",
          parseVersion: PARSE_VERSION,
          detail: { queryKey: plan.key, createdAt: plan.cached.createdAt },
          llmCalls: [],
          parsed: plan.cached.parsed,
        };
      } else if (plan.source === "recorded") {
        parse = {
          source: "recorded",
          parseVersion: plan.recorded.parseVersion,
          detail: { file: plan.recorded.file, recordId: plan.recorded.recordId },
          llmCalls: [],
          parsed: plan.recorded.parsed,
        };
      } else {
        if (!llm) {
          const cfg = llmConfig();
          llm = new CappedLlm(
            new AnthropicProvider(cfg.apiKey, cfg.model, { maxRetries: 0 }),
            llmCap,
          );
        }
        const left = llm.cap - llm.calls;
        if (left <= 0) {
          console.log(`       skipped: no LLM calls left under the cap`);
          setRow(indexRow(spec, null, "skipped: LLM call cap"));
          saveIndex();
          continue;
        }
        try {
          const res = await parseQuery(llm, spec.q, { maxAttempts: Math.min(2, left) });
          const llmCalls = res.usage.map((u) => callRecord(res.model, u));
          runRecord.llmUsd = round(runRecord.llmUsd + sum(llmCalls.map((c) => c.usd ?? 0)), 6);
          console.log(
            `       live parse: ${llmCalls.length} call(s), $${sum(llmCalls.map((c) => c.usd ?? 0)).toFixed(5)}`,
          );
          if (res.parsed) {
            parse = {
              source: "live",
              parseVersion: PARSE_VERSION,
              detail: { model: res.model },
              llmCalls,
              parsed: res.parsed,
            };
          } else {
            setRow(indexRow(spec, null, "live parse returned no usable filters"));
          }
        } catch (err) {
          const text = maskText(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
          console.log(`       live parse failed: ${text.slice(0, 200)}`);
          setRow(indexRow(spec, null, `live parse failed: ${text.slice(0, 200)}`));
        }
        saveIndex();
        if (!parse) continue;
      }

      const { calls, ladder, skippedSteps } = await capture(spec, parse, ali);
      const error = calls.find((c) => c.error)?.error ?? null;
      const snap: Snapshot = {
        format: SNAPSHOT_FORMAT,
        id: spec.id,
        group: spec.group,
        query: spec.q,
        queryNorm: normalizeQuery(spec.q),
        from: spec.from,
        sameQueryAs: null,
        capturedAt: new Date().toISOString(),
        versions: versions(),
        parse,
        fetch: {
          ladder,
          sort: FETCH_SORT,
          pageSize: MAX_PAGE_SIZE,
          minPriceIls: parse.parsed.min_price_ils ?? null,
          maxPriceIls: parse.parsed.max_price_ils ?? null,
          skippedSteps,
        },
        calls,
        baseline: {
          rankingVersion: RANKING_VERSION,
          snapshot: poolStats(parse.parsed, calls),
          pipeline: simulatePipeline(parse.parsed, calls),
        },
      };
      if (calls.some((c) => !c.error)) saveJson(`${OUT_DIR}/${spec.id}.json`, snap);
      setRow(indexRow(spec, calls.some((c) => !c.error) ? snap : null, error));
      saveIndex();
      const s = snap.baseline.snapshot;
      console.log(
        `       pool ${s.pool}, pass FILTERS ${s.passFilters}, FILL_TIER only ${s.passFillOnly}, ranked ${s.ranked}`,
      );
      failuresInARow = error ? failuresInARow + 1 : 0;
      if (ali.left <= 0) {
        console.log("AliExpress request cap reached: stopping.");
        break;
      }
      if (failuresInARow >= 2) {
        console.log("Two queries in a row failed at AliExpress: stopping.");
        break;
      }
    }

    // Queries that share a normalized query with an earlier one reuse its snapshot, no calls.
    for (const { spec, dupOf } of plans) {
      if (!dupOf) continue;
      const sourceFile = `${OUT_DIR}/${dupOf}.json`;
      if (!existsSync(sourceFile)) {
        console.log(`${spec.id}: source ${dupOf} has no snapshot, skipped`);
        continue;
      }
      const src = JSON.parse(readFileSync(sourceFile, "utf8")) as Snapshot;
      const snap: Snapshot = {
        ...src,
        id: spec.id,
        group: spec.group,
        query: spec.q,
        from: spec.from,
        sameQueryAs: dupOf,
      };
      saveJson(`${OUT_DIR}/${spec.id}.json`, snap);
      setRow(indexRow(spec, snap, null));
      console.log(`${spec.id}: same query as ${dupOf}, copied (no calls)`);
    }
  } finally {
    runRecord.finishedAt = new Date().toISOString();
    saveIndex();
    console.log(
      `\nThis run: ${llm?.calls ?? 0} LLM calls ($${runRecord.llmUsd.toFixed(5)}), ${ali.requests} AliExpress requests. ` +
        `Set totals: ${index.totals.llmCalls} LLM calls ($${index.totals.llmUsd.toFixed(5)}), ${index.totals.aliRequests} requests.`,
    );
  }
  report();
}

// ---------------------------------------------------------------- report

function report() {
  const index = readIndex();
  if (!index) throw new Error(`no ${INDEX_FILE}; run the capture first`);
  const header = [
    ["id", 22],
    ["parse", 12],
    ["calls", 5],
    ["pool", 4],
    ["trust", 7],
    ["passF", 5],
    ["+fill", 5],
    ["ranked", 6],
    ["pipeline calls", 30],
    ["chk", 3],
    ["pass", 4],
    ["fill", 4],
  ] as const;
  const line = header.map(([name, w]) => name.padEnd(w)).join(" | ");
  console.log(
    `\nRANKING_VERSION ${RANKING_VERSION} (snapshots captured under ${index.versions.ranking})`,
  );
  console.log(`${line}\n${"-".repeat(line.length)}`);
  for (const row of index.queries.sort((a, b) => a.file.localeCompare(b.file))) {
    if (!existsSync(row.file)) {
      console.log(`${row.id.padEnd(22)} | ${row.error ?? "no snapshot"}`);
      continue;
    }
    const snap = JSON.parse(readFileSync(row.file, "utf8")) as Snapshot;
    const s = poolStats(snap.parse.parsed, snap.calls);
    const p = simulatePipeline(snap.parse.parsed, snap.calls);
    const cells = [
      snap.id,
      `${snap.parse.source === "parse_cache" ? "cache" : snap.parse.source} v${snap.parse.parseVersion}`,
      String(snap.calls.length),
      String(s.pool),
      `${s.trustStandard}+${s.trustFill}`,
      String(s.passFilters),
      String(s.passFillOnly),
      String(s.ranked),
      (p.missing ? `MISSING ${p.missing}` : p.steps.join(",")).slice(0, 30),
      String(p.checked),
      String(p.passed),
      String(p.fill),
    ];
    console.log(cells.map((c, i) => c.padEnd(header[i][1])).join(" | "));
  }
  console.log(
    `\nSet ${index.setDate}: ${index.totals.llmCalls} LLM calls ($${index.totals.llmUsd.toFixed(5)}), ` +
      `${index.totals.aliRequests} AliExpress requests.`,
  );
}

const planOnly = process.argv.includes("--plan");
const main = process.argv.includes("--report") ? async () => report() : () => run(planOnly);
main().catch((err) => {
  console.error(
    "FAILED:",
    maskText(err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
  );
  process.exit(1);
});
