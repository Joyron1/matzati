// Runs variants over the snapshots and summarizes and compares the runs. Pure: the script
// (scripts/eval-offline.ts) does the file I/O.
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { RANKING_VERSION } from "@/lib/ranking/config";
import { labelLetter, labelsFor, type LabelBook } from "./labels";
import {
  cardMetrics,
  evaluateQuery,
  type ProductLine,
  type QueryResult,
  type Variant,
} from "./replay";
import type { Snapshot } from "./snapshot";

/** Bump when the report JSON shape changes. */
export const REPORT_FORMAT = 1;

export interface RunSummary {
  queries: number;
  /** Snapshots that copy another query's snapshot (sameQueryAs). */
  copies: number;
  /** Queries whose policy wanted a call the snapshot lacks: their numbers cover fewer calls. */
  incomplete: string[];
  /** Queries that could not run (an unusable adjusted parse). */
  errors: string[];
  aliCalls: number;
  checked: number;
  passed: number;
  noResults: string[];
  /** 1 or 2 results: fewer than a page. */
  underOnePage: string[];
  /** Exactly one page passed, so there is no "עוד 3 אפשרויות". */
  exactlyOnePage: string[];
  /** At least two pages passed (the A11 gate wants 90% of queries here). */
  twoPagesOrMore: number;
  moreAvailable: number;
  /** Queries with two or more of one shop in the top 3. */
  sameShopTop3: string[];
  /** Mean of budgetShare over the queries with a maximum price and results. */
  meanBudgetShare: number | null;
  labels: {
    /** Queries with labels. */
    queries: number;
    leadCorrect: number;
    /** Queries whose first result has a label. */
    leadLabelled: number;
    cardsGood: number;
    cardsLabelled: number;
    cardsShown: number;
    wrongTop3: number;
    typeFalseNegatives: number;
    typeFalseNegativesBlocking: number;
    falsePositives: number;
    unlabelledTop6: number;
    unknownIds: number;
  };
}

export interface VariantInfo {
  name: string;
  policy: string;
  policyDescription: string;
  rank: "pipeline" | "custom";
  sort: string | null;
  without: string[];
  adjustedParse: boolean;
}

export interface EvalRun {
  variant: VariantInfo;
  summary: RunSummary;
  queries: QueryResult[];
}

const sum = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

export function summarize(results: QueryResult[]): RunSummary {
  const ok = results.filter((r) => !r.error);
  const ids = (pred: (r: QueryResult) => boolean) => ok.filter(pred).map((r) => r.id);
  const labelled = ok.filter((r) => r.labels);
  const L = (pick: (m: NonNullable<QueryResult["labels"]>) => number) =>
    sum(labelled.map((r) => pick(r.labels!)));
  const budgets = ok.map((r) => r.budgetShare).filter((b): b is number => b !== null);
  return {
    queries: results.length,
    copies: results.filter((r) => r.sameQueryAs).length,
    incomplete: ids((r) => r.fetch.missing !== null),
    errors: results.filter((r) => r.error).map((r) => r.id),
    aliCalls: sum(ok.map((r) => r.fetch.calls)),
    checked: sum(ok.map((r) => r.checked)),
    passed: sum(ok.map((r) => r.passed)),
    noResults: ids((r) => r.passed === 0),
    underOnePage: ids((r) => r.passed > 0 && r.passed < RESULTS_PER_PAGE),
    exactlyOnePage: ids((r) => r.passed === RESULTS_PER_PAGE),
    twoPagesOrMore: ids((r) => r.passed >= 2 * RESULTS_PER_PAGE).length,
    moreAvailable: ids((r) => r.moreAvailable).length,
    sameShopTop3: ids((r) => r.sameShopTop3 >= 2),
    meanBudgetShare: budgets.length
      ? Math.round((sum(budgets) / budgets.length) * 100) / 100
      : null,
    labels: {
      queries: labelled.length,
      leadCorrect: labelled.filter((r) => r.labels!.leadCorrect === true).length,
      leadLabelled: labelled.filter((r) => r.labels!.leadCorrect !== null).length,
      cardsGood: L((m) => m.cardsGood),
      cardsLabelled: L((m) => m.cardsLabelled),
      cardsShown: sum(labelled.map((r) => r.shown)),
      wrongTop3: L((m) => m.wrongTop3),
      typeFalseNegatives: L((m) => m.typeFalseNegatives.length),
      typeFalseNegativesBlocking: L((m) => m.typeFalseNegativesBlocking.length),
      falsePositives: L((m) => m.falsePositives.length),
      unlabelledTop6: L((m) => m.unlabelledTop6.length),
      unknownIds: L((m) => m.unknownIds.length),
    },
  };
}

export function variantInfo(v: Variant): VariantInfo {
  return {
    name: v.name,
    policy: v.policy.name,
    policyDescription: v.policy.description,
    rank: v.rank ? "custom" : "pipeline",
    sort: v.sort ?? null,
    without: [...(v.without ?? [])],
    adjustedParse: v.adjustParse !== undefined,
  };
}

/** Replays every snapshot under one variant. Deterministic for the same code and fixtures. */
export function runVariant(snapshots: Snapshot[], book: LabelBook, variant: Variant): EvalRun {
  const queries = snapshots.map((s) => evaluateQuery(s, book, variant));
  return { variant: variantInfo(variant), summary: summarize(queries), queries };
}

/**
 * A saved run with today's labels on its first two pages, so a comparison with a new run judges
 * both result lists by the same labels (labels keep being added). The whole-pool metrics
 * (type-gate false negatives, false positives, unknown ids) need the pool and stay as saved.
 */
export function relabelRun(run: EvalRun, book: LabelBook): EvalRun {
  const queries = run.queries.map((q): QueryResult => {
    const labels = labelsFor(book, q);
    const relabel = (l: ProductLine): ProductLine => ({
      ...l,
      label: labels?.get(l.id)?.label ?? null,
    });
    const top3 = q.top3.map(relabel);
    const next3 = q.next3.map(relabel);
    const saved = q.labels ?? {
      typeFalseNegatives: [],
      typeFalseNegativesBlocking: [],
      falsePositives: [],
      unknownIds: [],
    };
    return {
      ...q,
      top3,
      next3,
      labels: labels
        ? {
            ...saved,
            count: labels.size,
            ...cardMetrics(top3, [...top3, ...next3]),
          }
        : null,
    };
  });
  return { ...run, queries, summary: summarize(queries) };
}

// ---------------------------------------------------------------- comparison

/** The per-query numbers a comparison looks at. */
export interface QueryBrief {
  calls: number;
  missing: string | null;
  checked: number;
  passed: number;
  top3: string[];
  next3: string[];
  sameShopTop3: number;
  moreAvailable: boolean;
  /** Label letters of the top 3 (see labelLetter). */
  top3Labels: string;
  wrongTop3: number | null;
}

export interface QueryDiff {
  id: string;
  baseline: QueryBrief | null;
  candidate: QueryBrief | null;
  /** Readable list of what changed, empty when nothing did. */
  changes: string[];
}

export interface TotalDiff {
  metric: string;
  baseline: number | string | null;
  candidate: number | string | null;
}

export interface Comparison {
  baseline: string;
  candidate: string;
  totals: TotalDiff[];
  /** Only the queries where something changed. */
  queries: QueryDiff[];
  unchanged: number;
}

export function brief(r: QueryResult): QueryBrief {
  return {
    calls: r.fetch.calls,
    missing: r.fetch.missing,
    checked: r.checked,
    passed: r.passed,
    top3: r.top3.map((l) => l.id),
    next3: r.next3.map((l) => l.id),
    sameShopTop3: r.sameShopTop3,
    moreAvailable: r.moreAvailable,
    top3Labels: r.top3.map((l) => labelLetter(l.label)).join(""),
    wrongTop3: r.labels ? r.labels.wrongTop3 : null,
  };
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

function listChange(what: string, a: string[], b: string[]): string | null {
  if (sameList(a, b)) return null;
  const added = b.filter((x) => !a.includes(x));
  const removed = a.filter((x) => !b.includes(x));
  if (!added.length && !removed.length) return `${what} reordered`;
  return `${what}: +${added.length} -${removed.length}`;
}

function queryChanges(a: QueryBrief, b: QueryBrief): string[] {
  const out: string[] = [];
  const num = (what: string, x: number | null, y: number | null) => {
    if (x !== y) out.push(`${what} ${x ?? "-"}→${y ?? "-"}`);
  };
  num("calls", a.calls, b.calls);
  if (a.missing !== b.missing) out.push(`missing ${a.missing ?? "-"}→${b.missing ?? "-"}`);
  num("checked", a.checked, b.checked);
  num("passed", a.passed, b.passed);
  const top = listChange("top3", a.top3, b.top3);
  if (top) out.push(top);
  const next = listChange("next3", a.next3, b.next3);
  if (next) out.push(next);
  if (a.top3Labels !== b.top3Labels)
    out.push(`labels ${a.top3Labels || "-"}→${b.top3Labels || "-"}`);
  num("same shop", a.sameShopTop3, b.sameShopTop3);
  num("wrong", a.wrongTop3, b.wrongTop3);
  if (a.moreAvailable !== b.moreAvailable) out.push(`more ${a.moreAvailable}→${b.moreAvailable}`);
  return out;
}

const ratio = (n: number, d: number) => (d ? `${n}/${d}` : "-");

/** The totals a comparison shows, in order. */
export function totalsOf(s: RunSummary): Record<string, number | string | null> {
  return {
    queries: s.queries,
    incomplete: s.incomplete.length,
    "AliExpress calls": s.aliCalls,
    checked: s.checked,
    "no results": s.noResults.length,
    "1-2 results": s.underOnePage.length,
    "exactly 3 (no more)": s.exactlyOnePage.length,
    "6+ passed": s.twoPagesOrMore,
    "more available": s.moreAvailable,
    "2+ same shop in top 3": s.sameShopTop3.length,
    "mean budget share": s.meanBudgetShare,
    "lead correct": ratio(s.labels.leadCorrect, s.labels.leadLabelled),
    "cards exact/reasonable": ratio(s.labels.cardsGood, s.labels.cardsLabelled),
    "wrong in top 3": s.labels.queries ? s.labels.wrongTop3 : null,
    "type-gate false negatives": s.labels.queries ? s.labels.typeFalseNegatives : null,
    "filter false positives": s.labels.queries ? s.labels.falsePositives : null,
  };
}

/** Compares two runs query by query (matched by id) and in total. */
export function compareRuns(baseline: EvalRun, candidate: EvalRun): Comparison {
  const byId = (run: EvalRun) => new Map(run.queries.map((q) => [q.id, q]));
  const a = byId(baseline);
  const b = byId(candidate);
  const ids = [...new Set([...a.keys(), ...b.keys()])];
  const queries: QueryDiff[] = [];
  let unchanged = 0;
  for (const id of ids) {
    const x = a.get(id);
    const y = b.get(id);
    const bx = x ? brief(x) : null;
    const by = y ? brief(y) : null;
    const changes =
      bx && by ? queryChanges(bx, by) : [bx ? "only in the baseline" : "only in the candidate"];
    if (changes.length) queries.push({ id, baseline: bx, candidate: by, changes });
    else unchanged++;
  }
  const ta = totalsOf(baseline.summary);
  const tb = totalsOf(candidate.summary);
  return {
    baseline: baseline.variant.name,
    candidate: candidate.variant.name,
    totals: Object.keys(ta).map((metric) => ({
      metric,
      baseline: ta[metric],
      candidate: tb[metric],
    })),
    queries,
    unchanged,
  };
}

// ---------------------------------------------------------------- report file

export interface EvalReport {
  format: number;
  name: string;
  generatedBy: string;
  /** The ranking code the runs used (a saved report may predate the current one). */
  rankingVersion: number;
  snapshots: { count: number; ids: string[] };
  labels: { files: string[]; queries: number; entries: number };
  runs: EvalRun[];
  /** --compare: the first run against the second. --against: a saved report's run against this one. */
  comparisons: (Comparison & { source: string })[];
}

export function newReport(
  name: string,
  snapshots: Snapshot[],
  labels: EvalReport["labels"],
  runs: EvalRun[],
): EvalReport {
  return {
    format: REPORT_FORMAT,
    name,
    generatedBy: "scripts/eval-offline.ts",
    rankingVersion: RANKING_VERSION,
    snapshots: { count: snapshots.length, ids: snapshots.map((s) => s.id) },
    labels,
    runs,
    comparisons: [],
  };
}
