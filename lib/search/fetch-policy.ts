// Which product.query call a search makes next (CLAUDE.md §6.4, docs/search-quality-plan.md item
// 5). Pure: fetchAndRank in ./pipeline.ts runs it over real calls and the offline replay
// (CURRENT_POLICY in lib/eval/policies.ts) over captured ones, so both make the same decisions;
// lib/eval/parity.test.ts checks that on every snapshot.
//
// A search keeps fetching until TARGET_PASSED products pass or MAX_ALI_CALLS calls were made, and
// picks each next call by what kept products out so far:
// - trust (too few sales or too little positive feedback): broader keywords, whose best sellers
//   sell more; the next page of the same keywords sells less, since results come by sales.
// - relevance (wrong product type, a missing requirement): the next page of the same keywords
//   while it can still pass the trust bar, then another product phrase.
// A requirement that none of the otherwise passing products mentions, with at least
// REQUIREMENT_STOP_CHECKED products checked, ends the search early: the results page then offers
// to remove it (lib/ranking/blockers.ts).
import { MAX_PAGE_SIZE } from "@/lib/aliexpress/affiliate";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { passedCount, requirementBlocksAll } from "@/lib/ranking/blockers";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import { rejectionCounts } from "@/lib/ranking/rank";
import type { ParsedQuery } from "./filters";

/** product.query calls per search at most: the app key's quota is shared by every visitor. */
export const MAX_ALI_CALLS = 3;
/** Fetch until this many products pass: two pages, so "עוד 3 אפשרויות" almost always shows. */
export const TARGET_PASSED = 2 * RESULTS_PER_PAGE;
/** Checked products after which a requirement that blocks everything stops the search. */
export const REQUIREMENT_STOP_CHECKED = 100;
/** Pages of the primary keywords at most; later calls go to broader keywords. */
export const PRIMARY_PAGES = 2;
/** Words in a keyword step built from a product phrase and a requirement, at most. */
const MAX_STEP_WORDS = 4;
/**
 * A page whose total AliExpress did not report counts as having more after this many items (a
 * page of 50 often brings 49).
 */
const FULL_PAGE_WITHOUT_TOTAL = MAX_PAGE_SIZE - 10;

/** Praise words that only narrow the keyword search. */
const FILLER = new Set(["durable", "quality", "best", "good", "new", "premium", "hot", "cheap"]);

/**
 * Who a product is for, or the occasion. They narrow AliExpress's search to fewer, smaller
 * sellers (a night light "kids" search: 111-159 sales; without "kids": 37,000 and more), so broader
 * steps drop them unless the product's own name has them ("kids water bottle"). Gender words stay:
 * the type gate cannot tell a men's product from a women's one.
 */
const AUDIENCE = new Set([
  "kid",
  "kids",
  "child",
  "children",
  "childrens",
  "toddler",
  "toddlers",
  "baby",
  "babies",
  "gift",
  "gifts",
  "present",
  "presents",
  "dad",
  "mom",
  "grandma",
  "grandpa",
]);

const words = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);
/** "children's" and "kids'" name the same audience as "children" and "kids". */
const bare = (w: string) => w.replace(/['’]s?$/, "");
/** Keyword sets are compared as sets of words: AliExpress does not care about their order. */
const wordSet = (s: string) => [...new Set(words(s))].sort().join(" ");

/**
 * What a keyword step is: the parse's own keywords, those without audience and praise words
 * ("general"), also without the requirement words ("reduced"), a product phrase with the main
 * requirement ("term"), or the broader category hint ("category").
 */
export type KeywordKind = "primary" | "general" | "reduced" | "term" | "category";

export interface KeywordStep {
  keywords: string;
  kind: KeywordKind;
}

/**
 * Every keyword set a search may use, the parse's own keywords first, then broader ones in the
 * order a trust-limited search tries them. Sets with the same words as an earlier one are left
 * out.
 */
export function keywordSteps(parsed: ParsedQuery): KeywordStep[] {
  const primary = parsed.keywords_en.trim();
  const tokens = primary.split(/\s+/).filter(Boolean);
  const reqTokens = new Set(
    parsed.requirements.flatMap((r) => [r.en, ...r.alt]).flatMap((s) => words(s)),
  );
  // The product's own name: the parse lists its main product phrase first.
  const nameTokens = new Set(words(parsed.product_terms[0] ?? "").map(bare));
  const audience = (w: string) => {
    const b = bare(w.toLowerCase());
    return AUDIENCE.has(b) && !nameTokens.has(b);
  };
  const general = tokens.filter((w) => !FILLER.has(w.toLowerCase()) && !audience(w));
  const reduced = general.filter((w) => !reqTokens.has(w.toLowerCase()));

  // The primary keywords always come first, as the parse gave them.
  const steps: KeywordStep[] = [{ keywords: primary, kind: "primary" }];
  const seen = new Set<string>([wordSet(primary)]);
  const add = (keywords: string, kind: KeywordKind) => {
    const key = wordSet(keywords);
    if (!key || seen.has(key)) return;
    seen.add(key);
    steps.push({ keywords, kind });
  };
  if (general.length >= 2) add(general.join(" "), "general");
  if (reduced.length >= 2) add(reduced.join(" "), "reduced");
  const main = parsed.requirements[0]?.en.trim().toLowerCase();
  for (const term of parsed.product_terms) {
    const t = term.trim().toLowerCase();
    if (!t) continue;
    const termWords = new Set(words(t));
    const withReq =
      main &&
      !words(main).every((w) => termWords.has(w)) &&
      words(main).length + termWords.size <= MAX_STEP_WORDS;
    add(withReq ? `${main} ${t}` : t, "term");
  }
  const hint = parsed.category_hint?.trim();
  if (hint && hint.split(/\s+/).length >= 2) add(hint, "category");
  return steps;
}

/** The keyword sets of keywordSteps, the parse's own keywords first. */
export function keywordLadder(parsed: ParsedQuery): string[] {
  return keywordSteps(parsed).map((s) => s.keywords);
}

/** One product.query call: page `pageNo` of `keywords` (price bounds come from the filters). */
export interface FetchStep {
  keywords: string;
  pageNo: number;
}

/** A call already made, with what it brought. */
export interface FetchedPage extends FetchStep {
  /** Products the page held (after validation). */
  count: number;
  /** Matches AliExpress reported for the keywords, when it did. */
  totalRecords: number | null;
  /** The fewest 30-day sales on the page (a missing number counts as 0); null for an empty page. */
  lowestUnitsSold: number | null;
}

export function lowestUnitsSold(products: readonly Pick<AliProduct, "unitsSold">[]): number | null {
  return products.length ? Math.min(...products.map((p) => p.unitsSold ?? 0)) : null;
}

export interface FetchProgress {
  filters: ParsedQuery;
  calls: readonly FetchedPage[];
  /** Distinct products so far, first occurrence wins. */
  pool: readonly AliProduct[];
}

/**
 * Why a search stopped fetching: enough passed, the call budget, a requirement that blocks
 * everything (see REQUIREMENT_STOP_CHECKED), or no step left worth making.
 */
export type FetchStop = "enough" | "calls" | "requirement" | "exhausted";

export type FetchDecision = { step: FetchStep } | { stop: FetchStop };

/**
 * The next page of the primary keywords, when AliExpress has more and it can still pass the
 * trust bar. Results come by sales (LAST_VOLUME_DESC), so no product on the next page sold more
 * than the fewest on this one: once those are under the bar, the next page cannot pass. The bar is
 * FILL_TIER's while fewer than a page pass (FILL_TIER tops the first page up), FILTERS' after.
 */
function nextPrimaryPage(s: FetchProgress, primary: string, passed: number): FetchStep | null {
  const last = s.calls
    .filter((c) => c.keywords === primary)
    .reduce<FetchedPage | null>((a, c) => (a && a.pageNo >= c.pageNo ? a : c), null);
  if (!last || last.pageNo >= PRIMARY_PAGES || last.count === 0) return null;
  const more =
    last.totalRecords !== null
      ? last.totalRecords > last.pageNo * MAX_PAGE_SIZE
      : last.count >= FULL_PAGE_WITHOUT_TOTAL;
  const bar =
    passed < RESULTS_PER_PAGE
      ? Math.min(FILL_TIER.minUnitsSold, FILTERS.minUnitsSold)
      : FILTERS.minUnitsSold;
  if (!more || last.lowestUnitsSold === null || last.lowestUnitsSold < bar) return null;
  return { keywords: primary, pageNo: last.pageNo + 1 };
}

const TRUST_ORDER: readonly KeywordKind[] = ["general", "reduced", "term", "category"];
const RELEVANCE_ORDER: readonly KeywordKind[] = ["term", "general", "reduced", "category"];

/**
 * The next call of a search, or why it stops (see the file header). The first call is page 1 of
 * the parse's keywords.
 */
export function nextFetch(s: FetchProgress): FetchDecision {
  const steps = keywordSteps(s.filters);
  const primary = steps[0].keywords;
  if (!s.calls.length) return { step: { keywords: primary, pageNo: 1 } };
  if (s.calls.length >= MAX_ALI_CALLS) return { stop: "calls" };
  const passed = passedCount(s.pool, s.filters);
  if (passed >= TARGET_PASSED) return { stop: "enough" };
  if (
    s.pool.length >= REQUIREMENT_STOP_CHECKED &&
    requirementBlocksAll(s.pool, s.filters, passed)
  ) {
    return { stop: "requirement" };
  }
  const r = rejectionCounts([...s.pool], s.filters);
  const trustLimited = r.feedback + r.volume > r.type + r.requirement;
  const page = nextPrimaryPage(s, primary, passed);
  if (page && !trustLimited) return { step: page };
  const tried = new Set(s.calls.map((c) => wordSet(c.keywords)));
  for (const kind of trustLimited ? TRUST_ORDER : RELEVANCE_ORDER) {
    const step = steps.find((k) => k.kind === kind && !tried.has(wordSet(k.keywords)));
    if (step) return { step: { keywords: step.keywords, pageNo: 1 } };
  }
  return page ? { step: page } : { stop: "exhausted" };
}
