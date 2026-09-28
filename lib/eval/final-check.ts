// The final paid check (docs/search-quality-plan.md A11): `scripts/eval-llm.ts --final` runs the
// 20 eval queries and the 9 home page examples through the real pipeline with an in-memory store.
// The owner session runs it; this module is its free part, tested without any call:
// - the queries (the examples are read from components/search-guide.tsx as text, never imported);
// - the plan: the most LLM and AliExpress requests a run may make, printed before any call;
// - the hard caps that hold it, retries counted: the LLM provider is wrapped so the SDK never
//   retries on its own (every try takes one request from the cap, and the one past the cap throws
//   before it is sent), and AliExpress requests are counted at fetch, which the client's retries
//   pass through too;
// - the metrics the offline replay reports (lib/eval/report.ts), built from the live results, so
//   both runs compare query by query, and checks of the Hebrew lines the cards show.
import { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { WHY_MAX, WHY_MIN, whyFromData, type ExplainInput } from "@/lib/llm/explain";
import { PARSE_VERSION } from "@/lib/llm/parse";
import type { LlmProvider, StructuredRequest, StructuredResult } from "@/lib/llm/provider";
import {
  hasForeignScript,
  hasForeignWord,
  hasGarbledWord,
  hasMixedScript,
  mentionsBudget,
  usesSingularAddress,
  writesPrice,
} from "@/lib/llm/text-checks";
import { trustTierOf, type RejectReason } from "@/lib/ranking/rank";
import { normalizeQuery, queryKey } from "@/lib/search/cache-key";
import { MAX_ALI_CALLS } from "@/lib/search/fetch-policy";
import type { ParsedQuery } from "@/lib/search/filters";
import { LLM_STAGE_LIMITS, type SearchMeta } from "@/lib/search/pipeline";
import type { ResultProduct, SearchResponse } from "@/lib/types";
import type { z } from "zod";
import type { LabelEntry } from "./labels";
import { cardMetrics, maxSameShop, type ProductLine, type QueryResult } from "./replay";

// ---------------------------------------------------------------- queries

export type FinalGroup = "eval" | "example";

export interface FinalQuery {
  id: string;
  group: FinalGroup;
  q: string;
  /** Where the query is written. */
  from: string;
}

export const EXAMPLES_FILE = "components/search-guide.tsx";

/**
 * The 9 home page examples, as ex-1..ex-9 (the order scripts/snapshot-pools.ts names them in):
 * FULL_EXAMPLE (the full example of the FAQ's "איך מחפשים נכון?", components/home-faq.tsx, and the
 * composer's placeholder), then the 8 IDEAS ("רעיונות לחיפוש"). Read from the file's text, like
 * snapshot-pools.ts does: the component is never imported.
 */
export function exampleQueries(text: string, file = EXAMPLES_FILE): FinalQuery[] {
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

/** The 20 eval queries, then the 9 examples. Ids must be unique. */
export function finalQueries(
  evalQueries: readonly { id: string; q: string }[],
  examples: FinalQuery[],
  evalFile = "scripts/eval-llm.ts",
): FinalQuery[] {
  const all: FinalQuery[] = [
    ...evalQueries.map((x): FinalQuery => ({ id: x.id, group: "eval", q: x.q, from: evalFile })),
    ...examples,
  ];
  const seen = new Set<string>();
  for (const x of all) {
    if (seen.has(x.id)) throw new Error(`query id ${x.id} appears twice`);
    seen.add(x.id);
  }
  return all;
}

// ---------------------------------------------------------------- plan

export interface Caps {
  llmRequests: number;
  aliRequests: number;
}

/**
 * Hard caps for one day's final check. LLM: the plan's ~58 calls (29 searches, a parse and an
 * explain each) plus a little room for retries. AliExpress: the plan's "up to 87" (29 x 3
 * product.query), which the owner approved.
 */
export const FINAL_CAPS: Caps = { llmRequests: 60, aliRequests: 87 };

/** parseQuery's attempts (lib/llm/parse.ts): one, plus one retry on unusable output. */
export const PARSE_ATTEMPTS = 2;
/** The eval's AliExpressClient retries (the client's default): up to 3 requests per call. */
export const ALI_RETRIES = 2;
/** ensureLinks (lib/search/pipeline.ts): at most one link.generate call (12 products, one batch). */
export const LINK_CALLS_PER_SEARCH = 1;
/** Per call, from llm_usage (Haiku 4.5, 2026-09-28; docs/search-quality-plan.md): estimates. */
export const UNIT_USD = { parse: 0.00195, explain: 0.00263 } as const;

/** The most requests one search can make, from the pipeline's own limits. */
export interface SearchBound {
  llm: { parse: number; explain: number; total: number };
  ali: { calls: number; tries: number; total: number };
}

export function searchBound(): SearchBound {
  const parse = PARSE_ATTEMPTS * (1 + LLM_STAGE_LIMITS.parse.maxRetries);
  const explain = 1 + LLM_STAGE_LIMITS.explain.maxRetries;
  const calls = MAX_ALI_CALLS + LINK_CALLS_PER_SEARCH;
  const tries = 1 + ALI_RETRIES;
  return {
    llm: { parse, explain, total: parse + explain },
    ali: { calls, tries, total: calls * tries },
  };
}

export interface PlannedQuery extends FinalQuery {
  /** queryKey(q): queries with one key share one parse, so one search. */
  key: string;
  /**
   * The first query of the whole list with the same key: this one copies its record, no search of
   * its own (also when --only selects it: its source is searched instead).
   */
  sameAs: string | null;
  /** Recorded by an earlier run of this check: not searched again. */
  done: boolean;
}

export interface Budget {
  cap: number;
  /** Requests earlier runs of this check made, on any day (they count against the cap). */
  used: number;
  left: number;
  /** What the searches to run could ask for without the cap. */
  uncapped: number;
  /** The most this run can make: the smaller of `left` and `uncapped`. */
  max: number;
  /** The most without a retry (and, for the LLM, without an unusable answer), within the cap. */
  noRetries: number;
}

export interface FinalPlan {
  /** Every query of the check, selected or not (copies are decided over the whole list). */
  queries: PlannedQuery[];
  /** The ids --only selected, or null for the whole list. */
  selected: string[] | null;
  /** Ids this run searches, in order. */
  toRun: string[];
  bound: SearchBound;
  llm: Budget;
  ali: Budget;
  /** A parse and an explain call per search to run, at UNIT_USD. */
  expectedUsd: number;
}

/**
 * The run over `queries` (the whole list). A query whose parse key an earlier one has is a copy of
 * it, decided over the whole list, so `only` (--only) runs exactly what the full run would: a
 * selected copy searches its source. Throws on an id `only` names that the list lacks.
 */
export function planFinalRun(
  queries: FinalQuery[],
  {
    caps = FINAL_CAPS,
    used = { llm: 0, ali: 0 },
    done = new Set<string>(),
    only = null,
  }: {
    caps?: Caps;
    used?: { llm: number; ali: number };
    done?: ReadonlySet<string>;
    only?: ReadonlySet<string> | null;
  } = {},
): FinalPlan {
  const firstByKey = new Map<string, string>();
  const planned = queries.map((x): PlannedQuery => {
    const key = queryKey(x.q);
    const first = firstByKey.get(key) ?? null;
    if (!first) firstByKey.set(key, x.id);
    return { ...x, key, sameAs: first, done: done.has(x.id) };
  });
  const unknown = [...(only ?? [])].filter((id) => !planned.some((p) => p.id === id));
  if (unknown.length) throw new Error(`--only names an unknown query id: ${unknown.join(", ")}`);
  const wanted = only
    ? new Set(planned.filter((p) => only.has(p.id)).map((p) => p.sameAs ?? p.id))
    : null;
  const toRun = planned
    .filter((p) => !p.done && p.sameAs === null && (!wanted || wanted.has(p.id)))
    .map((p) => p.id);
  const bound = searchBound();
  const budget = (cap: number, usedSoFar: number, perSearch: number, perSearchNoRetry: number) => {
    const left = Math.max(0, cap - usedSoFar);
    const uncapped = toRun.length * perSearch;
    return {
      cap,
      used: usedSoFar,
      left,
      uncapped,
      max: Math.min(left, uncapped),
      noRetries: Math.min(left, toRun.length * perSearchNoRetry),
    };
  };
  return {
    queries: planned,
    selected: only ? planned.filter((p) => only.has(p.id)).map((p) => p.id) : null,
    toRun,
    bound,
    llm: budget(caps.llmRequests, used.llm, bound.llm.total, 2),
    ali: budget(caps.aliRequests, used.ali, bound.ali.total, bound.ali.calls),
    expectedUsd: round(toRun.length * (UNIT_USD.parse + UNIT_USD.explain), 4),
  };
}

const round = (n: number, digits: number) => Number(n.toFixed(digits));

/** The plan as printed before any call (and by --plan). Plain ASCII: ids and numbers only. */
export function formatPlan(plan: FinalPlan): string {
  const { bound, llm, ali } = plan;
  const count = (g: FinalGroup) => plan.queries.filter((q) => q.group === g).length;
  const copies = plan.queries.filter((q) => q.sameAs !== null);
  const done = plan.queries.filter((q) => q.done);
  const lines = [
    `Final check: ${plan.queries.length} queries (${count("eval")} eval, ${count("example")} home examples); ` +
      `${plan.toRun.length} to search now, ${copies.length} same as an earlier query, ${done.length} recorded by earlier runs.`,
  ];
  if (copies.length) {
    lines.push(`  Copied, not searched: ${copies.map((q) => `${q.id} = ${q.sameAs}`).join(", ")}.`);
  }
  if (plan.selected) {
    lines.push(
      `  Selected with --only: ${plan.selected.join(", ")}; searched for them: ${plan.toRun.join(", ") || "none"}.`,
    );
  }
  lines.push(
    `  Most per search: LLM ${bound.llm.total} requests (parse ${PARSE_ATTEMPTS} attempts x ` +
      `${1 + LLM_STAGE_LIMITS.parse.maxRetries} tries, explain ${bound.llm.explain}); AliExpress ` +
      `${bound.ali.total} requests (${MAX_ALI_CALLS} product.query + ${LINK_CALLS_PER_SEARCH} link.generate, ` +
      `${bound.ali.tries} tries each).`,
    `  LLM requests:        at most ${llm.max} (hard cap ${llm.cap} for the whole check, ${llm.used} used by earlier runs; ` +
      `the searches could ask for ${llm.uncapped}). Without retries: ${llm.noRetries}, about $${plan.expectedUsd.toFixed(3)}.`,
    `  AliExpress requests: at most ${ali.max} (hard cap ${ali.cap} for the whole check, ${ali.used} used by earlier runs; ` +
      `the searches could ask for ${ali.uncapped}). Without retries: at most ${ali.noRetries}.`,
    `  The request past a cap is never sent: the query it belongs to is recorded as capped and the run stops.`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------- hard caps

export class RequestCapError extends Error {
  constructor(
    readonly what: string,
    readonly cap: number,
  ) {
    super(`${what} request cap ${cap} reached: the request was not sent`);
    this.name = "RequestCapError";
  }
}

/**
 * Counts requests; take() before each one throws once `cap` were made. `onTake` is told of every
 * request before it is sent, so the ledger (FinalLedger) holds it even if the process then dies.
 */
export class RequestCap {
  used: number;
  /** Requests refused at the cap (none of them was sent). */
  refused = 0;

  constructor(
    readonly what: string,
    readonly cap: number,
    used = 0,
    private readonly onTake: (used: number) => void = () => {},
  ) {
    this.used = used;
  }

  get left(): number {
    return Math.max(0, this.cap - this.used);
  }

  take(): void {
    if (this.used >= this.cap) {
      this.refused++;
      throw new RequestCapError(this.what, this.cap);
    }
    this.used++;
    // Recorded before the request goes out; a failure to record stops it (thrown, never sent).
    this.onTake(this.used);
  }
}

// ---------------------------------------------------------------- ledger

/** One run of the final check, as the ledger records it. */
export interface LedgerRun {
  startedAt: string;
  /** The last request or query of the run. */
  updatedAt: string;
  llmRequests: number;
  aliRequests: number;
  /** Queries the run searched (their ids only). */
  ids: string[];
}

/**
 * Every request the final check made, over all its runs and days: FINAL_CAPS hold for the whole
 * check the owner approved, not per day. Written at every request (RequestCap's onTake), apart from
 * the results file, so a run cut short or a results file refused for a leak still counts what it
 * sent. Counts, times and query ids only: nothing in it can hold an env value.
 */
export interface FinalLedger {
  kind: typeof LEDGER_KIND;
  format: typeof LEDGER_FORMAT;
  caps: Caps;
  llmRequests: number;
  aliRequests: number;
  runs: LedgerRun[];
}

export const LEDGER_KIND = "final-check-ledger";
export const LEDGER_FORMAT = 1;

export function emptyLedger(caps: Caps = FINAL_CAPS): FinalLedger {
  return {
    kind: LEDGER_KIND,
    format: LEDGER_FORMAT,
    caps,
    llmRequests: 0,
    aliRequests: 0,
    runs: [],
  };
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/**
 * The ledger from its file's text. Throws when it cannot be read as one: the requests it recorded
 * count against the caps, and are never guessed.
 */
export function parseLedger(text: string, path = "the ledger"): FinalLedger {
  let data: Partial<FinalLedger> | null = null;
  try {
    data = JSON.parse(text) as Partial<FinalLedger>;
  } catch {
    // Reported below.
  }
  if (
    !data ||
    data.kind !== LEDGER_KIND ||
    data.format !== LEDGER_FORMAT ||
    !isCount(data.llmRequests) ||
    !isCount(data.aliRequests) ||
    !Array.isArray(data.runs)
  ) {
    throw new Error(`${path} is not a final-check ledger of format ${LEDGER_FORMAT}`);
  }
  return data as FinalLedger;
}

/**
 * A ledger for results files written before the ledger existed: the sum of the requests each one
 * recorded (their `ledger` field), so a check started then keeps counting them.
 */
export function ledgerFromResults(
  files: readonly { ledger?: { llmRequests?: unknown; aliRequests?: unknown } }[],
  caps: Caps = FINAL_CAPS,
): FinalLedger {
  const ledger = emptyLedger(caps);
  for (const f of files) {
    const { llmRequests, aliRequests } = f.ledger ?? {};
    if (!isCount(llmRequests) || !isCount(aliRequests)) {
      throw new Error("a final-check results file has no readable request counts");
    }
    ledger.llmRequests += llmRequests;
    ledger.aliRequests += aliRequests;
  }
  return ledger;
}

/** Errors the Anthropic SDK itself would retry: no connection, a timeout, 408, 409, 429, 5xx. */
export function isRetryableLlmError(err: unknown): boolean {
  if (err instanceof APIConnectionError) return true;
  if (err instanceof APIError && typeof err.status === "number") {
    const s = err.status;
    return s === 408 || s === 409 || s === 429 || s >= 500;
  }
  return false;
}

export interface CappedLlmOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Wait before the 1st, 2nd, ... retry (the last value repeats). */
  retryDelaysMs?: readonly number[];
  /** Retries of a request that names none (the pipeline always names them). */
  defaultRetries?: number;
}

/**
 * The provider with every request counted against `cap`, retries included: each try is sent with
 * maxRetries 0, and a retryable failure is tried again here, up to the request's own maxRetries
 * (LLM_STAGE_LIMITS). The request past the cap throws RequestCapError without being sent.
 */
export class CappedLlm implements LlmProvider {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly delays: readonly number[];
  private readonly defaultRetries: number;

  constructor(
    private readonly inner: LlmProvider,
    readonly cap: RequestCap,
    options: CappedLlmOptions = {},
  ) {
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.delays = options.retryDelaysMs?.length ? options.retryDelaysMs : [1_000, 2_000];
    this.defaultRetries = options.defaultRetries ?? 0;
  }

  get name() {
    return this.inner.name;
  }

  get model() {
    return this.inner.model;
  }

  async generateStructured<T extends z.ZodType>(
    req: StructuredRequest<T>,
  ): Promise<StructuredResult<z.infer<T>>> {
    const tries = 1 + Math.max(0, req.maxRetries ?? this.defaultRetries);
    for (let attempt = 1; ; attempt++) {
      this.cap.take();
      try {
        return await this.inner.generateStructured({ ...req, maxRetries: 0 });
      } catch (err) {
        if (attempt >= tries || !isRetryableLlmError(err)) throw err;
        await this.sleep(this.delays[Math.min(attempt, this.delays.length) - 1]);
      }
    }
  }
}

/** `inner` with every request counted against `cap`; the request past the cap is never sent. */
export function cappedFetch(cap: RequestCap, inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    cap.take();
    return inner(input, init);
  };
}

// ---------------------------------------------------------------- records

/** A kept product as the report needs it: AliExpress's numbers, no link. */
export interface KeptProduct {
  id: string;
  title: string;
  shop: string | null;
  price: number;
  currency: string;
  feedbackPct: number | null;
  unitsSold: number | null;
  tier: "standard" | "fill";
  category: { first: string | null; second: string | null };
}

export function keptProducts(products: readonly AliProduct[]): KeptProduct[] {
  return products.map((p) => ({
    id: p.productId,
    title: p.title,
    shop: p.shop.id,
    price: p.price,
    currency: p.currency,
    feedbackPct: p.positiveFeedbackPct,
    unitsSold: p.unitsSold,
    tier: trustTierOf(p) === "fill" ? "fill" : "standard",
    category: { first: p.category.firstName, second: p.category.secondName },
  }));
}

export interface FinalRecord {
  id: string;
  group: FinalGroup;
  query: string;
  from: string;
  /** A copy of an earlier query with the same parse key (not searched again). */
  sameAs?: string;
  ms?: number;
  /** Requests this search made, retries included. */
  llmRequests?: number;
  aliRequests?: number;
  /** Cost of its LLM calls (lib/llm/pricing.ts); null for a model without a price. */
  usd?: number | null;
  parsed?: ParsedQuery | null;
  meta?: SearchMeta;
  response?: SearchResponse;
  /** The ranked products kept for the search (up to RESULTS_KEPT), in order. */
  kept?: KeptProduct[];
  /** A cap was reached during this search: its numbers are not a real search's. */
  capped?: "llm" | "aliexpress";
  error?: string;
}

/** A record that holds a finished search (a capped one does not count). */
export const isDone = (r: FinalRecord): boolean =>
  r.response !== undefined && r.meta !== undefined && r.capped === undefined;

const NO_REJECTIONS: Record<RejectReason, number> = {
  feedback: 0,
  volume: 0,
  currency: 0,
  price: 0,
  type: 0,
  requirement: 0,
};

/**
 * The live search in the offline report's shape (lib/eval/replay.ts QueryResult), so summarize,
 * totalsOf and compareRuns (lib/eval/report.ts) read it as they read a replay. `labels` are the
 * snapshot labels of the same query text (labelsForQuery). The whole-pool label metrics
 * (type-gate misses, false positives) need a snapshot pool and stay empty here.
 */
export function liveQueryResult(
  rec: FinalRecord,
  labels: Map<string, LabelEntry> | null,
): QueryResult {
  const head = {
    id: rec.id,
    group: rec.group,
    query: rec.query,
    sameQueryAs: rec.sameAs ?? null,
    parseVersion: PARSE_VERSION,
    snapshotPool: 0,
  };
  if (!isDone(rec) || !rec.response || !rec.meta) {
    return {
      ...head,
      error: rec.capped ? `capped (${rec.capped})` : (rec.error ?? "no result"),
      sort: null,
      fetch: { steps: [], calls: 0, missing: null },
      checked: 0,
      passed: 0,
      fill: 0,
      shown: 0,
      moreAvailable: false,
      top3: [],
      next3: [],
      sameShopTop3: 0,
      budgetShare: null,
      rejected: { ...NO_REJECTIONS },
      labels: null,
    };
  }
  const { response, meta } = rec;
  const kept = rec.kept ?? [];
  const byId = new Map(kept.map((k) => [k.id, k]));
  const label = (id: string) => labels?.get(id)?.label ?? null;
  const shownLine = (r: ResultProduct): ProductLine => {
    const k = byId.get(r.product_id);
    return {
      id: r.product_id,
      label: label(r.product_id),
      tier: r.passed_tier === "fill" ? "fill" : "standard",
      shop: k?.shop ?? null,
      price: r.price_ils,
      feedbackPct: r.positive_feedback_pct,
      unitsSold: r.units_sold,
      title: r.title_en,
    };
  };
  const keptLine = (k: KeptProduct): ProductLine => ({
    id: k.id,
    label: label(k.id),
    tier: k.tier,
    shop: k.shop,
    price: k.price,
    feedbackPct: k.feedbackPct,
    unitsSold: k.unitsSold,
    title: k.title,
  });
  const top3 = response.results.map(shownLine);
  const shownIds = new Set(top3.map((l) => l.id));
  const next3 = kept
    .filter((k) => !shownIds.has(k.id))
    .slice(0, RESULTS_PER_PAGE)
    .map(keptLine);
  const max = rec.parsed?.max_price_ils;
  return {
    ...head,
    error: null,
    sort: response.sort,
    fetch: { steps: [...meta.keywordsTried], calls: meta.aliCalls, missing: null },
    checked: response.checked_count,
    passed: response.passed_count,
    fill: kept.filter((k) => k.tier === "fill").length,
    shown: top3.length,
    moreAvailable: response.more_available,
    top3,
    next3,
    sameShopTop3: maxSameShop(top3.map((l) => ({ shop: { id: l.shop, name: null, url: null } }))),
    budgetShare:
      max !== undefined && top3.length
        ? Math.round((top3.reduce((s, l) => s + l.price, 0) / top3.length / max) * 100) / 100
        : null,
    rejected: meta.rejected ?? { ...NO_REJECTIONS },
    labels: labels
      ? {
          count: labels.size,
          ...cardMetrics(top3, [...top3, ...next3]),
          typeFalseNegatives: [],
          typeFalseNegativesBlocking: [],
          falsePositives: [],
          unknownIds: [],
        }
      : null,
  };
}

/**
 * The snapshot of the same query text (normalizeQuery), preferring the one the others copy: its
 * id names the labels and the offline replay of that query. Snapshot ids follow the example order
 * of the day they were captured, so ids alone would pair the wrong queries.
 */
export function snapshotForQuery<
  S extends { id: string; query: string; sameQueryAs: string | null },
>(snapshots: readonly S[], q: string): S | null {
  const norm = normalizeQuery(q);
  const same = snapshots.filter((s) => normalizeQuery(s.query) === norm);
  return same.find((s) => !s.sameQueryAs) ?? same[0] ?? null;
}

// ---------------------------------------------------------------- Hebrew line checks

export type LineProblem =
  /** why_he is the sentence built from the data: the model's line was rejected or not written. */
  | "data_line"
  /** title_he has no Hebrew letter: the card shows AliExpress's English title. */
  | "english_title"
  /** An ASCII quote inside a Hebrew word (ס"מ): the site writes ״ and ׳. */
  | "ascii_quote"
  | "exclamation"
  | "emoji"
  | "foreign_script"
  | "mixed_script"
  | "foreign_word"
  | "singular_address"
  | "garbled_word"
  | "price_written"
  | "unstated_budget"
  | "length"
  /** The same line as an earlier card of the page, once its numbers are set aside. */
  | "repeated_line";

/** Problems that make a card count as a copy defect (the gate's "at most 10%"). */
export const DEFECTS: ReadonlySet<LineProblem> = new Set<LineProblem>([
  "english_title",
  "ascii_quote",
  "exclamation",
  "emoji",
  "foreign_script",
  "mixed_script",
  "foreign_word",
  "singular_address",
  "garbled_word",
  "price_written",
  "unstated_budget",
  "length",
  "repeated_line",
]);

const HEBREW = /[א-ת]/;
const ASCII_QUOTE_IN_WORD = /[א-ת]["'][א-ת]/;
const EMOJI = /\p{Extended_Pictographic}/u;

function styleProblems(text: string): LineProblem[] {
  const out: LineProblem[] = [];
  if (ASCII_QUOTE_IN_WORD.test(text)) out.push("ascii_quote");
  if (text.includes("!")) out.push("exclamation");
  if (EMOJI.test(text)) out.push("emoji");
  if (hasForeignScript(text)) out.push("foreign_script");
  if (hasMixedScript(text)) out.push("mixed_script");
  if (hasGarbledWord(text)) out.push("garbled_word");
  return out;
}

const withoutNumbers = (s: string) =>
  s
    .replace(/[\d.,%₪]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

export interface CardLines {
  productId: string;
  problems: LineProblem[];
}

/**
 * Checks of the lines the shown cards carry, with the text checks the explain step uses
 * (lib/llm/text-checks.ts) plus the style rules of the site (no ASCII quotes, exclamation marks or
 * emoji). A line built from the data is only marked as such: it is true by construction.
 */
export function checkCardLines(
  results: readonly ResultProduct[],
  context: {
    /** The search stated a budget (max_price_ils): "תקציב" may appear. */
    hasBudget: boolean;
    /** Products whose line failed the explain step's checks (SearchMeta.explainRejected). */
    rejectedIds?: ReadonlySet<string>;
    /** The explain call failed: every line is built from the data. */
    explainFailed?: boolean;
  },
): CardLines[] {
  const seen = new Set<string>();
  return results.map((r) => {
    const problems = new Set<LineProblem>();
    const input: ExplainInput = {
      product_id: r.product_id,
      title_en: r.title_en,
      price_ils: r.price_ils,
      original_price_ils: r.original_price_ils,
      discount_pct: r.discount_pct,
      positive_feedback_pct: r.positive_feedback_pct,
      units_sold_30d: r.units_sold,
      ...(r.shared_numbers ? { shared_numbers: r.shared_numbers } : {}),
    };
    // The data sentence leaves out a number other listings of the shop show too.
    const dataLines = [whyFromData(input), whyFromData({ ...input, shared_numbers: undefined })];
    const fromData =
      context.explainFailed === true ||
      context.rejectedIds?.has(r.product_id) === true ||
      dataLines.includes(r.why_he);
    if (fromData) {
      problems.add("data_line");
    } else {
      const why = r.why_he;
      for (const p of styleProblems(why)) problems.add(p);
      if (hasForeignWord(why, r.title_en)) problems.add("foreign_word");
      if (usesSingularAddress(why)) problems.add("singular_address");
      if (writesPrice(why)) problems.add("price_written");
      if (mentionsBudget(why) && !context.hasBudget) problems.add("unstated_budget");
      if (why.length < WHY_MIN || why.length > WHY_MAX) problems.add("length");
      const plain = withoutNumbers(why);
      if (seen.has(plain)) problems.add("repeated_line");
      seen.add(plain);
    }
    const title = r.title_he;
    if (!HEBREW.test(title)) {
      problems.add("english_title");
    } else {
      for (const p of styleProblems(title)) problems.add(p);
      if (hasForeignWord(title, r.title_en)) problems.add("foreign_word");
    }
    return { productId: r.product_id, problems: [...problems] };
  });
}

/** The card line checks of one finished record. */
export function recordLines(rec: FinalRecord): CardLines[] {
  if (!isDone(rec) || !rec.response || !rec.meta) return [];
  return checkCardLines(rec.response.results, {
    hasBudget: rec.parsed?.max_price_ils !== undefined,
    rejectedIds: new Set(rec.meta.explainRejected.map((x) => x.product_id)),
    explainFailed: rec.meta.explainFailed === true,
  });
}

export interface LineSummary {
  /** Distinct searches (copies left out: they show the same cards). */
  queries: number;
  cards: number;
  dataLines: number;
  englishTitles: number;
  cardsWithDefect: number;
  /** cardsWithDefect / cards, rounded to 3 places; null without cards. */
  defectRate: number | null;
  byProblem: Partial<Record<LineProblem, number>>;
  /** Each card with a defect: query id, product id and its problems. */
  defects: { id: string; productId: string; problems: LineProblem[] }[];
}

export function summarizeLines(records: readonly FinalRecord[]): LineSummary {
  const own = records.filter((r) => !r.sameAs && isDone(r));
  const byProblem: Partial<Record<LineProblem, number>> = {};
  const defects: LineSummary["defects"] = [];
  let cards = 0;
  for (const rec of own) {
    for (const card of recordLines(rec)) {
      cards++;
      for (const p of card.problems) byProblem[p] = (byProblem[p] ?? 0) + 1;
      const bad = card.problems.filter((p) => DEFECTS.has(p));
      if (bad.length) defects.push({ id: rec.id, productId: card.productId, problems: bad });
    }
  }
  return {
    queries: own.length,
    cards,
    dataLines: byProblem.data_line ?? 0,
    englishTitles: byProblem.english_title ?? 0,
    cardsWithDefect: defects.length,
    defectRate: cards ? round(defects.length / cards, 3) : null,
    byProblem,
    defects,
  };
}
