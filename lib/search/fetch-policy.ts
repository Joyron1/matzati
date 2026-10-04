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
import { RESULTS_FIRST_VIEW, RESULTS_PER_PAGE, SEO_MAX_PRODUCTS } from "@/lib/config/site";
import { passedCount, requirementBlocksAll } from "@/lib/ranking/blockers";
import { FILL_TIER, FILL_UP_TO, FILTERS } from "@/lib/ranking/config";
import { rejectionCounts } from "@/lib/ranking/rank";
import type { ParsedQuery } from "./filters";

/**
 * product.query calls per search at most: the app key's quota is shared by every visitor. Owner
 * decision 2026-09-30: 4 (was 3), so a niche search (a character's party items) can reach the
 * first view of 10 and a page after it.
 */
export const MAX_ALI_CALLS = 4;
/**
 * Fetch until this many products pass: the first view (RESULTS_FIRST_VIEW, 10) and one page of
 * "עוד N אפשרויות" (owner decision 2026-09-30: 15, was 10 for one page of 5 and a page after it).
 * The offline numbers of the change are in CLAUDE.md §6.4.
 */
export const TARGET_PASSED = RESULTS_FIRST_VIEW + RESULTS_PER_PAGE;
/** Checked products after which a requirement that blocks everything stops the search. */
export const REQUIREMENT_STOP_CHECKED = 100;
/** Pages of the primary keywords at most; later calls go to broader keywords. */
export const PRIMARY_PAGES = 2;
/** How far one fetch may go: nextFetch's limits (a visitor's search: SEARCH_FETCH). */
export interface FetchLimits {
  /** Stop once this many products pass. */
  target: number;
  /** product.query calls at most. */
  maxCalls: number;
  /** Pages of the primary keywords at most. */
  primaryPages: number;
  /**
   * How many results FILL_TIER tops the ranking up to (rankWithFill's target): what "passed"
   * counts, and while fewer pass, the next page of the primary keywords may still pass at
   * FILL_TIER's sales bar.
   */
  fillTo: number;
}

/** A visitor's search: 15 pass, 4 calls, 2 pages of the primary keywords, filled up to 10. */
export const SEARCH_FETCH: FetchLimits = {
  target: TARGET_PASSED,
  maxCalls: MAX_ALI_CALLS,
  primaryPages: PRIMARY_PAGES,
  fillTo: FILL_UP_TO,
};

/**
 * An SEO landing page's refresh (lib/search/seo-run.ts, owner decision 2026-09-29): it shows up to
 * SEO_MAX_PRODUCTS passers, so it may make up to 5 calls (the same steps in the same order, spaced
 * the same way), and take more pages of the primary keywords while they can pass the trust bar.
 * Only the refresh uses it: a visitor's search keeps SEARCH_FETCH. Its ranking fills up to one
 * page (RESULTS_PER_PAGE), as before the first view of 10 (lib/search/seo-run.ts).
 */
export const SEO_FETCH: FetchLimits = {
  target: SEO_MAX_PRODUCTS,
  maxCalls: 5,
  primaryPages: 5,
  fillTo: RESULTS_PER_PAGE,
};

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

/** Words that name a number but hold no digit ("third birthday", "number 3", "3 years old"). */
const NUMBER_WORDS = new Set(
  "first second third fourth fifth sixth seventh eighth ninth tenth number age year years old".split(
    " ",
  ),
);

/**
 * The words of the preferences' whole phrases (lib/ranking/relevance.ts) that say a number: its
 * digits ("3", "3rd") and the words around one ("number", "third", "years"). A product phrase or a
 * requirement never loses a word this way.
 */
function preferenceNumberWords(parsed: ParsedQuery): Set<string> {
  const kept = new Set(
    [parsed.product_terms[0] ?? "", ...parsed.requirements.flatMap((r) => [r.en, ...r.alt])]
      .flatMap(words)
      .map(bare),
  );
  return new Set(
    (parsed.preferences ?? [])
      .flatMap((p) => p.words)
      .filter((phrase) => /\d/.test(phrase) || words(phrase).some((w) => NUMBER_WORDS.has(w)))
      .flatMap(words)
      .filter((w) => (/\d/.test(w) || NUMBER_WORDS.has(w)) && !kept.has(w)),
  );
}

/**
 * What a keyword step is: the parse's own keywords, those without audience and praise words and
 * without the number a preference names ("general": "sonic birthday balloons" after "sonic 3rd
 * birthday balloons"), also without the requirement words ("reduced"), a product phrase with the main
 * requirement ("term"), or the broader category hint with the main requirement ("category"; the
 * bare hint is then "reduced", and "category" when it has no room for the requirement).
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
  // An age or number the search prefers ("sonic 3rd birthday balloons" for "יום הולדת 3") narrows
  // the keyword search like an audience word, and it is no filter: broader steps drop it.
  const numbers = preferenceNumberWords(parsed);
  const general = tokens.filter(
    (w) => !FILLER.has(w.toLowerCase()) && !audience(w) && !numbers.has(w.toLowerCase()),
  );
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
  // The category with the main requirement first ("naruto collectible figures"): without it a
  // named character or brand is left to chance, and "collectible figures" brought figures of
  // every other anime (live "Naruto pop", 2026-10-04). The bare hint then drops the requirement
  // words, so it is a "reduced" step, tried after the other one.
  const hint = parsed.category_hint?.trim();
  if (hint && hint.split(/\s+/).length >= 2) {
    const hintWords = new Set(words(hint));
    const withMain =
      main &&
      !words(main).every((w) => hintWords.has(w)) &&
      words(main).length + hintWords.size <= MAX_STEP_WORDS;
    if (withMain) add(`${main} ${hint}`, "category");
    add(hint, withMain ? "reduced" : "category");
  }
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
 * FILL_TIER's while fewer than `fillTo` pass (FILL_TIER tops the first view up), FILTERS' after.
 */
function nextPrimaryPage(
  s: FetchProgress,
  primary: string,
  passed: number,
  primaryPages: number,
  fillTo: number,
): FetchStep | null {
  const last = s.calls
    .filter((c) => c.keywords === primary)
    .reduce<FetchedPage | null>((a, c) => (a && a.pageNo >= c.pageNo ? a : c), null);
  if (!last || last.pageNo >= primaryPages || last.count === 0) return null;
  const more =
    last.totalRecords !== null
      ? last.totalRecords > last.pageNo * MAX_PAGE_SIZE
      : last.count >= FULL_PAGE_WITHOUT_TOTAL;
  const bar =
    passed < fillTo ? Math.min(FILL_TIER.minUnitsSold, FILTERS.minUnitsSold) : FILTERS.minUnitsSold;
  if (!more || last.lowestUnitsSold === null || last.lowestUnitsSold < bar) return null;
  return { keywords: primary, pageNo: last.pageNo + 1 };
}

// Steps that keep the requirement words come before "reduced", which drops them: a product found
// without them passes only when its title happens to state the requirement anyway, which a
// feature ("leakproof") often does and a named character ("naruto") seldom does (live "Naruto
// pop", 2026-10-04: "pop figure" and "collectible figures" spent 2 of 4 calls on other anime).
const TRUST_ORDER: readonly KeywordKind[] = ["general", "term", "category", "reduced"];
const RELEVANCE_ORDER: readonly KeywordKind[] = ["term", "general", "category", "reduced"];

/**
 * The next call of a search, or why it stops (see the file header). The first call is page 1 of
 * the parse's keywords. The limits default to a visitor's search (SEARCH_FETCH); the offline
 * replay passes another `target` to measure it (lib/eval/policies.ts, "current-<n>"), and an SEO
 * page's refresh passes SEO_FETCH.
 */
export function nextFetch(
  s: FetchProgress,
  {
    target = SEARCH_FETCH.target,
    maxCalls = SEARCH_FETCH.maxCalls,
    primaryPages = SEARCH_FETCH.primaryPages,
    fillTo = SEARCH_FETCH.fillTo,
  }: Partial<FetchLimits> = {},
): FetchDecision {
  const steps = keywordSteps(s.filters);
  const primary = steps[0].keywords;
  if (!s.calls.length) return { step: { keywords: primary, pageNo: 1 } };
  if (s.calls.length >= maxCalls) return { stop: "calls" };
  const passed = passedCount(s.pool, s.filters, fillTo);
  if (passed >= target) return { stop: "enough" };
  if (
    s.pool.length >= REQUIREMENT_STOP_CHECKED &&
    requirementBlocksAll(s.pool, s.filters, passed)
  ) {
    return { stop: "requirement" };
  }
  const r = rejectionCounts([...s.pool], s.filters);
  const trustLimited = r.feedback + r.volume > r.type + r.requirement;
  const page = nextPrimaryPage(s, primary, passed, primaryPages, fillTo);
  // Page 2 of keywords whose products were all of another type brings more of the same: another phrasing
  // first (live SEO page "מזוודה לילדים", 2026-10-04: five pages of "kids suitcase" were stickers
  // "for suitcase", and "kids luggage" was never tried).
  // A requirement that blocks keeps page 2: REQUIREMENT_STOP_CHECKED needs its 100 products.
  const typeBlockedAll = passed === 0 && r.type > r.requirement;
  if (page && !trustLimited && !typeBlockedAll) return { step: page };
  const tried = new Set(s.calls.map((c) => wordSet(c.keywords)));
  for (const kind of trustLimited ? TRUST_ORDER : RELEVANCE_ORDER) {
    const step = steps.find((k) => k.kind === kind && !tried.has(wordSet(k.keywords)));
    if (step) return { step: { keywords: step.keywords, pageNo: 1 } };
  }
  return page ? { step: page } : { stop: "exhausted" };
}
