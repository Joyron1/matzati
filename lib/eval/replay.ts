// Offline replay of a search over a snapshot (docs/search-quality-plan.md, item 1): a fetch policy
// picks calls from the captured ones, then the current ranking code (lib/ranking) runs exactly as
// lib/search/pipeline.ts runs it. Pure and deterministic: no network, no LLM, no clock.
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { normalizeParsed, type ParsedQueryRaw } from "@/lib/llm/parse";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import {
  hasSharedNumbers,
  isRequestedProduct,
  passesFilters,
  rankProducts,
  rankWithFill,
  rejectionCounts,
  type RejectReason,
} from "@/lib/ranking/rank";
import { applyOverrides, requirementChipId } from "@/lib/search/chips";
import { lowestUnitsSold } from "@/lib/search/fetch-policy";
import type { ParsedQuery, SortPreference } from "@/lib/search/filters";
import { keywordLadder, RESULTS_KEPT } from "@/lib/search/pipeline";
import { isGoodLabel, labelsFor, type Label, type LabelBook, type LabelEntry } from "./labels";
import type { FetchedCall, FetchPolicy, FetchState, FetchStep } from "./policies";
import { callKey, distinctProducts, type Snapshot } from "./snapshot";

/** A policy that has not stopped after this many calls is broken. */
const MAX_REPLAY_CALLS = 10;

/** The ranking step: products in, the ordered passers and which of them came from FILL_TIER. */
export type RankFn = (
  pool: AliProduct[],
  filters: ParsedQuery,
) => { ranked: AliProduct[]; fillIds: string[] };

/** What fetchAndRank does after fetching: standard passers, topped up to one page from FILL_TIER. */
export const pipelineRank: RankFn = (pool, filters) =>
  rankWithFill(pool, filters, RESULTS_PER_PAGE);

/** One way of running the searches: a fetch policy plus optional changes to the search itself. */
export interface Variant {
  /** Names the run in reports ("current", "until-6-3", ...). */
  name: string;
  policy: FetchPolicy;
  /** Replaces the ranking step (default pipelineRank). */
  rank?: RankFn;
  /** A refine-button sort, as SearchInput.sort: overrides the parsed sort_preference. */
  sort?: SortPreference;
  /**
   * Removed chip ids, as SearchInput.without ("req:<en>", "min", "max"); "req:*" removes every
   * requirement. A removed price bound changes the calls, which the snapshot then lacks.
   */
  without?: readonly string[];
  /** Rewrites the stored parse first (see renormalizeParse); null means the parse is unusable. */
  adjustParse?: (parsed: ParsedQuery, query: string) => ParsedQuery | null;
}

/**
 * Runs the stored parse through the current normalizeParsed, so code-only parse guards (item 8)
 * can be measured on the snapshots without an LLM call.
 */
export function renormalizeParse(parsed: ParsedQuery, query: string): ParsedQuery | null {
  const raw: ParsedQueryRaw = {
    product_he: parsed.product_he,
    product_terms: parsed.product_terms,
    requirements: parsed.requirements,
    keywords_en: parsed.keywords_en,
    min_price_ils: parsed.min_price_ils ?? null,
    max_price_ils: parsed.max_price_ils ?? null,
    sort_preference: parsed.sort_preference,
    category_hint: parsed.category_hint ?? null,
  };
  return normalizeParsed(raw, query);
}

/** The filters the pipeline would search with for this snapshot under this variant. */
export function filtersFor(snap: Snapshot, variant: Variant): ParsedQuery | null {
  const base = variant.adjustParse
    ? variant.adjustParse(snap.parse.parsed, snap.query)
    : snap.parse.parsed;
  if (!base) return null;
  const without = (variant.without ?? []).flatMap((id) =>
    id === "req:*" ? base.requirements.map((r) => requirementChipId(r.en)) : [id],
  );
  return {
    ...applyOverrides(base, without),
    ...(variant.sort ? { sort_preference: variant.sort } : {}),
  };
}

export interface FetchReplay {
  calls: FetchedCall[];
  /** The step the policy asked for that the snapshot does not hold; the replay stopped there. */
  missing: FetchStep | null;
  /** Distinct products of the calls made, first occurrence wins. */
  pool: AliProduct[];
}

function fetchState(
  filters: ParsedQuery,
  ladder: string[],
  calls: FetchedCall[],
  pool: AliProduct[],
  captured: FetchStep[],
): FetchState {
  return {
    filters,
    ladder,
    calls: [...calls],
    pool: [...pool],
    ranked: rankProducts(pool, filters).length,
    passed: rankWithFill(pool, filters, RESULTS_PER_PAGE).ranked.length,
    rejected: rejectionCounts(pool, filters),
    captured,
  };
}

/**
 * Runs `policy` over the snapshot's calls. A call matches on keywords, page and price bounds (the
 * pipeline sends the filters' bounds); when the policy asks for one the snapshot lacks, the replay
 * stops there and reports it as missing: the result then covers the calls before it only.
 */
export function replayFetch(
  snap: Pick<Snapshot, "calls">,
  filters: ParsedQuery,
  policy: FetchPolicy,
): FetchReplay {
  const min = filters.min_price_ils ?? null;
  const max = filters.max_price_ils ?? null;
  const usable = snap.calls.filter((c) => !c.error);
  const byKey = new Map(
    usable.map((c) => [callKey(c.keywords, c.pageNo, c.minPriceIls, c.maxPriceIls), c]),
  );
  const captured = usable
    .filter((c) => c.minPriceIls === min && c.maxPriceIls === max)
    .map((c) => ({ keywords: c.keywords, pageNo: c.pageNo }));
  const ladder = keywordLadder(filters);
  const calls: FetchedCall[] = [];
  const seen = new Map<string, AliProduct>();
  for (;;) {
    const step = policy.next(fetchState(filters, ladder, calls, [...seen.values()], captured));
    if (!step) return { calls, missing: null, pool: [...seen.values()] };
    if (calls.some((c) => c.keywords === step.keywords && c.pageNo === step.pageNo)) {
      throw new Error(`policy ${policy.name} asked for "${step.keywords}" p${step.pageNo} twice`);
    }
    if (calls.length >= MAX_REPLAY_CALLS) {
      throw new Error(`policy ${policy.name} did not stop after ${MAX_REPLAY_CALLS} calls`);
    }
    const c = byKey.get(callKey(step.keywords, step.pageNo, min, max));
    if (!c) return { calls, missing: step, pool: [...seen.values()] };
    calls.push({
      keywords: c.keywords,
      pageNo: c.pageNo,
      step: c.step,
      rawCount: c.rawCount,
      parsedCount: c.parsedCount,
      totalRecords: c.totalRecords,
      lowestUnitsSold: lowestUnitsSold(c.products),
    });
    for (const p of c.products) if (!seen.has(p.productId)) seen.set(p.productId, p);
  }
}

export interface PipelineRanking {
  /** What the pipeline caches: the first RESULTS_KEPT ranked products. */
  kept: AliProduct[];
  /** Every product that passed ("Y עברו", passed_count). */
  passed: number;
  fillIds: string[];
}

/**
 * The ranking part of fetchAndRank. ensureLinks is assumed to succeed: a product without a
 * promotion link would get one from link.generate (snapshots hold none without a link).
 */
export function rankLikePipeline(
  pool: AliProduct[],
  filters: ParsedQuery,
  rank: RankFn = pipelineRank,
): PipelineRanking {
  const final = rank(pool, filters);
  return {
    kept: final.ranked.slice(0, RESULTS_KEPT),
    passed: final.ranked.length,
    fillIds: final.fillIds,
  };
}

/** A product in the report: its numbers as AliExpress sent them, and its label if any. */
export interface ProductLine {
  id: string;
  label: Label | null;
  tier: "standard" | "fill";
  shop: string | null;
  price: number;
  feedbackPct: number | null;
  unitsSold: number | null;
  /** Its shop shares numbers in the pool (lib/ranking/shared-numbers.ts); absent otherwise. */
  shared?: true;
  title: string;
}

export interface LabelMetrics {
  /** Labelled products for this query (its own labels, or those of `sameQueryAs`). */
  count: number;
  /** The first result is exact or reasonable. Null with no results or an unlabelled first result. */
  leadCorrect: boolean | null;
  /** Shown cards (top 3) labelled exact or reasonable. */
  cardsGood: number;
  /** Shown cards with any label. */
  cardsLabelled: number;
  /** Shown cards labelled wrong. */
  wrongTop3: number;
  /** Ids in the top 6 (the first two pages) without a label: label these next. */
  unlabelledTop6: string[];
  /** Whole snapshot pool: labelled exact or reasonable, but the type gate rejects the title. */
  typeFalseNegatives: string[];
  /** Of typeFalseNegatives, those that pass every other filter: the gate alone keeps them out. */
  typeFalseNegativesBlocking: string[];
  /** Whole snapshot pool: labelled wrong, yet they pass every filter (FILTERS or FILL_TIER). */
  falsePositives: string[];
  /** Labelled ids that are not in this snapshot (a typo, or labels of another capture). */
  unknownIds: string[];
}

export interface QueryResult {
  id: string;
  group: Snapshot["group"];
  query: string;
  sameQueryAs: string | null;
  parseVersion: number;
  /** Set when the search could not run (an unusable adjusted parse). */
  error: string | null;
  sort: SortPreference | null;
  fetch: {
    /** Captured step names in call order ("primary-p1", ...). */
    steps: string[];
    calls: number;
    /** The call the policy wanted that the snapshot lacks ("<keywords> (p<n>)"), else null. */
    missing: string | null;
  };
  /** Distinct products in the whole snapshot. */
  snapshotPool: number;
  /** Distinct products in the calls made ("בדקנו X מוצרים"). */
  checked: number;
  /** Products that passed ("Y עברו"). */
  passed: number;
  /** Of those, from FILL_TIER. */
  fill: number;
  shown: number;
  moreAvailable: boolean;
  top3: ProductLine[];
  next3: ProductLine[];
  /** The most products one shop has in the top 3 (0 without results, 1 when all differ). */
  sameShopTop3: number;
  /** Mean top-3 price as a share of the stated maximum price; null without one. */
  budgetShare: number | null;
  rejected: Record<RejectReason, number>;
  labels: LabelMetrics | null;
}

/** The most products that share a shop id; a product without a shop id counts on its own. */
export function maxSameShop(products: readonly Pick<AliProduct, "shop">[]): number {
  const counts = new Map<string, number>();
  let most = products.length ? 1 : 0;
  for (const p of products) {
    if (p.shop.id === null) continue;
    const n = (counts.get(p.shop.id) ?? 0) + 1;
    counts.set(p.shop.id, n);
    most = Math.max(most, n);
  }
  return most;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function productLine(
  p: AliProduct,
  fillIds: ReadonlySet<string>,
  labels: Map<string, LabelEntry> | null,
): ProductLine {
  return {
    id: p.productId,
    label: labels?.get(p.productId)?.label ?? null,
    tier: fillIds.has(p.productId) ? "fill" : "standard",
    shop: p.shop.id,
    price: p.price,
    feedbackPct: p.positiveFeedbackPct,
    unitsSold: p.unitsSold,
    ...(hasSharedNumbers(p) ? { shared: true as const } : {}),
    title: p.title,
  };
}

const passesAnyTier = (p: AliProduct, f: ParsedQuery) =>
  passesFilters(p, f, FILTERS) || passesFilters(p, f, FILL_TIER);

export type CardMetrics = Pick<
  LabelMetrics,
  "leadCorrect" | "cardsGood" | "cardsLabelled" | "wrongTop3" | "unlabelledTop6"
>;

/** The label metrics of the shown cards (top 3) and the first two pages (top 6). */
export function cardMetrics(top3: ProductLine[], top6: ProductLine[]): CardMetrics {
  return {
    leadCorrect: top3.length && top3[0].label ? isGoodLabel(top3[0].label) : null,
    cardsGood: top3.filter((l) => isGoodLabel(l.label)).length,
    cardsLabelled: top3.filter((l) => l.label !== null).length,
    wrongTop3: top3.filter((l) => l.label === "wrong").length,
    unlabelledTop6: top6.filter((l) => l.label === null).map((l) => l.id),
  };
}

function labelMetrics(
  labels: Map<string, LabelEntry>,
  filters: ParsedQuery,
  snapshotPool: AliProduct[],
  top3: ProductLine[],
  top6: ProductLine[],
): LabelMetrics {
  const inPool = new Set(snapshotPool.map((p) => p.productId));
  const labelOf = (id: string) => labels.get(id)?.label ?? null;
  const good = snapshotPool.filter((p) => isGoodLabel(labelOf(p.productId)));
  const typeMisses = good.filter((p) => !isRequestedProduct(p.title, filters));
  // Without product terms the type gate lets every title through, so what remains is the rest.
  const otherwiseEligible = { ...filters, product_terms: [] };
  return {
    count: labels.size,
    ...cardMetrics(top3, top6),
    typeFalseNegatives: typeMisses.map((p) => p.productId),
    typeFalseNegativesBlocking: typeMisses
      .filter((p) => passesAnyTier(p, otherwiseEligible))
      .map((p) => p.productId),
    falsePositives: snapshotPool
      .filter((p) => labelOf(p.productId) === "wrong" && passesAnyTier(p, filters))
      .map((p) => p.productId),
    unknownIds: [...labels.keys()].filter((id) => !inPool.has(id)).sort(),
  };
}

const NO_REJECTIONS: Record<RejectReason, number> = {
  feedback: 0,
  volume: 0,
  currency: 0,
  price: 0,
  type: 0,
  requirement: 0,
};

/** Replays one snapshot under one variant and measures the result. */
export function evaluateQuery(snap: Snapshot, book: LabelBook, variant: Variant): QueryResult {
  const labels = labelsFor(book, snap);
  const snapshotPool = distinctProducts(snap.calls.filter((c) => !c.error));
  const head = {
    id: snap.id,
    group: snap.group,
    query: snap.query,
    sameQueryAs: snap.sameQueryAs,
    parseVersion: snap.parse.parseVersion,
    snapshotPool: snapshotPool.length,
  };
  const filters = filtersFor(snap, variant);
  if (!filters) {
    return {
      ...head,
      error: "the adjusted parse cannot drive a search",
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
  const fetched = replayFetch(snap, filters, variant.policy);
  const ranking = rankLikePipeline(fetched.pool, filters, variant.rank);
  const fillIds = new Set(ranking.fillIds);
  const lines = ranking.kept.map((p) => productLine(p, fillIds, labels));
  const top3 = lines.slice(0, RESULTS_PER_PAGE);
  const shownProducts = ranking.kept.slice(0, RESULTS_PER_PAGE);
  const max = filters.max_price_ils;
  return {
    ...head,
    error: null,
    sort: filters.sort_preference,
    fetch: {
      steps: fetched.calls.map((c) => c.step),
      calls: fetched.calls.length,
      missing: fetched.missing ? `${fetched.missing.keywords} (p${fetched.missing.pageNo})` : null,
    },
    checked: fetched.pool.length,
    passed: ranking.passed,
    fill: ranking.fillIds.length,
    shown: top3.length,
    moreAvailable: ranking.kept.length > RESULTS_PER_PAGE,
    top3,
    next3: lines.slice(RESULTS_PER_PAGE, 2 * RESULTS_PER_PAGE),
    sameShopTop3: maxSameShop(shownProducts),
    budgetShare:
      max !== undefined && top3.length
        ? round2(top3.reduce((s, l) => s + l.price, 0) / top3.length / max)
        : null,
    rejected: rejectionCounts(fetched.pool, filters),
    labels: labels
      ? labelMetrics(labels, filters, snapshotPool, top3, lines.slice(0, 2 * RESULTS_PER_PAGE))
      : null,
  };
}
