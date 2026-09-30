// Fetch policies for the offline replay: which product.query call a search makes next, given what
// it has fetched so far. A policy is a pure decision function over FetchState, so the replay can
// run it over a snapshot's captured calls and a live pipeline could run the same function over
// real calls. Add a candidate here (and to POLICIES) to compare it with the current pipeline:
//   npm run eval:offline -- --compare current,<name>
import { MAX_PAGE_SIZE } from "@/lib/aliexpress/affiliate";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { RejectReason } from "@/lib/ranking/rank";
import { MAX_ALI_CALLS, nextFetch, TARGET_PASSED } from "@/lib/search/fetch-policy";
import type { ParsedQuery } from "@/lib/search/filters";

/** One product.query call: page `pageNo` of `keywords` (price bounds come from the filters). */
export interface FetchStep {
  keywords: string;
  pageNo: number;
}

/** A call already made, with what AliExpress said about it. */
export interface FetchedCall extends FetchStep {
  /** The snapshot's name for it ("primary-p1", "primary-p2", "ladder-1", ...). */
  step: string;
  /** Items returned, before validation. */
  rawCount: number;
  /** Items that passed validation (the pipeline's page.products.length). */
  parsedCount: number;
  totalRecords: number | null;
  /** The fewest 30-day sales among those items (lowestUnitsSold in lib/search/fetch-policy.ts). */
  lowestUnitsSold?: number | null;
}

/** Everything a policy may base its next step on. Recomputed after every call. */
export interface FetchState {
  filters: ParsedQuery;
  /** keywordLadder(filters) under the current code: the primary keywords first. */
  ladder: readonly string[];
  calls: readonly FetchedCall[];
  /** Distinct products so far, first occurrence wins (the pipeline's `seen`). */
  pool: readonly AliProduct[];
  /** rankProducts(pool) length: FILTERS passers after duplicate removal (the pipeline's `ranked`). */
  ranked: number;
  /** rankForSearch(pool) length (filled up to the first view): what "Y עברו" would say now. */
  passed: number;
  /** rejectionCounts(pool): the first filter each product failed. */
  rejected: Readonly<Record<RejectReason, number>>;
  /**
   * The calls the snapshot holds, in capture order. For replay-only policies (ALL_CAPTURED): a
   * policy meant for the live pipeline must not read it, since a live search cannot know it.
   */
  captured: readonly FetchStep[];
}

export interface FetchPolicy {
  name: string;
  /** One line for reports: what the policy does. */
  description: string;
  /** The next call, or null to stop. Never a call already made (the replay throws). */
  next(state: FetchState): FetchStep | null;
}

/** MAX_ALI_CALLS in lib/search/fetch-policy.ts. */
export const PIPELINE_MAX_CALLS = MAX_ALI_CALLS;

const made = (s: FetchState, keywords: string, pageNo: number) =>
  s.calls.some((c) => c.keywords === keywords && c.pageNo === pageNo);

/** The first ladder step after the primary keywords that has not been fetched yet. */
function nextLadderStep(s: FetchState, ladder: readonly string[] = s.ladder): FetchStep | null {
  const keywords = ladder.slice(1).find((k) => !made(s, k, 1));
  return keywords === undefined ? null : { keywords, pageNo: 1 };
}

/**
 * nextFetch in lib/search/fetch-policy.ts over the calls made so far, stopping once `target`
 * products pass (TARGET_PASSED for the live pipeline).
 */
function liveFetchPolicy(name: string, target: number): FetchPolicy {
  return {
    name,
    description:
      `the live pipeline (lib/search/fetch-policy.ts): until ${target} pass or ` +
      `${MAX_ALI_CALLS} calls; p2 while it can pass the trust bar; broader keywords by what ` +
      "blocked; stops on a requirement none mentions",
    next(s) {
      const decision = nextFetch(
        {
          filters: s.filters,
          calls: s.calls.map((c) => ({
            keywords: c.keywords,
            pageNo: c.pageNo,
            count: c.parsedCount,
            totalRecords: c.totalRecords,
            lowestUnitsSold: c.lowestUnitsSold ?? null,
          })),
          pool: s.pool,
        },
        { target },
      );
      return "step" in decision ? decision.step : null;
    },
  };
}

/**
 * fetchAndRank in lib/search/pipeline.ts: nextFetch in lib/search/fetch-policy.ts over the calls
 * made so far (until TARGET_PASSED pass or MAX_ALI_CALLS calls; page 2 while it can pass the trust bar,
 * broader keywords by what blocked; an early stop on a requirement no otherwise passing product
 * mentions). The pipeline runs the same function, and lib/eval/parity.test.ts checks both on
 * every snapshot. Steps built from a product phrase or without audience words are often not
 * captured, so a query that needs one ends incomplete ("missing") until the snapshots are
 * refreshed.
 */
export const CURRENT_POLICY: FetchPolicy = liveFetchPolicy("current", TARGET_PASSED);

/** The live policy with another "enough passed" target: "current-6" stops at 6. */
export const currentWithTarget = (target: number): FetchPolicy =>
  liveFetchPolicy(`current-${target}`, target);

/**
 * The keyword ladder of RANKING_VERSION 5 (before item 5): the primary keywords, then without
 * requirement and praise words, then the category hint. Frozen for R5_POLICY.
 */
function r5Ladder(parsed: ParsedQuery): string[] {
  const filler = new Set(["durable", "quality", "best", "good", "new", "premium", "hot", "cheap"]);
  const primary = parsed.keywords_en.trim();
  const reqTokens = new Set(
    parsed.requirements
      .flatMap((r) => [r.en, ...r.alt])
      .flatMap((s) => s.toLowerCase().split(/\s+/)),
  );
  const reduced = primary
    .split(/\s+/)
    .filter((w) => !reqTokens.has(w.toLowerCase()) && !filler.has(w.toLowerCase()))
    .join(" ");
  const ladder = [primary];
  if (reduced.split(" ").length >= 2 && reduced !== primary) ladder.push(reduced);
  const hint = parsed.category_hint?.trim();
  if (hint && hint.split(/\s+/).length >= 2 && !ladder.includes(hint)) ladder.push(hint);
  return ladder;
}

/** RESULTS_PER_PAGE when R5_POLICY was the live rule (pages of 3), frozen with it. */
const R5_PAGE = 3;
/** MAX_ALI_CALLS when R5_POLICY was the live rule, frozen with it (the live limit is 4 since 2026-09-30). */
const R5_MAX_CALLS = 3;

/**
 * fetchAndRank as of 2026-09-28 before item 5 (RANKING_VERSION 5), frozen to compare against:
 * page 1 of the primary keywords; page 2 only when page 1 had 50 parsed items, more records exist,
 * fewer than 2 × R5_PAGE passed FILTERS and relevance (type + requirement) rejected at least as
 * many as trust (feedback + volume); then its ladder (r5Ladder) while fewer than R5_PAGE passed;
 * at most 3 calls.
 */
export const R5_POLICY: FetchPolicy = {
  name: "r5",
  description:
    "the pipeline before item 5: p1; p2 only after a full page 1 (50 items) limited by " +
    "relevance; then the ladder while fewer than 3 pass; at most 3 calls",
  next(s) {
    const ladder = r5Ladder(s.filters);
    const primary = ladder[0];
    if (!s.calls.length) return { keywords: primary, pageNo: 1 };
    if (s.calls.length >= R5_MAX_CALLS) return null;
    if (s.calls.length === 1) {
      const first = s.calls[0];
      const r = s.rejected;
      if (
        s.ranked < 2 * R5_PAGE &&
        first.parsedCount >= MAX_PAGE_SIZE &&
        (first.totalRecords ?? 0) > MAX_PAGE_SIZE &&
        r.type + r.requirement >= r.feedback + r.volume
      ) {
        return { keywords: primary, pageNo: 2 };
      }
    }
    if (s.ranked >= R5_PAGE) return null;
    return nextLadderStep(s, ladder);
  },
};

export interface UntilPassingOptions {
  /** Stop once this many products pass (rankWithFill length, "Y עברו"). */
  target: number;
  /** At most this many calls. */
  maxCalls: number;
  /** Pages of the primary keywords to try before the ladder (default 2). */
  primaryPages?: number;
}

/**
 * A candidate for item 5 (A5): keep fetching until `target` products pass or `maxCalls` calls were
 * made. Next page of the primary keywords while AliExpress reports more records (whatever page 1
 * held: a page of 50 often brings 49), up to `primaryPages`; then the ladder.
 */
export function untilPassing({
  target,
  maxCalls,
  primaryPages = 2,
}: UntilPassingOptions): FetchPolicy {
  return {
    name: `until-${target}-${maxCalls}`,
    description:
      `fetch until ${target} pass, at most ${maxCalls} calls: ` +
      `primary pages while more records exist (up to ${primaryPages}), then the ladder`,
    next(s) {
      const primary = s.ladder[0];
      if (!s.calls.length) return { keywords: primary, pageNo: 1 };
      if (s.calls.length >= maxCalls || s.passed >= target) return null;
      const pages = s.calls.filter((c) => c.keywords === primary);
      const last = pages.reduce<FetchedCall | undefined>(
        (a, c) => (a && a.pageNo >= c.pageNo ? a : c),
        undefined,
      );
      if (
        last &&
        last.pageNo < primaryPages &&
        last.rawCount > 0 &&
        (last.totalRecords ?? 0) > last.pageNo * MAX_PAGE_SIZE &&
        !made(s, primary, last.pageNo + 1)
      ) {
        return { keywords: primary, pageNo: last.pageNo + 1 };
      }
      return nextLadderStep(s);
    },
  };
}

/**
 * Every captured call, whatever passed: the largest pool a snapshot holds. Replay only (it reads
 * `captured`), as the upper bound for what more calls could bring.
 */
export const ALL_CAPTURED: FetchPolicy = {
  name: "all",
  description: "every captured call (replay only: the upper bound of the snapshot pool)",
  next(s) {
    return s.captured.find((c) => !made(s, c.keywords, c.pageNo)) ?? null;
  },
};

/**
 * Named policies for the CLI. "until-<target>-<maxCalls>" and "current-<target>" (the live policy
 * with another target) also work for any numbers.
 */
export const POLICIES: Readonly<Record<string, FetchPolicy>> = {
  [CURRENT_POLICY.name]: CURRENT_POLICY,
  [R5_POLICY.name]: R5_POLICY,
  [ALL_CAPTURED.name]: ALL_CAPTURED,
  "until-6-3": untilPassing({ target: 6, maxCalls: 3 }),
};

export function policyByName(name: string): FetchPolicy {
  const known = POLICIES[name];
  if (known) return known;
  const m = /^until-(\d{1,2})(?:-(\d{1,2}))?$/.exec(name);
  if (m) {
    const target = Number(m[1]);
    const maxCalls = m[2] === undefined ? PIPELINE_MAX_CALLS : Number(m[2]);
    if (target > 0 && maxCalls > 0) return untilPassing({ target, maxCalls });
  }
  const live = /^current-(\d{1,2})$/.exec(name);
  if (live && Number(live[1]) > 0) return currentWithTarget(Number(live[1]));
  throw new Error(
    `unknown fetch policy "${name}"; known: ${Object.keys(POLICIES).join(", ")}, ` +
      "until-<target>-<maxCalls>, current-<target>",
  );
}
