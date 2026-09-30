// The run behind an SEO landing page's stored results (owner decision 2026-09-29, lib/seo/
// results.ts): every product of the page's query that passes the site's filters, ranked by the
// site's ranking under the admin's shop cap, up to SEO_MAX_PRODUCTS, each group of
// RESULTS_PER_PAGE explained by one explain call (the existing step, unchanged, whose comparisons
// hold within its batch and are checked in code).
//
// collectSeoResults: parse (from the parse cache when there), up to SEO_FETCH.maxCalls
// product.query calls (the visitor's policy with higher limits, spaced the same way), rank, link,
// save every product to `products` (so /p and /go work), then explain group by group, the first
// alone (the first-page safety net may move a product off it, as a search does), then at most
// SEO_RUN_LIMITS.explainConcurrency calls at a time. A group whose products and order are those of
// a group already stored, and whose every line still holds for the products' current numbers
// (checkExplanation again), keeps its lines: no call. No call starts without room for it before
// the caller's deadline; groups left over stay "pending" and continueSeoResults writes them in a
// later run, without fetching again.
//
// Every LLM call is written to llm_usage (the first group "explain", the others "explain_more"),
// and each run writes one search_log row with source "preview", never listed on /searches and
// never counted as a search. The daily LLM budget is charged once per run and once per further
// explain call, as a search and its "עוד N" pages are.
import type { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_KEPT, RESULTS_PER_PAGE, SEO_MAX_PRODUCTS } from "@/lib/config/site";
import {
  checkExplanation,
  EXPLAIN_VERSION,
  explainContextFrom,
  explainProducts,
  whyFromData,
  type ExplainContext,
  type ExplainInput,
} from "@/lib/llm/explain";
import { parseQuery } from "@/lib/llm/parse";
import type { LlmProvider } from "@/lib/llm/provider";
import type { ShopCapMode } from "@/lib/ranking/config";
import { demoteFlaggedLeads } from "@/lib/ranking/featured-guard";
import {
  chunk,
  explainInputOf,
  leanProduct,
  SEO_RESULTS_VERSION,
  withoutLines,
  type GroupState,
  type SeoResults,
} from "@/lib/seo/results";
import type { LlmCallKind } from "@/lib/stats/usage";
import type { ResultProduct } from "@/lib/types";
import { filtersKey, normalizeQuery, queryKey } from "./cache-key";
import { buildChips } from "./chips";
import { SEO_FETCH } from "./fetch-policy";
import type { ParsedQuery } from "./filters";
import {
  diagOf,
  ensureLinks,
  errorText,
  fetchAndRank,
  lineThatHolds,
  LLM_STAGE_LIMITS,
  MAX_QUERY_LENGTH,
  SearchError,
  searchFailureCode,
  toExplainInput,
  toResultProduct,
  withLimits,
  type Fetched,
  type SearchMeta,
} from "./pipeline";
import type { Explanation, SearchLogEntry, SearchStore } from "./store";

/** AliExpress client retries for the refresh (lib/search/server.ts): one, so a call is bounded. */
export const SEO_ALI_RETRIES = 1;

/**
 * Time rules of a run. A call starts only with room for its worst case before the deadline, so
 * the run ends inside the function's limit (maxDuration 60 s; callers pass 55 s): an explain call
 * is limited to 10 s (LLM_STAGE_LIMITS.seoExplain, no retry), a product.query or link.generate call with the
 * refresh's client to 8 s, a 1.2 s wait and 8 s again.
 */
export const SEO_RUN_LIMITS = {
  /** Explain calls running at once. */
  explainConcurrency: 3,
  /** Left before the deadline to start an explain call: its limit and the writes after it. */
  explainRoomMs: LLM_STAGE_LIMITS.seoExplain.timeoutMs + 2_000,
  /** One AliExpress call's worst case with SEO_ALI_RETRIES (8 s, 1.2 s, 8 s). */
  aliCallMs: 17_200,
  /** No product.query after the first starts once the fetch has run this long. */
  fetchBudgetMs: 20_000,
} as const;

/** Room to start an AliExpress call: its worst case, then one group's explain call. */
const ALI_CALL_ROOM_MS = SEO_RUN_LIMITS.aliCallMs + SEO_RUN_LIMITS.explainRoomMs;

/** The run could not start its first AliExpress call in time: nothing was fetched. */
export class SeoOutOfTimeError extends Error {
  constructor() {
    super("no time left for the first AliExpress call");
    this.name = "SeoOutOfTimeError";
  }
}

export interface SeoRunDeps {
  llm: LlmProvider;
  /** The refresh's client (SEO_ALI_RETRIES). */
  ali: AliExpressClient;
  store: SearchStore;
  /** The admin's shop cap setting: the ranking runs under it, as a search does. */
  shopCap: ShopCapMode;
  /** One unit of the daily LLM budget (DAILY_SEARCH_CAP); throws SearchError("capacity"). */
  chargeBudget: () => Promise<void>;
  /** Writes our Hebrew titles onto stored product rows (a continuation has no data to save). */
  saveTitles: (titles: Record<string, string>) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  aliSpacingMs?: number;
  clockMs?: () => number;
  newSearchUid?: () => string;
}

export interface SeoRunOptions {
  /** Epoch ms by which the run must be done. */
  deadline: number;
}

/** What a run did, for tests, logs and the admin. */
export interface SeoRunMeta extends SearchMeta<LlmCallKind> {
  /** Explain calls made. */
  explainCalls: number;
  /** Groups that kept their stored lines. */
  groupsReused: number;
  /** Groups left for a later run. */
  groupsPending: number;
}

export interface SeoRunOutcome {
  results: SeoResults;
  meta: SeoRunMeta;
}

function newMeta(): SeoRunMeta {
  return {
    cache: "none",
    llmUsage: [],
    aliCalls: 0,
    linkCalls: 0,
    rejected: null,
    keywordsTried: [],
    explainRejected: [],
    timings: { parse_ms: null, fetch_ms: null, explain_ms: null, products_ms: null },
    fetchStop: null,
    explainFailed: false,
    demoted: [],
    explainCalls: 0,
    groupsReused: 0,
    groupsPending: 0,
  };
}

/** Two contexts give the model the same search (stored jsonb may reorder keys). */
export function sameContext(a: ExplainContext, b: ExplainContext): boolean {
  return (
    a.product_he === b.product_he &&
    a.sort_preference === b.sort_preference &&
    a.min_price_ils === b.min_price_ils &&
    a.max_price_ils === b.max_price_ils &&
    a.requirements_he.length === b.requirements_he.length &&
    a.requirements_he.every((r, i) => r === b.requirements_he[i])
  );
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The stored lines of a group whose products and order are exactly `ids` in one of `previous`
 * (written by one call, for the same search and EXPLAIN_VERSION), when every line still holds for
 * the products' current numbers: each is checked again (checkExplanation, the explain step's own
 * checks: grounded numbers, comparisons within these five, ...) and a line built from the data is
 * built again from the new numbers. Null when no such group exists or one line fails: the group is
 * explained again.
 */
export function reusableLines(
  ids: readonly string[],
  fresh: ReadonlyMap<string, ExplainInput>,
  previous: readonly SeoResults[],
  context: ExplainContext,
): Record<string, Explanation> | null {
  const batch = ids.map((id) => fresh.get(id));
  if (batch.some((p) => !p)) return null;
  const inputs = batch as ExplainInput[];
  for (const prior of previous) {
    if (prior.explain_version !== EXPLAIN_VERSION || !prior.context) continue;
    if (!sameContext(prior.context, context)) continue;
    if (!prior.groups.some((g) => g.state === "model" && sameIds(g.ids, ids))) continue;
    const old = new Map(prior.results.map((p) => [p.product_id, p]));
    const out: Record<string, Explanation> = {};
    const holds = ids.every((id, i) => {
      const was = old.get(id);
      if (!was) return false;
      const title = was.title_he !== was.title_en ? was.title_he : null;
      if (was.why_he === whyFromData(explainInputOf(was))) {
        out[id] = { title_he: title, why_he: whyFromData(inputs[i]) };
        return true;
      }
      const checked = checkExplanation(
        { title_he: title ?? "", why_he: was.why_he },
        inputs[i],
        inputs,
        context,
      );
      if (checked.why_he === null || (title !== null && checked.title_he === null)) return false;
      out[id] = { title_he: title === null ? null : checked.title_he, why_he: checked.why_he };
      return true;
    });
    if (holds) return out;
  }
  return null;
}

/** Name and message only, never a stack trace. */
function logError(where: string, err: unknown) {
  console.error(`[seo-run] ${where}: ${errorText(err)}`);
}

async function quietly(where: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (err) {
    logError(where, err);
  }
}

/** Shared by a collection and a continuation: the clock, the deadline and the budget. */
interface RunContext {
  deps: SeoRunDeps;
  meta: SeoRunMeta;
  now: () => Date;
  /** Milliseconds left before the deadline. */
  left: () => number;
  /** Explain calls the run's first charge already covers. */
  freeCalls: number;
  /** Set once the daily budget refused a call: no further call. */
  outOfBudget: boolean;
}

/**
 * One explain call for one group, or null when it could not run (no room, no budget) or failed:
 * the group then stays as it was (pending) for a later run.
 */
async function explainGroup(
  run: RunContext,
  context: ExplainContext,
  inputs: ExplainInput[],
  index: number,
): Promise<Record<string, Explanation> | null> {
  if (run.outOfBudget || run.left() < SEO_RUN_LIMITS.explainRoomMs) return null;
  if (run.freeCalls > 0) {
    run.freeCalls--;
  } else {
    try {
      await run.deps.chargeBudget();
    } catch (err) {
      run.outOfBudget = true;
      if (!(err instanceof SearchError && err.code === "capacity")) logError("budget", err);
      return null;
    }
  }
  run.meta.explainCalls++;
  try {
    const res = await explainProducts(
      withLimits(run.deps.llm, LLM_STAGE_LIMITS.seoExplain),
      context,
      inputs,
    );
    const kind: LlmCallKind = index === 0 ? "explain" : "explain_more";
    run.meta.llmUsage.push({ kind, usage: res.usage, model: res.model });
    for (const i of res.items) {
      if (i.rejected)
        run.meta.explainRejected.push({ product_id: i.product_id, rejected: i.rejected });
    }
    return Object.fromEntries(
      res.items.map((i) => [i.product_id, { title_he: i.title_he, why_he: i.why_he }]),
    );
  } catch (err) {
    run.meta.explainFailed = true;
    logError(`explain group ${index + 1}`, err);
    return null;
  }
}

/**
 * Explains the groups at `todo` (indices into `groups`), at most explainConcurrency at a time, in
 * order, each only while there is room; writes the lines and marks each done group "model".
 */
async function explainPool(
  run: RunContext,
  context: ExplainContext,
  groups: readonly string[][],
  states: GroupState[],
  lines: Map<string, Explanation>,
  inputs: ReadonlyMap<string, ExplainInput>,
  todo: readonly number[],
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (run.outOfBudget || run.left() < SEO_RUN_LIMITS.explainRoomMs) return;
      const index = todo[next++];
      const ids = groups[index];
      const written = await explainGroup(
        run,
        context,
        ids.map((id) => inputs.get(id)!),
        index,
      );
      if (!written) continue;
      for (const id of ids) if (written[id]) lines.set(id, written[id]);
      states[index] = "model";
    }
  };
  const workers = Math.min(SEO_RUN_LIMITS.explainConcurrency, todo.length);
  await Promise.all(Array.from({ length: workers }, worker));
}

/** The line built from the data, with no title of ours. */
const dataLine = (p: ExplainInput): Explanation => ({ title_he: null, why_he: whyFromData(p) });

function toResult(p: AliProduct, line: Explanation | undefined, pending: boolean): ResultProduct {
  const shown = toResultProduct(p, pending ? undefined : line);
  return leanProduct(pending ? withoutLines(shown) : shown);
}

/**
 * The first group's safety net (lib/ranking/featured-guard.ts), as a search applies it to its
 * first page: a product whose line says it is not the searched product moves to the end of the
 * list. A product that moves onto the first group gets the line built from the data (no call);
 * every other line of the group is checked again against its new five (lineThatHolds) and falls
 * back to the data when it no longer holds.
 */
function guardFirstGroup(
  order: AliProduct[],
  lines: Map<string, Explanation>,
  inputs: ReadonlyMap<string, ExplainInput>,
  filters: ParsedQuery,
  context: ExplainContext,
  shopCap: ShopCapMode,
): { order: AliProduct[]; demoted: string[] } {
  const known = Object.fromEntries(lines);
  const guarded = demoteFlaggedLeads(order, known, filters.product_he, RESULTS_PER_PAGE, shopCap);
  if (!guarded.demoted.length) return { order, demoted: [] };
  const lead = guarded.ranked.slice(0, RESULTS_PER_PAGE);
  const was = new Set(order.slice(0, RESULTS_PER_PAGE).map((p) => p.productId));
  const batch = lead.map((p) => inputs.get(p.productId)!);
  for (const [i, p] of lead.entries()) {
    const input = batch[i];
    const line = lines.get(p.productId);
    if (!was.has(p.productId) || !line) {
      lines.set(p.productId, dataLine(input));
      continue;
    }
    const holds = lineThatHolds(line, input, batch, context);
    lines.set(p.productId, holds ?? { title_he: line.title_he, why_he: whyFromData(input) });
  }
  // A demoted product is explained again with the group it lands in.
  for (const id of guarded.demoted) lines.delete(id);
  return { order: guarded.ranked, demoted: guarded.demoted };
}

/** search_log for a run (source "preview"): never listed, never counted as a search. */
function logEntry(
  q: string,
  parsed: ParsedQuery | null,
  resultIds: string[],
  shown: number,
  categoryId: string | null,
  meta: SeoRunMeta,
  uid: string,
  totalMs: number,
  failure: string | null = null,
): SearchLogEntry {
  return {
    query: q,
    queryNorm: normalizeQuery(q),
    parsed,
    resultIds,
    cache: meta.cache,
    resultsCount: shown,
    source: "preview",
    categoryId,
    listable: false,
    origin: "preview",
    without: [],
    sortOverride: null,
    timings: { ...meta.timings, total_ms: totalMs },
    aliCalls: meta.aliCalls + meta.linkCalls,
    rejected: meta.rejected,
    failure,
    searchUid: uid,
    shared: false,
    owner: false,
    diag: diagOf({
      ...meta,
      ...(meta.groupsReused ? { linesReused: meta.groupsReused * RESULTS_PER_PAGE } : {}),
    }),
  };
}

function shownOf(results: ResultProduct[], states: readonly GroupState[]): number {
  const firstPending = states.indexOf("pending");
  const groups = firstPending === -1 ? states.length : firstPending;
  return Math.min(results.length, groups * RESULTS_PER_PAGE);
}

/**
 * A new collection for the page's query (see the file header). `previous` are the page's stored
 * results (and the run still being explained), whose groups may keep their lines. Throws
 * SearchError (as a search fails) or SeoOutOfTimeError; every LLM call made is logged either way.
 */
export async function collectSeoResults(
  q: string,
  deps: SeoRunDeps,
  { deadline, previous = [] }: SeoRunOptions & { previous?: readonly SeoResults[] },
): Promise<SeoRunOutcome> {
  const query = q.trim();
  if (!query || query.length > MAX_QUERY_LENGTH) {
    throw new SearchError("invalid_query", `query must be 1-${MAX_QUERY_LENGTH} characters`);
  }
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = deps.clockMs ?? (() => performance.now());
  const uid = (deps.newSearchUid ?? (() => crypto.randomUUID()))();
  const started = clock();
  const meta = newMeta();
  const run: RunContext = {
    deps,
    meta,
    now,
    left: () => deadline - now().getTime(),
    freeCalls: 0,
    outOfBudget: false,
  };
  let charged = false;
  const chargeOnce = async () => {
    if (charged) return;
    charged = true;
    await deps.chargeBudget();
    // The run's own charge covers its first explain call, as a search's covers its first page.
    run.freeCalls = 1;
  };
  const timed = async <T>(step: keyof SeoRunMeta["timings"], work: () => Promise<T>) => {
    const t = clock();
    try {
      return await work();
    } finally {
      meta.timings[step] = Math.round(clock() - t);
    }
  };
  let parsed: ParsedQuery | null = null;

  try {
    // 1. The parse, from the 14-day parse cache when possible.
    const qk = queryKey(query);
    parsed = await deps.store.getParse(qk, now());
    if (parsed) {
      meta.cache = "parse";
    } else {
      await chargeOnce();
      const res = await timed("parse_ms", async () => {
        try {
          return await parseQuery(withLimits(deps.llm, LLM_STAGE_LIMITS.parse), query);
        } catch (err) {
          throw new SearchError("llm", `parse call failed: ${errorText(err)}`, { cause: err });
        }
      });
      res.usage.forEach((u) => meta.llmUsage.push({ kind: "parse", usage: u, model: res.model }));
      if (!res.parsed) throw new SearchError("parse_failed", "could not understand the query");
      parsed = res.parsed;
      await deps.store.putParse(qk, normalizeQuery(query), parsed, now());
    }
    const filters = parsed;

    // 2. Fetch, filter, rank and link, as a search does, with the refresh's limits.
    if (run.left() < ALI_CALL_ROOM_MS) throw new SeoOutOfTimeError();
    await chargeOnce();
    const spacing = deps.aliSpacingMs ?? 1_100;
    let fetched: Fetched;
    let products: AliProduct[];
    try {
      fetched = await timed("fetch_ms", () =>
        fetchAndRank(
          filters,
          { ali: deps.ali, sleep, aliSpacingMs: spacing, now, shopCap: deps.shopCap },
          meta,
          {
            limits: SEO_FETCH,
            budgetMs: SEO_RUN_LIMITS.fetchBudgetMs,
            kept: SEO_MAX_PRODUCTS,
            mayCall: () => run.left() >= ALI_CALL_ROOM_MS,
          },
        ),
      );
      products = fetched.ranked;
      if (products.some((p) => !p.promotionLink)) {
        products =
          run.left() >= ALI_CALL_ROOM_MS
            ? await ensureLinks(deps.ali, products, meta, sleep, spacing)
            : products.filter((p) => p.promotionLink);
      }
    } catch (err) {
      if (err instanceof AliExpressError) throw new SearchError("upstream", err.message);
      throw err;
    }
    if (fetched.ranked.length && !products.length) {
      throw new SearchError("upstream", "no product that passed could be linked");
    }

    const context = explainContextFrom(filters);
    const createdAt = now();
    const inputs = new Map(products.map((p) => [p.productId, toExplainInput(p)]));
    const lines = new Map<string, Explanation>();

    // A product a stored line already calls another product starts off the first group.
    const priorFlags: Record<string, { why_he: string }> = {};
    for (const prior of previous) {
      if (!prior.context || !sameContext(prior.context, context)) continue;
      for (const p of prior.results)
        if (p.why_he) priorFlags[p.product_id] ??= { why_he: p.why_he };
    }
    let order = demoteFlaggedLeads(
      products,
      priorFlags,
      filters.product_he,
      RESULTS_PER_PAGE,
      deps.shopCap,
    ).ranked;

    // The rows /p and /go read, before any card can show (titles follow once written).
    await deps.store.saveProducts(order, {}, createdAt);
    meta.timings.products_ms = Math.round(clock() - started);

    const t = clock();
    // 3. The first group, alone: the safety net may change it.
    const reuse = (ids: string[]) => reusableLines(ids, inputs, previous, context);
    const leadIds = order.slice(0, RESULTS_PER_PAGE).map((p) => p.productId);
    let leadLines = leadIds.length ? reuse(leadIds) : null;
    if (leadLines) {
      meta.groupsReused++;
    } else if (leadIds.length) {
      leadLines = await explainGroup(
        run,
        context,
        leadIds.map((id) => inputs.get(id)!),
        0,
      );
    }
    for (const [id, e] of Object.entries(leadLines ?? {})) lines.set(id, e);
    if (leadLines) {
      const guarded = guardFirstGroup(order, lines, inputs, filters, context, deps.shopCap);
      order = guarded.order;
      meta.demoted = guarded.demoted;
    }

    // 4. Every other group: its stored lines when they hold, otherwise one call each.
    const groups = chunk(order.map((p) => p.productId));
    const states: GroupState[] = groups.map((_, i) => (i === 0 && leadLines ? "model" : "pending"));
    const todo: number[] = [];
    for (const [i, ids] of groups.entries()) {
      if (i === 0) continue;
      const kept = reuse(ids);
      if (kept) {
        for (const [id, e] of Object.entries(kept)) lines.set(id, e);
        states[i] = "model";
        meta.groupsReused++;
      } else {
        todo.push(i);
      }
    }
    await explainPool(run, context, groups, states, lines, inputs, todo);
    meta.timings.explain_ms = meta.explainCalls ? Math.round(clock() - t) : null;
    meta.groupsPending = states.filter((s) => s !== "model").length;

    const pendingIds = new Set(groups.flatMap((ids, i) => (states[i] === "model" ? [] : ids)));
    const results = order.map((p) =>
      toResult(p, lines.get(p.productId), pendingIds.has(p.productId)),
    );
    const seo: SeoResults = {
      v: SEO_RESULTS_VERSION,
      query,
      chips: buildChips(filters),
      sort: filters.sort_preference,
      checked_count: fetched.checked,
      passed_count: fetched.passed,
      ...(filters.preferences?.length
        ? { not_filtered: filters.preferences.map((p) => p.he) }
        : {}),
      fetched_at: createdAt.toISOString(),
      full: true,
      context,
      explain_version: EXPLAIN_VERSION,
      results,
      groups: groups.map((ids, i) => ({ ids, state: states[i] })),
    };

    const titled = order.filter(
      (p) => !pendingIds.has(p.productId) && lines.get(p.productId)?.title_he,
    );
    const titles = Object.fromEntries(
      titled.map((p) => [p.productId, lines.get(p.productId)!.title_he]),
    );
    const shown = shownOf(results, states);
    await Promise.all([
      titled.length
        ? quietly("saveProducts", () => deps.store.saveProducts(titled, titles, createdAt))
        : null,
      // Visitors searching for the same filters get this result set too (its first three groups
      // are the search's four pages), as the page's earlier refreshes gave them.
      states[0] === "model"
        ? quietly("putResults", () =>
            deps.store.putResults(filtersKey(filters, deps.shopCap), query, {
              filters,
              checked: fetched.checked,
              passed: fetched.passed,
              products: order.slice(0, RESULTS_KEPT),
              explanations: Object.fromEntries(
                order.slice(0, RESULTS_KEPT).flatMap((p) => {
                  const e = lines.get(p.productId);
                  return e && !pendingIds.has(p.productId) ? [[p.productId, e]] : [];
                }),
              ),
              createdAt: createdAt.toISOString(),
            }),
          )
        : null,
      quietly("logSearch", () =>
        deps.store.logSearch(
          logEntry(
            query,
            filters,
            order.map((p) => p.productId),
            shown,
            order[0]?.category.firstId ?? null,
            meta,
            uid,
            Math.round(clock() - started),
          ),
        ),
      ),
    ]);
    return { results: seo, meta };
  } catch (err) {
    const failure = err instanceof SeoOutOfTimeError ? "time" : searchFailureCode(err);
    await quietly("logSearch", () =>
      deps.store.logSearch(
        logEntry(query, parsed, [], 0, null, meta, uid, Math.round(clock() - started), failure),
      ),
    );
    throw err;
  } finally {
    // Every call made is logged, also when the run then failed.
    if (meta.llmUsage.length) await quietly("logUsage", () => deps.store.logUsage(meta.llmUsage));
  }
}

/**
 * Writes the lines a stored run still lacks (its pending groups, and a first group shown with the
 * lines from the data), group by group as a collection does, without fetching: the products and
 * their numbers are the stored ones, from the same fetch (results.fetched_at). The safety net is
 * not applied again here: moving a product would change groups that are already explained (and
 * the stored products carry no shop for the shop cap); a first group explained now that says a
 * product is another product says so in its line.
 */
export async function continueSeoResults(
  results: SeoResults,
  deps: SeoRunDeps,
  { deadline }: SeoRunOptions,
): Promise<SeoRunOutcome> {
  const context = results.context;
  if (!context) throw new Error("these results cannot be continued");
  const now = deps.now ?? (() => new Date());
  const clock = deps.clockMs ?? (() => performance.now());
  const uid = (deps.newSearchUid ?? (() => crypto.randomUUID()))();
  const started = clock();
  const meta = newMeta();
  meta.cache = "results";
  const run: RunContext = {
    deps,
    meta,
    now,
    left: () => deadline - now().getTime(),
    freeCalls: 0,
    outOfBudget: false,
  };
  try {
    const inputs = new Map(results.results.map((p) => [p.product_id, explainInputOf(p)]));
    const groups = results.groups.map((g) => g.ids);
    const states = results.groups.map((g) => g.state);
    const lines = new Map<string, Explanation>();
    const todo = states.flatMap((s, i) => (s === "model" ? [] : [i]));
    await explainPool(run, context, groups, states, lines, inputs, todo);
    meta.timings.explain_ms = meta.explainCalls ? Math.round(clock() - started) : null;
    meta.groupsPending = states.filter((s) => s !== "model").length;
    const updated: SeoResults = {
      ...results,
      results: results.results.map((p) => {
        const e = lines.get(p.product_id);
        if (!e) return p;
        return {
          ...p,
          title_he: e.title_he ?? p.title_en,
          why_he: e.why_he,
        };
      }),
      groups: results.groups.map((g, i) => ({ ids: g.ids, state: states[i] })),
    };
    const titles = Object.fromEntries(
      [...lines].flatMap(([id, e]) => (e.title_he ? [[id, e.title_he]] : [])),
    );
    const explained = [...lines.keys()];
    await Promise.all([
      Object.keys(titles).length ? quietly("saveTitles", () => deps.saveTitles(titles)) : null,
      explained.length
        ? quietly("logSearch", () =>
            deps.store.logSearch(
              logEntry(
                results.query,
                null,
                explained,
                shownOf(updated.results, states),
                updated.results[0]?.category_id ?? null,
                meta,
                uid,
                Math.round(clock() - started),
              ),
            ),
          )
        : null,
    ]);
    return { results: updated, meta };
  } finally {
    if (meta.llmUsage.length) await quietly("logUsage", () => deps.store.logUsage(meta.llmUsage));
  }
}
